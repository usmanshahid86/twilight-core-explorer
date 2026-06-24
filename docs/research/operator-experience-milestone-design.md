# Twilight Core Explorer — Operator Experience Milestone Design

Date: 2026-06-24
Scope: DESIGN-ONLY (this is the only file written). No chain change, no schema migration,
no projection/page/API code is implemented here.

This milestone closes the six highest-impact operator/monitor gaps identified in
`explorer-coverage-and-fix-validation.md` (the "Top gaps ranked by operator-friendliness
impact" list, lines 237–257). It defines DEPTH for gap #1 (per-operator liveness/uptime,
the only one needing **new ingestion**) and specifies the remaining five as pages/projections
over **already-indexed** data plus existing module snapshots.

Conventions match the existing research docs: every claim about chain behavior cites
`file:line`; where I infer rather than confirm I say **(inferred)**. Generic ingestion stays
canonical; new semantic tables are derived/rebuildable (per `phase-ab-6-semantic-projection-design.md:9-25`).
Chain ground truth: `nyks-core/docs/reference/explorer-integration-handoff.md`.

---

## 0. Confirmed chain ground truth used by this design

Each item was read from `nyks-core` source, not memory:

- **CometBFT version v0.38.21** (`go.mod` resolved at
  `~/go/pkg/mod/github.com/cometbft/cometbft@v0.38.21`). The `/block` wire shape is fixed by
  this version.
- **`/block` commit shape.** `Block.LastCommit *Commit json:"last_commit"`
  (`cometbft@v0.38.21/types/block.go:50`). `Commit.Signatures []CommitSig json:"signatures"`
  (`.../types/block.go` Commit struct). Each `CommitSig` is
  `{ block_id_flag, validator_address, timestamp, signature }`
  (`.../types/block.go:600-606`). `ValidatorAddress` is the **consensus address as HEX**
  (uppercase in RPC JSON).
- **`block_id_flag` enum** (`.../types/block.go:584-589`), serialized as an **integer** in
  RPC JSON:
  - `1` = `BlockIDFlagAbsent` — no vote received (validator missed / down).
  - `2` = `BlockIDFlagCommit` — voted for the committed block (signed; counts as live).
  - `3` = `BlockIDFlagNil` — voted nil (online but did not sign this block; e.g. saw a
    different proposal). Treat as **present-but-not-committed**, distinct from absent.
- **Deferred-commit subtlety (CRITICAL).** `block.last_commit` in block **N** is the commit
  for block **N-1** (`Header.LastCommitHash` validates against `LastCommit.Hash()`,
  `.../types/block.go:76-79`; `Commit.Height = N-1`). So the signatures in block N attribute
  liveness to **height N-1**, and the set of signers must be resolved against the validator
  set active at **N-1**. The genesis/first block has an empty `last_commit`.
- **`proposer_address`.** `Header.ProposerAddress` is HEX (the smoke DB already stores
  proposers as uppercase hex — `phase-ab-6-semantic-projection-design.md:78-80`). The
  proposer of block N is recorded in block N's header.
- **Consensus addresses everywhere are HEX, not bech32 `valcons`**
  (`explorer-integration-handoff.md:38-41`). CoreSlot events emit hex consensus addresses:
  `emitKeyRotated(... oldKey, newKey ...)` where `oldKey/newKey` come from `consensusKey(...)`
  (`nyks-core/x/coreslot/keeper/endblock.go:65-72,86`), and `emitValidatorUpdateEmitted(...
  keyed[i].key ...)` uses the same hex key (`.../endblock.go:212`). Lowercase-vs-uppercase
  must be normalized (the transport lowercases — `rest-rpc-client.ts:327-340` per
  `explorer-coverage-and-fix-validation.md:61-66`); the indexer should normalize both the
  commit-sig hex (uppercase from CometBFT) and event hex (keeper-stored) to one case before
  joining. **Recommend lowercase** to match the existing transport.
- **Active-set membership changes only at EndBlock.** `coreslot_validator_update_emitted`
  carries the `height` the validator-set diff was persisted
  (`nyks-core/x/coreslot/keeper/events.go:116-123`; emitted from
  `diffAndPersist` at `.../endblock.go:208-213`). This is the authoritative signal for a
  consensus hex **entering** (`power>0`) or **leaving** (`power=0`) the CometBFT validator
  set. An update emitted at height H takes effect for blocks the validator can sign from
  H+1 onward **(inferred from ABCI semantics: validator updates returned by EndBlock(H) apply
  to the validator set that signs block H+1)**.
