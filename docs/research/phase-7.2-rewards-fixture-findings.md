# Phase 7.2 — Live Rewards-Claim Fixture — Findings

**Status: Findings (acceptance FAILED; root causes diagnosed).** Date: 2026-06-27.
The `rewards-fixture.sh` localnet (`twilight-rewards-fixture-1`) was built, run, and ingested into a
separate DB (`twilight_explorer_rewards`, path B) per
[the ingest runbook](phase-7.2-rewards-ingest-runbook.md). The whole point of 7.2 — get **real**
finalized-epoch + claim data through the explorer — succeeded as a *data capture*, and in doing so
**revealed that the rewards/identity projection layer was never validated against real chain events.**
There are concrete, fixable gaps. This report is the evidence + the decisions to lock before fixing.

## What was captured (the fixture is good)

- Chain: `twilight-rewards-fixture-1`, RPC 26657, REST 1317 (REST confirmed `200`), short epoch (10).
- Ingest: **53 blocks, 33 events, 2 transactions** (`MsgClaimRewards` ×2), 2 messages.
- Canonical events present: `epoch_finalized ×5`, `reward_claimed ×2` (+ bank/tx plumbing).
- Claims landed correctly at the *canonical* layer: slot 1 epoch 1 (`1040475`) at height 11
  (`A53AB4D7…`); slot 1 epochs 2–3 (`2080950` = 2×`1040475`) at height 31 (`C73D3964…`).
- Emission math confirmed live: `minted_emission = 4,161,900`/epoch = `EPOCH_LENGTH(10) × SUBSIDY(416190)`;
  per-slot/epoch `1,040,475` (= /4 active slots); `claimed:true` with `claimed_at_height` 11/31/31 on the
  live `rewards-query slot-rewards 1` (CLI/gRPC) and on the explorer REST route
  `/twilight/rewards/v1/slots/1/rewards` (verified `200`).

## Acceptance result: FAILED (semantic layer), with honest degradation

| Acceptance target | Result | Why |
|---|---|---|
| `/rewards/epochs` totalReward `4,161,900` | ❌ null | F2 — epoch attribute names mismatch |
| `/coreslots/1/rewards` amount `1,040,475` `claimed:true` | ❌ empty | F1 — genesis slots unprojected |
| `/rewards/claims` 2 rows w/ claimant | ⚠️ 2 rows, **claimant null** | F3 — claim attribute name mismatch |
| `/supply` ≈ `2,000,0XX,XXX,XXX utwlt` | ✅ `2,000,041,619,000` sampled | (height label wrong — F4) |

Critically, the system **did not fabricate** the missing state: the claim projector recorded two
`missing_reward_records` ProjectionFailures (`Claim for slot 1 epochs 1..1 / 2..3 has no
SlotRewardProjection rows`) instead of guessing `claimed`. The correctness-over-guessing invariant held.

## Findings (root causes)

### F1 — Genesis CoreSlots are never projected (the keystone)
`CoreSlotProjection` is **empty (0 rows)**. All four CoreSlots in this fixture are created at **genesis**
(`coreslot-genesis add` in nyks-core `init.sh`), so there are **no on-chain `MsgCreateCoreSlot`/lifecycle
events** in blocks 1–53 for the semantic projector to derive slot identity from. Cascade:
`rewards-snapshot` enumerates slots via `prisma.coreSlotProjection.findMany(...)`
(`apps/indexer/src/projections/rewards-snapshot.ts:52`) → **0 slots → 0 `getSlotRewards` calls → 0
`SlotRewardProjection` rows** → `/coreslots/{id}/rewards` empty **and** the claim reconciliation
(`rewards-semantic.ts:663`) finds no rows to mark `claimed` → the 2 failures above. The same gap would
empty the **operator** and **CoreSlot** pages on any genesis-seeded chain.
This is [[coverage-truth-genesis-gap]] generalized from liveness windows to **slot identity + rewards** —
it needs a **genesis CoreSlot seed** analogous to the height-1 temporal-map seed.

### F2 — `epoch_finalized` attribute schema mismatch
`projectEpochFinalized` (`rewards-semantic.ts:242-244`) reads `total_reward` / `amount`, `denom`,
`active_slot_count`. The chain actually emits:
`epoch, start_height, end_height, minted_emission, cumulative_emitted, reward_pool, allocated, carry_out,
eligible_slots, distribution_method, mode`. So `epochNumber` resolves (it also reads `epoch`), but
**`totalReward` / `denom` / `activeSlotCount` are all null**. Raw event is preserved, so this is
re-projectable after the mapping is fixed.

