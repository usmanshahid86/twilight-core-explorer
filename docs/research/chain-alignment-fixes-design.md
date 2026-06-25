# Chain-Alignment Fixes — Design

Design (no implementation) for resolving the issues in
`chain-alignment-review.md`. Each fix is grounded in verified Twilight chain behaviour
(`file:line` into `nyks-core` where it matters). Scope: the 4 correctness issues
(1 BLOCKER, 3 MAJOR), the 1 doc MINOR, and a decision on each chain-side gap.

## Design principle

The explorer is an **indexer first, query client second**:

- **Source of truth for history = events.** Claim history, validator-set changes, param
  changes, and tx correlation are projected from CometBFT block events. Events are
  append-only and carry tx context.
- **Queries (REST/gRPC) = current-state reconciliation**, never the historical record.
  In particular, the `EpochReward` snapshot is **not** authoritative for claim status.
- **Chain semantics are fixed; the client adapts.** We do not ask the chain to change to
  fit the explorer unless there's a clear, general win (see "Chain-side decisions").

---

## Issue 1 (BLOCKER) — ClaimableRewards requires an epoch range

**Chain reality:** `ClaimableRewards(slot_id, start_epoch, end_epoch)` rejects
`start_epoch==0` with InvalidArgument/400 (`x/rewards/keeper/query_server.go:99-100`),
and returns **only unclaimed** rows with a positive amount (`query_server.go:110-119`).
The current client calls it with no range (`chain-client/src/types.ts:24`,
`rest-rpc-client.ts:251`), so it always 400s.

**Design:**
- Change the client contract to require the range:
  `getClaimableRewards(slotId, startEpoch, endEpoch): EligibleSlotReward[]`.
- The caller derives the range from indexed state, not guesses:
  - `endEpoch = currentEpoch − 1` (last finalized) from `epoch-info`
    (`current_epoch`); never query the open epoch (no record yet).
  - `startEpoch = max(1, lastClaimedEpoch(slotId) + 1)` where `lastClaimedEpoch` comes
    from the indexer's `reward_claimed` projection (Issue 3/4). Fall back to `1` if the
    slot has never claimed.
- Semantics to document at the call site: **nonempty ⇒ those epochs are unclaimed &
  claimable; empty ⇒ nothing claimable in range** (already claimed or zero amount).
- Bound the range: the keeper iterates `[start,end]` (`IterateClaimRecordsForSlot`), so
  a huge range is a linear scan. Cap a single call (e.g. ≤ a few thousand epochs) and
  window if needed; in practice `start` tracks `lastClaimed`, so the range stays small.

**Why not SlotRewards here:** `ClaimableRewards` is the targeted, range-filtered query;
`SlotRewards` has no epoch filter and pages ascending (Issue 3).

---

## Issue 2 (MAJOR) — Consensus-address lookups must be lowercase hex

**Chain reality (verified):**
- `CoreSlotByConsensusAddress` decodes the input as hex then re-encodes lowercase before
  lookup (`query_server.go:49-53`) → **accepts upper OR lower hex, rejects bech32**
  (`hex.DecodeString` fails on `valcons…` with `encoding/hex: invalid byte`).
- `ReservedConsensusAddress` does a **direct string `Get`** keyed by `fmtHex` = lowercase
  (`query_server.go:81`, `genesis.go:48`, `keeper.go:90`) → **requires lowercase hex
  exactly**; uppercase silently misses.