- **Key rotation for ACTIVE slots is delayed and applied at EndBlock at `effective_height`**:
  `coreslot_key_rotation_requested` carries `effective_height`
  (`.../keeper/events.go:75-82`); the rotation is applied in `endBlock` when
  `rotation.EffectiveHeight <= height` and emits `coreslot_key_rotated` with
  `old/new_consensus_address` + `effective_height` (`.../endblock.go:40-86`). Non-active
  rotations apply immediately (handoff §, `phase-ab-6:210`). Rotations can also be **cancelled**
  (`coreslot_rotation_cancelled`, reasons `lifecycle_change`/`stale_rotation` —
  `nyks-core/x/coreslot/types/events.go:38-41`, `.../endblock.go:110`). The temporal
  signer→slot map MUST honor these so a historical signer hex resolves to the slot that
  actually held that key at that height.
- **PoA liveness is N-of-N-ish, not staking fault tolerance.** Each active slot has equal
  voting power (`slot_voting_power` param, `coreslot.proto:44`); CometBFT needs >2/3 to
  commit, so a 2-validator chain is 2-of-2 (`explorer-integration-handoff.md:35-37`). The
  network-liveness view must frame downtime as **halt risk**, not staking slashing.
- **CoreSlot `Params`** (onboarding/gap #3 data) —
  `nyks-core/proto/twilight/coreslot/v1/coreslot.proto:42-53`:
  `authority`, `emergency_authority`, `slot_voting_power`, `min_active_slots`,
  `max_active_slots`, `activation_delay_blocks`, `key_rotation_delay_blocks`,
  `removal_delay_blocks`, `consensus_key_reuse_lockout`, `allow_self_registration`,
  `allow_emergency_below_min_active`.

---

## 1. Gap #1 — Per-operator liveness / uptime (NEEDS NEW INGESTION)

This is the only gap that requires the indexer to fetch and store something it does not
fetch today. Today `ingestHeight()` fetches `getBlock`, `getBlockResults`, `getTxsByHeight`
only (`phase-ab-6-semantic-projection-design.md:43`), and `BlockResultsSource` has no
commit-signature field (`explorer-coverage-and-fix-validation.md:213`). The commit
signatures live in the **block**, not block_results — they are already inside the `getBlock`
payload, so **no new RPC call is required**; we only need to parse and persist a slice the
indexer currently ignores.

### 1.1 Data sources

| Source | Field | Use |
|---|---|---|
| CometBFT `/block` (already fetched via `getBlock`) | `block.last_commit.signatures[]` → `{ validator_address (hex), block_id_flag (1/2/3), timestamp }` | Per-block per-validator signed/nil/absent for height **N-1** |
| CometBFT `/block` header | `block.header.proposer_address` (hex) | Proposer of block **N** |
| CoreSlot events (already in `Event`) | `coreslot_validator_update_emitted` (`height`, `consensus_address`, `power`, `slot_id`, `operator_address`) | Validator-set entry/exit timeline → who is in the signing set at each height |
| CoreSlot events (already in `Event`) | `coreslot_key_rotated` / `coreslot_key_rotation_requested` / `coreslot_rotation_cancelled` (`old/new_consensus_address`, `effective_height`, `slot_id`) | Map a signer hex to the correct slot across key rotations |
| CoreSlot events (already in `Event`) | `coreslot_activated` / `_inactivated` / `_suspended` / `_removed` (`slot_id`, `consensus_address`, `power`, status) | Slot↔consensus-address association and active windows |
| CoreSlot snapshot (`ChainClient.getLastAppliedValidators()`) | current applied (slot, cons key, power) set | **Reconciliation only** — bootstrap/verify the timeline; not the per-height source |

All event sources are **already ingested** (Phase B `/block_results` event ingestion). Only
the commit signatures (and the proposer, already stored on `Block`) are new.

### 1.2 New ingestion (the only new fetch-side work)

Extend the block ingest path to read `last_commit.signatures` out of the **already-fetched**
`getBlock` payload and persist one `BlockSignature` row per signature, attributed to the
commit's height (**N-1**, taken from `last_commit.height`, not the containing block's
height). Genesis/first block has empty `last_commit` — skip.