### F3 — `reward_claimed` attribute schema mismatch (claimant)
`applyClaim` (`rewards-semantic.ts:622-626`) reads `claimant / operator / creator`. The chain emits
**`signer`** (`twilight1rsjr6g…`), plus `slot_id, start_epoch, end_epoch, amount, payout_count,
msg_index`. So `slotId/startEpoch/endEpoch/amount` are correct but **`claimant` is null**. `payout_address`
and `denom` are **not in the event** (denom is implicitly `utwlt`; the payout address is the slot's payout
operator, resolvable from slot metadata, not from the claim event — `claimant`(signer) ≠ payout, as the
runbook warned).

### F4 — Sampled-height mislabel (fixture hygiene)
The live samples are tagged `sampledAtHeight = 53` but were actually taken against the chain's
*then-current* height (~100 at sample time; the chain is now at 166 and still minting every block because
the fixture is left running with no teardown). The recorded `cumulative_emitted` was `41,619,000` (~height
100), not the `20,809,500` of 5 finalized epochs. So "observed sample at height 53" is **not** what the
sample reflects. Live snapshots must either pin REST by `?height=` or sample only after the chain is
stopped at `END_HEIGHT` (or be labeled with the true current height).

### Minor — module-balance sample empty
`getModuleBalances()` extracted 0 `module_balance` rows (only `cumulative_emitted` + `supply` samples
landed). Lower priority; revisit when fixing the snapshot.

## RESOLVED (2026-06-27) — all findings fixed + validated live

All four findings are fixed and re-validated end-to-end against the live fixture (clean height-53
state), through the API the web app consumes. **Acceptance now green:**

| Endpoint | Result |
|---|---|
| `/rewards/epochs` | 5 epochs; `totalReward 4,161,900`; `activeSlotCount 4`; `cumulativeEmitted`→`20,809,500`; `distributionMethod` set; `denom utwlt` ✓ |
| `/coreslots/1/rewards` | epochs 1–5; **1–3 `claimed:true`** with `claimedAtHeight` (11/31/31) + `claimTxHash` (A53A…/C73D…); 4–5 unclaimed ✓ |
| `/rewards/claims` | 2 rows, **`claimant` = signer** (`twilight1rsjr6g…`), `utwlt` ✓ |
| `/supply` | `2,000,020,809,500 utwlt` (2e12 + 5×4,161,900), honestly `sampledAtHeight:53` ✓ |
| `/coreslots` | 4 genesis CoreSlots now present (ACTIVE, monikers node0–3) ✓ |
| ProjectionFailures | **0** ✓ |

**What changed:**
- F2/F3 — `rewards-semantic.ts`: epoch `totalReward←allocated`, `activeSlotCount←eligible_slots`,
  `cumulativeEmitted←cumulative_emitted`, `distributionMethod←distribution_method`, `denom←utwlt`;
  claim `claimant←signer`, claim `denom←utwlt`. Old keys kept as defensive fallbacks.
- D2 — added `cumulativeEmitted`/`distributionMethod` columns (migration
  `20260627000100_reward_epoch_emission_fields`) + promoted them through the API contract
  (`RewardEpochListItem`/`Detail`, regenerated `openapi.json` + web types).
- F1 — new `coreslot-genesis-identity.ts` (`seedCoreSlotGenesisIdentity`) seeds `CoreSlotProjection`
  identity from `getGenesis()`, wired into the metadata step of the combined rebuild (gated on
  reset / startHeight<=1). Genesis is the rebuildable source; consensus-address derivation + status
  normalization match lifecycle/temporal-map so a genesis slot reconciles to one identity.
- F4 — height-pinned the sampled REST reads via an `x-cosmos-block-height` header threaded through
  `ChainClient.getSlotRewards/getModuleBalances/getCumulativeEmitted/getSupply/getBalances` and passed
  the sample height from the snapshot projectors. Sampled rows now reflect (and are labeled at) the
  ingest height instead of drifting with a long-running chain.

**Two ordering nuances discovered (document, not bugs):**
1. **rewards reset wipes the snapshot's `SlotRewardProjection`** (it is co-owned). The claim
   reconciliation (`claimTxHash`/cleared `missing_reward_records`) requires snapshot rows to exist, so
   the full-truth order is `rewards(reset) → rewards-snapshot → rewards(replay)`. The first pass's
   `missing_reward_records` failure is expected and clears on the post-snapshot replay. The runbook's
   `rewards → rewards-snapshot` order is load-bearing.