**Design:**
- Single normalizer at the chain-client boundary, applied to **all** coreslot
  consensus-address routes: `toConsHex(addr): string`
  - if input is bech32 `…valcons…`: bech32-decode → 20 bytes → **lowercase** hex.
  - if input is hex (40 chars, either case): **lowercase** it.
  - else: throw a typed error (don't forward a bad value).
  Lowercase satisfies both routes (CoreSlotByConsensusAddress is case-insensitive;
  Reserved needs lowercase).
- Canonical internal representation of a consensus address = **lowercase hex**. Store it
  that way in the indexer; derive it once from the source:
  - CometBFT `/validators` → `validators[].address` is hex (often uppercase) → lowercase.
  - block header `proposer_address` is base64/hex bytes → hex-encode lowercase.
  - from a consensus pubkey (Any) → `sha256(pubkey_bytes)[:20]` → lowercase hex.
- Never send bech32 `valcons` to a coreslot route.

---

## Issue 3 + 4 (MAJOR) — Claim status from ClaimRecords, paged correctly

These are one problem: where does "claimed?" come from, and how to read it without the
ascending-pagination trap.

**Chain reality (verified):**
- `SlotRewards` rows are `EligibleSlotReward` which **already carry `claimed` (field 8)
  and `claimed_at_height` (field 9)** (`proto/twilight/rewards/v1/rewards.proto:46-47`).
- `SlotRewards` is keyed `(slotID, epoch)` and **paginates ascending by epoch**
  (`x/rewards/keeper/query_server.go:83`); a fixed `--limit` page drops recent epochs once
  the chain passes one page (the soak false-failure bug). It uses `req.Pagination`, so
  **`reverse=true` is supported**.
- `EpochReward.rewards[]` is a **finalization snapshot** — its embedded `claimed` is
  frozen false and must **never** be used for live claim status.

**Design — authoritative claim model:**
1. **Primary (history + tx):** index `reward_claimed` events
   (`type=reward_claimed`, attrs `signer, slot_id, start_epoch, end_epoch, amount,
   payout_count` — `x/rewards/keeper/events.go`). Each event = one claim tx covering an
   epoch range. Build the `RewardClaim` table from these:
   - `claimTxHash` ← the **enclosing tx hash from the block/envelope** (the event carries
     none by design — handoff §8); correlate by (height, tx index).
   - mark every epoch in `[start_epoch, end_epoch]` for `slot_id` as claimed, with the
     claim's height/amount.
2. **Reconciliation (current state):** when displaying a slot's per-epoch ledger, read
   `claimed` / `claimed_at_height` directly off `SlotRewards` rows. To avoid the trap:
   - **Never** call `SlotRewards` with a bare `limit` to find recent epochs.
   - Either (a) page with `pagination.reverse=true` for newest-first, or (b) prefer the
     event-derived table and only use `SlotRewards` for verification/backfill.
3. **Drop `EpochReward` as a claim-status source.** Use it only for epoch-level
   aggregates (emission, pool, allocated) — and remember `epochs/{n}` returns **404**
   until the epoch is finalized.

**Data-model decision:** `RewardClaim.claimed` is **derived from the indexed
`reward_claimed` events**, not from any single query. `SlotRewards.claimed` is a
cross-check/backfill source, not the field's origin.

---

## Issue 5 (MINOR) — Remove the stale buf/Telescope recommendation

**Chain reality:** the chain repo ships **no buf/ts-proto/Telescope** — only a
`FileDescriptorSet` (`nyks-core/docs/proto/twilight-descriptors.pb`, handoff §4). The
shipped decoder is already descriptor-backed and correct.

**Design:** update the explorer research doc to state the production decode path is the
**descriptor set** (regenerated from the chain via `scripts/export-proto-descriptor.sh`),
not generated TS bindings. Optional future note: a client-side buf/Telescope setup is a
*possible* later enhancement that lives in the explorer repo, not the chain.

---

## Chain-side decisions (gaps the review surfaced)

| Gap | Decision | Rationale |
|---|---|---|
| Reverse pagination on `SlotRewards` | **No chain change** — already supported via `pagination.reverse`. Document it. | Standard cosmos pagination; client uses `reverse=true`. |
| Explicit `claimed` flag on rows | **No chain change** — `EligibleSlotReward.claimed`/`claimed_at_height` already exist. | The field is there; the bug was paging, not schema. |
| Tx hash in `reward_claimed` event | **No chain change** (deliberate). Document that clients correlate via the envelope. | Tx hashes are indexer data; the chain intentionally keeps them out of consensus state (see `rewards.proto:48-50`). |
| Historical proposer(cons-addr)→slot | **Client-side** — the indexer builds a temporal cons-addr→slot map from coreslot events (`coreslot_registered`/`activated` carry `consensus_address`; `coreslot_key_rotated` carries `old/new_consensus_address`; `coreslot_removed`). | `CoreSlotByConsensusAddress` is current-only; the events give the full timeline. |
| `ReservedConsensusAddress` case inconsistency | **Optional chain change** (low priority): normalize input like `CoreSlotByConsensusAddress` (decode→re-encode) so it's case-insensitive too. Until then, client always sends lowercase. | Removes a foot-gun; not blocking since the client normalizes. |

Net: **no chain change is required** to fix the explorer. One optional low-priority
chain nicety (Reserved case-normalization) is noted for later.

---

## Summary of decisions

| Issue | Sev | Fix location | Core decision |
|---|---|---|---|
| 1 ClaimableRewards range | BLOCKER | client | require `(slotId, startEpoch, endEpoch)`; derive range from `epoch-info` + indexed last-claimed |
| 2 Consensus addr hex | MAJOR | client | normalize all coreslot consensus routes to **lowercase hex**; reject bech32 |
| 3 SlotRewards pagination | MAJOR | client | never bare-`limit`; use `reverse=true` or the event-derived ledger |
| 4 Claimed source | MAJOR | client | `claimed` derived from indexed `reward_claimed` events; reconcile via `SlotRewards.claimed`; never `EpochReward` |
| 5 Stale doc | MINOR | client docs | descriptor-set is the decode path; no buf/Telescope in chain |

## Non-goals
- No chain consensus/module/keeper changes (the one optional Reserved-normalization is
  separately scoped if pursued).
- No new explorer features beyond correctness of the above.
- Implementation (signatures shown are design intent, not final code).

## Validation plan (when implemented)
- `ClaimableRewards` against a live devnet with a real `(slot, start, end)` → 200 + rows.
- Consensus lookups with hex from `/validators` (upper & lower) and a bech32 input
  (expect normalized success / typed rejection respectively).
- Claim ledger: replay a block range with `reward_claimed` events; assert per-epoch
  `claimed` matches `SlotRewards.claimed` for the same (slot, epoch).
- Event-name parity check against `nyks-core` `x/{rewards,coreslot}/types` consts.