`BlockClient`/source change: add `lastCommit: { height, signatures: [{ validatorAddressHex,
blockIdFlag, timestamp }] }` to `BlockSource` in `packages/chain-client` (normalize hex to
lowercase, `blockIdFlag` as the integer enum). This is the single transport change. No new
endpoint, no staking route — consistent with `ChainClient` never calling staking/gov/mint/
distribution (`explorer-architecture-proposal.md:169`).

### 1.3 New storage

Three new tables (drafts; not final Prisma). All rebuildable from generic rows
(`BlockSignature` from re-parsing stored block JSON; the timeline + uptime from the
`Event` table). They follow the projection rules in `phase-ab-6:707-744`: derived, never
mutate generic rows, idempotent by source key, separate projection cursor.

#### `BlockSignature` (canonical-adjacent ingest table, per-height per-validator)

Purpose: raw liveness fact per (commit-height, consensus address).

- `height BigInt` — the **committed** height (`last_commit.height`, = containing block − 1)
- `consensusAddressHex String` — lowercase hex `validator_address`
- `blockIdFlag Int` — 1 absent / 2 commit / 3 nil
- `signed Boolean` — derived `blockIdFlag == 2` (denormalized for fast aggregation)
- `timestamp DateTime?`
- `rawIndex Int` — position in the signatures array
- Unique: `(height, consensusAddressHex)`
- Indexes: `height`, `consensusAddressHex`, `signed`
- Note: proposer is **not** stored here — it already lives on `Block.proposerAddress`
  (`explorer-data-model.md:33`). Proposed-count is derived by joining `Block.proposerAddress`
  to the timeline.

#### `ValidatorSetTimeline` (temporal consensus-addr → slot/operator map)

Purpose: resolve a historical signer hex to the slot/operator that held that consensus key
**at that height**, surviving key rotations and lifecycle changes. Built **entirely from
already-indexed CoreSlot events** — no new fetch.

- `id BigInt @id`
- `consensusAddressHex String` — lowercase hex
- `slotId BigInt`
- `operatorAddress String?`
- `effectiveFromHeight BigInt` — first height (inclusive) this hex is the active signer for
  this slot
- `effectiveToHeight BigInt?` — last height (inclusive); `null` = still active
- `power BigInt` — consensus power while in this window (equal-weight PoA, normally 1)
- `enteredVia String` — `activated` | `key_rotated` | `validator_update`
- `exitedVia String?` — `inactivated` | `suspended` | `removed` | `key_rotated` (rotated away)
- source refs: `enterEventId`, `exitEventId`
- Unique: `(consensusAddressHex, effectiveFromHeight)`
- Indexes: `consensusAddressHex`, `slotId`, `(effectiveFromHeight, effectiveToHeight)`