2. **Stale-process trap:** after a schema/DTO change, an orphaned `node dist/index.js` kept serving the
   pre-`db:generate` Prisma client, so promoted fields serialized as `null`. Always kill the API by
   port + clean-rebuild after a contract change.

## Decisions — LOCKED (2026-06-27)

- **Scope:** full correction now (F2/F3 mappings + F1 genesis CoreSlot seed + F4 height fix + re-validate).
- **D1 `totalReward` ← `allocated`.**
- **D2 epoch fields — the split:** promote `totalReward`(←allocated), `activeSlotCount`(←eligible_slots),
  **`cumulativeEmitted`**, **`distributionMethod`** to first-class contract fields (validated by this
  fixture); keep `rewardPool` / `carryOut` in preserved raw **until a fixture exercises `carry_out ≠ 0`**
  (this fixture's carry_out is always 0, so their meaningful behavior is unexercised — promoting them now
  would formalize a shape testable only in its trivial state). Additive migration later when proven.
- **D3 genesis CoreSlot seed:** yes (source TBD via existing liveness genesis-seed pattern).
- **D4 denom ← explicit `utwlt`** constant (documented module denom).
- **D5 sampled-height:** stop the chain at `END_HEIGHT` before sampling now; height-pinning later.

## Decisions to lock before fixing (original options, superseded by LOCKED above)

1. **D1 — `totalReward` source.** Map epoch `totalReward ← allocated` (rewards actually distributed this
   epoch; = `reward_pool − carry_out`). Alternatives: `minted_emission` (newly minted) or `reward_pool`
   (available incl. carry-in). All equal here (`carry_out=0`) but semantically distinct.
   **Recommend `allocated`.**
2. **D2 — extra epoch fields.** Surface the now-available `cumulative_emitted`, `reward_pool`, `carry_out`,
   `eligible_slots`, `distribution_method` as first-class epoch fields (contract + Phase 12 display), or
   keep the projection minimal (totalReward/activeSlotCount only, rest in raw)? **Recommend minimal now**
   (map `activeSlotCount ← eligible_slots`, `totalReward ← allocated`); promote others later if Phase 12
   needs them — raw is preserved either way.
3. **D3 — genesis CoreSlot seed (keystone).** Build a genesis CoreSlot seeder (read genesis CoreSlots /
   the coreslot REST list → seed `CoreSlotProjection` at height 1), mirroring the temporal-map genesis
   seed, so slot identity + rewards + operator pages populate on genesis-seeded chains. **Recommend yes**
   — without it `/coreslots/{id}/rewards`, operator pages, and slot-reward sampling are empty on this (and
   the canonical) fixture. Confirm the seed source (chain `genesis.json` app_state vs a coreslot REST
   list endpoint).
4. **D4 — rewards denom.** All rewards/emission amounts are `utwlt` by chain convention but `denom` is not
   emitted on epoch/claim events. Set an explicit documented `utwlt` constant for rewards amounts, or
   leave `denom` null? **Recommend explicit `utwlt`** (documented module denom), since every rewards amount
   on this chain is `utwlt`.
5. **D5 — sampled-height correctness (F4).** Pin live REST samples by `?height=END_HEIGHT` if the routes
   support it, else stop the chain at `END_HEIGHT` before running the snapshot projectors. **Recommend**
   stop-then-sample for the fixture now; height-pinning as the durable fix.

## Recommended sequence (after decisions locked)

1. Fix F3 (`claimant ← signer`) + F2 (`totalReward ← allocated`, `activeSlotCount ← eligible_slots`,
   `denom ← utwlt` per D4) in `rewards-semantic.ts` — both pure attribute-mapping changes, unit-testable
   against the captured raw events. Add fixtures from these real events to the projector tests.
2. Build the genesis CoreSlot seed (D3); re-run `project:coreslot-semantic` → seed → `project:rewards`
   → `project:rewards-snapshot` (now enumerates the 4 slots) → re-check the 2 failures clear and
   `SlotRewardProjection` fills with `claimed:true` for epochs 1–3.
3. Re-sample supply/balances with the height fix (D5).
4. Re-run acceptance; the failed rows above should turn green. Then re-evaluate the Phase 12
   `gated_by_phase_7_2` caveats against the now-live evidence.

## Note on scope

This is **backend/indexer + a contract-shape decision**, not web work. It expands Phase 7.2 from "run a
fixture" to "correct the rewards/identity projection layer against real data + add the genesis slot seed."
Phase 12 web should resume only after these projections produce correct data — otherwise the rewards/
supply UI would be built and tested against null/empty projections.