**Window construction rules** (the hard part — derived from event ordering):
1. A consensus hex **enters** the signing set when its slot's
   `coreslot_validator_update_emitted` is emitted with `power > 0` at height H. Effective for
   signing from **H+1** (ABCI applies EndBlock(H) updates to block H+1's set) **(inferred)**.
   Use `coreslot_validator_update_emitted` as the authoritative entry/exit signal because it
   is exactly the validator-set diff the chain applied (`.../endblock.go:208-213`); lifecycle
   and rotation events are corroborating context.
2. A consensus hex **exits** when `coreslot_validator_update_emitted` is emitted with
   `power = 0` at height H (slot left the set / rotated away / inactivated / suspended /
   removed). Effective end of signing at **H** (it can no longer sign H+1) **(inferred)**.
3. **Key rotation:** when `coreslot_key_rotated` fires at the rotation's `effective_height`,
   close the `old_consensus_address` window and open a `new_consensus_address` window for the
   same `slot_id`, boundary at `effective_height` (the chain applies it in EndBlock at
   `effective_height` — `.../endblock.go:40-86`; the paired `coreslot_validator_update_emitted`
   at the same height gives the exact applied boundary). For non-active immediate rotations,
   the same close/open happens at the rotation block.
4. **Cancelled rotations** (`coreslot_rotation_cancelled`) never open a window for the staged
   `new_consensus_address` — skip them (the staged key was never active —
   `.../endblock.go:91-112`).
5. Bootstrap: at genesis, seed windows from genesis active slots (or, pragmatically, from the
   first `getLastAppliedValidators()` snapshot reconciled against the first observed
   `coreslot_validator_update_emitted` events). Flag any signer hex seen in `BlockSignature`
   with **no** matching timeline window as a `ProjectionFailure`
   (`failureKind = "unmapped_signer"`) — never silently drop liveness facts.

> Resolution query: signer hex `X` at committed height `h` → the timeline row where
> `consensusAddressHex = X AND effectiveFromHeight <= h AND (effectiveToHeight IS NULL OR
> effectiveToHeight >= h)`. This handles rotations because a single physical operator/slot
> spans multiple hex windows over time.

#### `OperatorLivenessWindow` (per-operator uptime projection)

Purpose: precomputed signed/missed/proposed counts and uptime% over rolling windows, per
slot/operator, so the operator and network pages are O(1) reads.

- `id BigInt @id`
- `slotId BigInt`
- `operatorAddress String?`
- `windowKind String` — `lifetime` | `epoch` | `rolling_10k` | `rolling_1k` | `daily`
- `windowStartHeight BigInt`
- `windowEndHeight BigInt`
- `expectedBlocks BigInt` — blocks where this slot was in the active set (from timeline)
- `signedBlocks BigInt` — `blockIdFlag == 2` (committed)
- `nilBlocks BigInt` — `blockIdFlag == 3`
- `absentBlocks BigInt` — `blockIdFlag == 1`
- `proposedBlocks BigInt` — `Block.proposerAddress` ∈ this slot's hex windows in range
- `uptimePct Decimal` — `signedBlocks / expectedBlocks` (committed-only numerator)
- `lastSignedHeight BigInt?`, `lastMissedHeight BigInt?`
- `computedAtHeight BigInt`
- Unique: `(slotId, windowKind, windowStartHeight)`
- Indexes: `slotId`, `windowKind`, `uptimePct`

`expectedBlocks` comes from the timeline (only count heights where the slot was actually in
the set — a slot is not "missing" blocks before it activated or after it was removed). This
is the correctness crux that separates an honest uptime number from a naive one.

### 1.4 Projection worker logic (per height, additive to the existing worker)

The existing semantic projection worker (`phase-ab-6:707-757`) gains a liveness stage:

1. For committed height `h` (= containing block − 1), load `BlockSignature` rows.
2. For each signer hex, resolve `(slotId, operator)` via `ValidatorSetTimeline`.
3. Increment per-slot counters in the open `OperatorLivenessWindow` rows: `signedBlocks`
   (flag 2), `nilBlocks` (flag 3), `absentBlocks` (flag 1).
4. Resolve the **expected** set for `h` from the timeline (all slots whose window covers `h`).
   Any expected slot **not** present in `BlockSignature[h]` at all also counts as
   `absentBlocks` (CometBFT may omit absent validators from the array entirely **(inferred —
   in practice absent validators appear with flag 1, but defensive coverage avoids
   undercounting)**).
5. Resolve `Block.proposerAddress` for the **containing** block (height `h+1`) to a slot →
   `proposedBlocks`.
6. Advance the liveness projection cursor only after writes commit (matches
   `phase-ab-6:756`).

Rolling windows are maintained incrementally; `lifetime`/`epoch` windows close on
`epoch_finalized` boundaries (reuse the already-indexed `epoch_finalized` event,
`explorer-data-model.md:453`). Full rebuild = truncate the three tables + replay from height
0 over stored block JSON + `Event` rows (rebuildable per `phase-ab-6:807-814`).

### 1.5 API endpoints (new)

- `GET /api/coreslot/slots/:slotId/liveness` → current uptime windows, last signed/missed
  height, recent per-block signed/missed strip.
- `GET /api/operators/:operatorAddress/liveness` → same, keyed by operator (resolves to slot).
- `GET /api/network/liveness` → network-wide overview: active set size, per-slot uptime
  table, current **halt-risk** indicator (how many slots can go down before <2/3 — for N
  equal-power slots, the chain halts when more than `floor(N/3)` are absent
  simultaneously — **inferred from CometBFT >2/3 rule**), recent missed-block heatmap.

Envelope/pagination per existing rules (`explorer-architecture-proposal.md:420-426`).

### 1.6 UI surface

- **Operator page** (gap #2 host, see §2): a "Liveness" section — uptime% over windows, a
  recent-blocks signed/missed sparkline, proposed-block count, last-missed height.
- **Network Liveness overview** (new nav item under Network or CoreSlot): active set, per-slot
  uptime table sortable by uptime, halt-risk banner (PoA framing, not slashing), missed-block
  timeline. This is also the prime **Monitor** surface called out in the coverage doc
  (`explorer-coverage-and-fix-validation.md:239-241`).

### 1.7 Dependencies

- **Hard prerequisite:** stable generic block ingestion (Phases A–C, **done**) and CoreSlot
  event ingestion + the CoreSlot lifecycle/rotation projections (Phase D / `phase-ab-6`),
  because the `ValidatorSetTimeline` is built from those events. Liveness **cannot** start
  before the CoreSlot semantic projections land — it is the data dependency the sequencing
  section calls out.
- Reuses: `Block`, `Event`, the CoreSlot lifecycle/rotation projections, `ProjectionFailure`,
  `ProjectionCursor` (`phase-ab-6:816-868`).

---

## 2. Gap #2 — Operator self-service page

Reuses already-indexed data + existing snapshots. **One** real new transport capability:
bech32→hex decode for the search box.

- **Data sources:** `ChainClient.getCoreSlotByOperator` / `getCoreSlotByConsensusAddress`
  (status, payout, weight); `getClaimableRewards(slotId, start, end)` (claimable, range-
  explicit — `explorer-coverage-and-fix-validation.md:17-34`); `RewardClaim` rows (claim
  history with correlated `claimTxHash` — `explorer-data-model.md:373-417`); the new
  `OperatorLivenessWindow` (§1).
- **New transport:** implement the deferred **bech32 `twilightvalcons…` → 20-byte → hex**
  decode at the consensus-address boundary (the branch deferred in Fix 3 —
  `explorer-coverage-and-fix-validation.md:91-94,287-288`). This is **the one real place
  bech32 input occurs** (a human pasting their valcons). Decode to lowercase hex, then reuse
  the existing hex path. Operator (`twilight…`) addresses route to `getCoreSlotByOperator`
  unchanged. The search box accepts: operator bech32, consensus bech32 (decode), consensus
  hex (passthrough), or slot id.
- **New storage:** none (consolidation view).
- **API:** `GET /api/operators/:address/overview` (address = operator OR consensus, bech32 or
  hex) → resolved slot, status, claimable, claim history, liveness.
- **UI:** a single "Operator" page; the existing search (`explorer-architecture-proposal.md:403`)
  routes a recognized operator/consensus paste here instead of generic account/slot views.
- **Reuses indexed data?** Yes — only bech32 decode is new. **Depends on** §1 for the liveness
  section.

---

## 3. Gap #3 — Onboarding ("how to become an operator")

Live params + static flow text. No new ingestion.

- **Data sources:** `ChainClient.getCoreSlotParams()` → `authority`, `emergency_authority`,
  `min_active_slots`, `max_active_slots`, `slot_voting_power`, `activation_delay_blocks`,
  `key_rotation_delay_blocks`, `allow_self_registration`, `allow_emergency_below_min_active`
  (`nyks-core/proto/twilight/coreslot/v1/coreslot.proto:42-53`); `getActiveCoreSlots()` and
  `getCoreSlots()` to compute **open slots** = `max_active_slots − active count`;
  `getRewardsParams()` + `getEpochInfo()` + last `epoch_finalized` allocation to derive
  **current reward-per-slot** (emission / eligible_slots; equal-weight v1 —
  `explorer-architecture-proposal.md:342-344`).
- **Register→activate flow:** registration and activation are **authority-gated** msgs
  (`MsgRegisterCoreSlot` carries `authority`; `MsgActivateCoreSlot` carries `authority` —
  `phase-ab-6:179-180`); `allow_self_registration` param signals whether self-registration is
  permitted. State the PoA admission reality: a prospective operator contacts the current
  `authority`; the authority registers (PENDING) then activates (ACTIVE after
  `activation_delay_blocks`). Cite that there is no staking/self-bond path
  (`explorer-integration-handoff.md:8-11,29`).
- **New storage:** none.
- **API:** `GET /api/onboarding` (params + derived open-slots + reward-per-slot snapshot).
- **UI:** "Become an Operator" page (live params card + flow diagram).
- **Reuses indexed data?** Uses live snapshots only; **cheap, no §1 dependency** — can land
  early for fast trust value.

---

## 4. Gap #4 — "How this network works" explainer

Static, in-UI. No data, no ingestion.

- **Content (all citable to chain):** CoreSlot-PoA (validators from x/coreslot, not staking —
  `explorer-integration-handoff.md:8-11,27-31`); no staking/gov/mint/distribution, 501 is
  by-design (`...:20-22`); equal voting power + >2/3 commit ⇒ N-of-N halt model (`...:35-37`);
  rewards = epoch emission split by reward weight, claimable per (slot,epoch)
  (`...:135-142`); **supply-threshold halving, not block-height** (`...:138-140`).
- **New storage / API:** none (static page; may embed `getNextHalving`/`getSupplySchedule`
  for a live halving figure).
- **UI:** "How it works" page in nav.
- **Reuses indexed data?** N/A — **cheapest item, no dependency**; land first.

---

## 5. Gap #5 — Per-operator economics dashboard

Pure projection over already-indexed data (designed in `phase-ab-6`, just not surfaced).

- **Data sources:** `SlotRewards` claim records → `RewardClaim` (`claimed`/`claimedHeight`,
  earned/claimed — `explorer-data-model.md:373-417`); `ClaimableRewards(slotId, start, end)`
  for unclaimed; `RewardClaimProjection.claimTxHash` for claim-history tx correlation
  (`phase-ab-6:540-573`); `RewardWeight` + payout address from `CoreSlotProjection`
  (`phase-ab-6:286-320`).
- **New storage:** none (read-model over `RewardClaim` + `CoreSlotProjection`).
- **API:** `GET /api/operators/:address/economics` (earned/claimable/claimed totals, payout
  address, reward weight, claim history with tx hash). Likely merged into the §2 Operator
  page as its "Economics" section.
- **UI:** Economics section on the Operator page (earned/claimable/claimed, payout, weight,
  claim-history table with linked `claimTxHash`).
- **Reuses indexed data?** Yes, entirely. **Depends on** Phase E rewards projections, **not**
  on §1.

---

## 6. Gap #6 — Authority-action audit log

Projection over already-indexed lifecycle/param events. No new ingestion.

- **Data sources (all already-indexed events):** registrations (`coreslot_registered`);
  suspensions **with `reason`** (`coreslot_suspended` carries `reason` —
  `nyks-core/x/coreslot/keeper/events.go:52-62`); inactivations/removals with reason
  (`...:40-50,64-73`); CoreSlot param updates (`coreslot_params_updated` carries `authority`
  — `...:110-114`; full params from the `MsgUpdateParams` payload — `phase-ab-6:472-501`);
  rewards param/pause/resume (`params_update_queued`/`params_activated`/`rewards_paused`/
  `rewards_resumed`, all carry `authority` — `explorer-data-model.md:453-457`,
  `phase-ab-6:638-705`). These map to the existing `CoreSlotLifecycleEvent`,
  `CoreSlotParameterChange`, `RewardParameterChange`, `RewardPauseResumeEvent` projections
  (`phase-ab-6:328,472,638,673`).
- **New storage:** none required — a **read-model/SQL view** that UNIONs the existing
  projection tables filtered to authority-driven actions, ordered by height. (Optional thin
  `AuthorityAction` materialized view only if query cost demands it — defer per "no thin
  pages" preference.)
- **API:** `GET /api/authority/actions` (paginated, filter by type/authority/slot).
- **UI:** "Authority Actions" audit-log page — the trust surface for a PoA authority
  (`explorer-coverage-and-fix-validation.md:214,252-254`).
- **Reuses indexed data?** Yes, entirely. **Depends on** Phase D/E projections, **not** §1.

---

## 7. Sequencing — recommended stage/phase

### 7.1 What must land first (prerequisites — already done or in-flight)

- **Done:** stable generic block/tx/event indexing (Phases A–C) and the five chain-alignment
  fixes (`explorer-coverage-and-fix-validation.md` Part A — all RESOLVED).
- **Prerequisite for §1, §5, §6:** the CoreSlot semantic projections (Phase D /
  `phase-ab-6`: lifecycle + key-rotation projections) and the rewards projections (Phase E:
  `RewardClaim`, `RewardClaimProjection`, param-change projections). The
  `ValidatorSetTimeline` (§1.3) is built from CoreSlot events, so **liveness cannot start
  before Phase D lands.**

### 7.2 Recommended phase

> **Phase H — Operator Experience** (slots **after Phase E**, **before/overlapping Phase F**
> deployment packaging and **before** Phase G hardening).

Rationale: Phase H consumes Phases D and E (CoreSlot + rewards projections) as hard
dependencies for liveness, economics, and the audit log, so it must follow them. But the
**static** items (§4 explainer, §3 onboarding) have **zero** projection dependency and
deliver outsized trust/legibility value (the coverage doc ranks the explainer #2 and
onboarding #3 by operator-friendliness — `explorer-coverage-and-fix-validation.md:242-247`),
so they should land **as early as Phase C** — i.e., split Phase H so its cheap half runs in
parallel with earlier work and its data-heavy half slots after E. Naming it a distinct phase
(not folding into D/E) keeps the milestone reviewable as a unit and matches the existing
single-letter phase convention (A–G).

### 7.3 What can run in parallel

- §3 Onboarding and §4 Explainer are **static/live-snapshot only** → can be built any time
  after the `ChainClient` params/snapshot methods exist (Phase A/B boundary), in parallel
  with D/E. **Ship these first** for early trust value.
- §1 Liveness ingestion (the transport change + `BlockSignature`) can be added to the indexer
  in parallel with Phase D projection work, **but** the timeline/uptime projection blocks on
  the CoreSlot event projections.

### 7.4 Internal ordering within the milestone (effort/sequence)

1. **First (cheap, parallel, high trust): §4 explainer + §3 onboarding.** Static + live
   params; no projection dependency; small effort; addresses coverage gaps ranked #2 and #3.
2. **Second (data-heavy core): §1 liveness.** Largest effort and the data dependency for the
   operator page. Order: (a) transport `BlockSource.lastCommit` + `BlockSignature` ingest;
   (b) `ValidatorSetTimeline` from CoreSlot events (the hard correctness work — rotations,
   entry/exit, deferred-commit N-1 attribution); (c) `OperatorLivenessWindow` + network
   halt-risk view.
3. **Third (consolidation over existing projections): §2 self-service + §5 economics + §6
   audit log.** §2 needs the new bech32 decode (small) and reuses §1's liveness; §5 and §6
   are pure read-models over Phase D/E projections (low effort once those land). §5 and §6
   can be built in parallel with §1(b)/(c) since they don't depend on liveness.

Rough effort: §4 (XS) · §3 (S) · §6 (S) · §5 (S) · §2 (M, mostly bech32 + page assembly) ·
§1 (L, the milestone's center of gravity).

---

## 8. Inferred vs confirmed — explicit flags

**Confirmed from chain/CometBFT source (cited):** `/block` commit shape and `block_id_flag`
enum values; deferred-commit (last_commit = N-1); proposer hex; CoreSlot event names,
attributes, and hex consensus addresses; key-rotation EndBlock timing and cancellation;
`coreslot_validator_update_emitted` as the applied validator-set signal; CoreSlot `Params`
fields; PoA equal-power/>2/3 model; rewards claim/param event surface.

**Inferred (flagged inline):** the exact off-by-one for when a validator update / rotation
takes signing effect (H vs H+1) — derived from standard ABCI semantics, should be **pinned
with a devnet fixture** (a block straddling an activation/rotation) before the timeline ships;
the precise halt-risk threshold expression (`floor(N/3)`); and the defensive treatment of
validators omitted entirely from the signatures array. None of these affect the storage
model — only the boundary arithmetic the projection worker applies, which is exactly what the
recommended fixtures verify.

**Not verified by running anything:** I did not run the explorer or hit a live node; all
chain claims are source-level reads of `nyks-core` and the vendored `cometbft@v0.38.21`.
