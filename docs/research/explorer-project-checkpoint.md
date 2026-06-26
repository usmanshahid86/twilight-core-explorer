# Twilight Core Explorer Project Checkpoint

Date: 2026-06-26

Status: checkpoint after Phase A/B foundation, descriptor decoder work, chain-alignment
cleanup, the full CoreSlot semantic projection set, temporal consensus map/boundary
corrections, Phase 7 / 7.1 rewards semantic projection, Phase 8a/8b signature
ingestion + attribution, the Phase 8c-0 coverage-truth check, Phase 8c-0b genesis
temporal-map seed, the Phase 8c-0c live one-node liveness drill, and Phase 8c-1 CoreSlot
liveness evidence. The 8c-0 check established that liveness is **CoreSlots-only** and that
genesis CoreSlots emit no indexable event; 8c-0b implements the required height-1 temporal-map
seed; 8c-0c proved an absent validator is anonymous in the commit (so misses are computed by
set-difference); 8c-1 materializes the per-height expected-signer / missed evidence and was
live-validated on a clean 4-operator fixture (1440 rows, 41 slot-4 misses = 39 absent + 2 nil);
8c-2 aggregates that evidence into per-(slot, window) liveness summaries (slot 4 lifetime uptime
8861 bps, recent_100 5900 bps; slots 1-3 = 10000); 8c-3 derives health labels + a network halt-risk
snapshot from those summaries (slots 1-3 healthy, slot 4 degraded, network = warning). A
**live behavioral validation (2026-06-26)** then drove every CoreSlot tx category through the chain
with real `twilightd` transactions and verified the indexer responded — closing the last live-coverage
gaps. A **proposer attribution projection** (`proposer_attribution_v1`) was also added, completing the
validator surface (blocks-proposed per operator). **The entire CoreSlot + liveness + proposer backend
stack (6a/6b/7/8a–8c-3) is complete and live-proven; the next phase is the API (Phase 9).**

This document summarizes what has already been decided and built, what is still only
designed, and the recommended sequence from here. It is intended to keep implementation
aligned for Phase 9 (API) and later web work.

## 1. Product North Star

Twilight Core Explorer is a Twilight-native explorer for:

- CoreSlot PoA validator ownership and lifecycle.
- `x/rewards` epoch emissions, claims, supply, and module balances.
- Native `utwlt` accounting with display symbol `TWLT`.
- CometBFT block, tx, event, node, and consensus data.
- Operator and monitor workflows.

It must not pretend Twilight Core is a standard staking Cosmos chain. The explorer must not
add fake staking, governance, mint, or distribution compatibility. Unsupported standard
module routes are intentional non-goals.

The highest-value user is an operator or monitor who wants to answer:

- Is my CoreSlot active and signing?
- What lifecycle or authority actions happened to my slot?
- What rewards have I earned, claimed, or can claim?
- How does this PoA network work?
- What is the current network halt/liveness risk?

## 2. Architecture Decisions Already Made

The accepted architecture is a production-shaped TypeScript monorepo:

```text
twilight-core-explorer/
  apps/
    indexer/
    api/      future
    web/      future
  packages/
    chain-client/
    config/
    db/
    decoder/
    proto/
    ui/       future
  prisma/
  docs/
```

Key decisions:

- `ChainClient` is the transport boundary. Indexers and processors depend on it, not raw
  REST paths.
- `RestRpcChainClient` is the first implementation: CometBFT RPC + Cosmos REST + Twilight
  REST.
- `GrpcChainClient` remains a future typed transport behind the same interface.
- CometBFT RPC remains mandatory for `/block`, `/tx`, `/block_results`, status, and
  consensus/block history.
- REST is used for module snapshots and browser/debug-friendly reads.
- Swagger/OpenAPI or `docs/reference/rest-routes.md` is the route contract.
- Descriptor-backed protobuf decoding is the current production decoder foundation for raw
  transaction bytes.
- Generated TS/gRPC clients are optional future hardening, not a prerequisite.
- Generic indexed rows are canonical. Semantic projections must be rebuildable from generic
  rows and preserved raw payloads.

## 3. Completed Implementation

### Phase A/B-1: Scaffold and Chain Client

Completed:

- npm workspace scaffold.
- `packages/config`.
- `packages/chain-client`.
- `ChainClient` interface.
- `RestRpcChainClient`.
- Route constants centralized.
- Route-contract tests.
- stale active-slots regression blocked.
- unsupported staking/gov/mint/distribution route usage blocked.

Important correction after review:

- `getClaimableRewards(slotId, startEpoch, endEpoch)` is now range-explicit.
- `getSlotRewards(slotId, pagination?)` supports pagination and `pagination.reverse`.
- CoreSlot consensus routes normalize 40-character hex to lowercase.
- `twilightvalcons...` bech32 is rejected at the low-level transport for now. User-facing
  search can add bech32-to-hex decoding later.

### Phase A/B-2: Indexer Foundation

Completed:

- `packages/db` with Prisma client export.
- PostgreSQL Prisma schema baseline.
- generic tables:
  - `Block`
  - `ExplorerTransaction`
  - `Message`
  - `Event`
  - `Account`
  - `IndexerCursor`
  - `DecodeFailure`
- `apps/indexer` skeleton.
- height-range ingestion.
- mandatory `/block_results` ingestion for every height.
- idempotent upserts.
- cursor update after successful transaction.
- advisory lock helper.
- hash mismatch halt behavior.
- fixture/unit tests for ingestion safety.

Explicitly not implemented:

- CoreSlot semantic projection.
- rewards semantic projection.
- API routes.
- web pages.

### Phase A/B-3: Real Postgres Integration Path

Completed:

- real local Postgres integration testing path.
- test database reset flow.
- Prisma integration validation.
- durable ingest behavior verified beyond mocks.

### Phase A/B-4: Local Chain Range Ingestion Smoke

Completed:

- local Twilight Core localnet smoke.
- explorer-side range ingestion against local RPC/REST.
- idempotency rerun verified.
- block, tx, event, account, and cursor behavior checked.

Known gap found in this phase:

- fallback-ingested custom Twilight txs created transaction/event rows but no message rows
  because raw CometBFT tx bytes were not decoded yet.

### Phase A/B-5: Descriptor Decoder Foundation

Completed:

- `packages/proto`.
- copied Twilight descriptor artifacts:
  - `twilight-descriptors.pb`
  - `twilight-msg-type-urls.json`
  - descriptor README
- `proto:refresh` script.
- `packages/decoder`.
- descriptor-backed `protobufjs` root loading.
- `TxRaw -> TxBody -> Any` raw tx decode.
- type URL helpers.
- fallback raw tx decode integrated into indexer.
- fallback-ingested custom txs now create `Message` rows.
- decode failures recorded without halting ingestion.
- local smoke rerun passed with `Message >= 1`.

Explicitly not implemented:

- semantic CoreSlot/rewards projections.
- generated gRPC clients.
- API/web.

### Chain-Alignment Cleanup

Completed after external review:

- claimable rewards range bug fixed.
- slot rewards pagination path added.
- consensus address normalization added.
- claim truth docs corrected:
  - `SlotRewards.claimed` is per-record claim truth.
  - `ClaimableRewards` returns only currently unclaimed records for an explicit range.
  - `reward_claimed` events provide tx history/correlation.
  - `EpochReward` is aggregate/finalization context, not current claim truth.
- stale buf/ts-proto/Telescope recommendation replaced with descriptor-backed decoder path.

Validation passed:

- `npm --prefix packages/chain-client test`
- `npm run typecheck`
- `npm test`
- `npm run lint`
- stale active-slots route guard
- unsupported standard route guard

### Phase 6a-1: CoreSlot Metadata Projection Proof Slice

Completed:

- first rebuildable CoreSlot semantic projection slice.
- `coreslot_metadata_v1` projection cursor and failures.
- `CoreSlotMetadataChange` append-only history.
- metadata-owned updates to `CoreSlotProjection`.
- message + event correlation for `/twilight.coreslot.v1.MsgUpdateOperatorMetadata` and
  `coreslot_metadata_updated`.

Evidence:

- Local smoke over heights 119..121 confirmed the first semantic projection path over the
  metadata-only range. One metadata tx produced one `CoreSlotMetadataChange`, one
  `CoreSlotProjection`, zero `ProjectionFailure` rows, and an idle `ProjectionCursor` at
  height 121. This confirms the message-payload plus event-effect projection pattern on the
  real smoke fixture.

### Phase 6a-2: CoreSlot Lifecycle Projection

Completed:

- `coreslot_lifecycle_v1` projection cursor and failures.
- `CoreSlotLifecycleEvent`.
- lifecycle projection for register, activate, inactivate, suspend, and remove events.
- lifecycle-owned updates to `CoreSlotProjection`.
- successful-transaction filtering and idempotent fixture coverage.

Still deferred:

- key rotation and temporal consensus map.
- payout / params generalization.
- rewards, liveness, API routes, and web pages.

### Phase 6a-3: CoreSlot Payout / Params Projection

Completed:

- `coreslot_payout_v1` projection.
- `coreslot_params_v1` projection.
- `CoreSlotPayoutChange`.
- `CoreSlotParameterChange`.
- payout projection for `/twilight.coreslot.v1.MsgUpdatePayoutAddress` +
  `coreslot_payout_updated`.
- params projection for `/twilight.coreslot.v1.MsgUpdateParams` +
  `coreslot_params_updated`.
- payout-owned update to `CoreSlotProjection.payoutAddress`.
- params stored as global module-change history without mutating `CoreSlotProjection`.
- deterministic `ProjectionFailure.failureKey` upserts across metadata, lifecycle, payout,
  and params projections.

Explicitly not implemented:

- key rotation projection.
- temporal consensus map.
- rewards, liveness, API routes, and web pages.

### Phase 6a-4: Combined CoreSlot Semantic Rebuild

Completed:

- combined CoreSlot semantic reset/rebuild command.
- deterministic replay order for currently implemented CoreSlot projections:
  1. metadata
  2. lifecycle
  3. payout
  4. params
- combined reset for CoreSlot semantic rows only.
- generic canonical rows are preserved.
- each projection keeps its own `ProjectionCursor`.
- combined rebuild reuses existing per-projection range helpers; projector logic was not
  rewritten.

Explicitly not implemented:

- key rotation projection.
- temporal consensus map.
- rewards, liveness, API routes, and web pages.

### Phase 7 / 7.1: Rewards Semantic Projection

Status: PASS and merge-ready.

Completed:

- `rewards_semantic_v1` rebuildable projection from generic indexed `ExplorerTransaction`,
  `Message`, and `Event` rows.
- `RewardEpochProjection` for `epoch_finalized` aggregate context. `EpochReward` /
  `epoch_finalized` is not treated as claim truth.
- `RewardClaimEvent` from `MsgClaimRewards` + `reward_claimed` correlation.
- rewards params, pause/resume, and treasury event history.
- `rewards_snapshot_v1` observed-sample path tied to `sampledAtHeight`.
- `SlotRewardProjection` observed slot reward samples with explicit claim reconciliation.
- `RewardsBalanceSample` observed module/cumulative samples.
- `RewardsBalanceSample` nullable-upsert bug fixed with deterministic non-null `sampleKey`.
- `getSlotRewards` pagination fixed by following `pagination.next_key`.
- live rewards snapshot smoke passed against local RPC/REST/Postgres.
- rewards reset preserves generic canonical rows and CoreSlot semantic rows.

Remaining open item:

- Phase 7.2 live `MsgClaimRewards` / `reward_claimed` fixture. This is pending a finalized
  claimable epoch; the localnet used for Phase 7 / 7.1 had no finalized claimable rewards.
  Synthetic tests cover claim correlation, but live claim behavior still needs evidence
  before rewards API/web or public operator-economics pages rely on claim behavior.

Sequencing:

- Phase 7.2 does not block Phase 8a block-signature ingestion.
- Phase 7.2 should be completed before rewards API/web/operator-economics pages expose claim
  behavior as production-ready.

### Phase 8a: Block Signature Ingestion Foundation

Status: PASS.

Completed:

- `block_signatures_v1` projection.
- `BlockSignature` derived rows from indexed `Block.rawJson`.
- deterministic `signatureKey` upserts.
- scoped `BlockSignature` reset command.
- projection cursor/failure behavior.
- raw signature JSON preservation.
- lowercased 40-character hex `validatorAddress` normalization.
- raw and numeric `block_id_flag` preservation.
- absent / commit / nil vote distinction.
- optional local DB smoke over heights `119..3585` produced 131 `BlockSignature` rows,
  zero unresolved `block_signatures_v1` failures, and an idle cursor at height `3585`.

Height semantics:

- `sourceBlockHeight` is the containing block height `N`.
- `committedBlockHeight` comes from `last_commit.height` when present.
- fallback is `sourceBlockHeight - 1` only when `last_commit.height` is absent.
- `last_commit.signatures` in block `N` are signatures for the committed block, normally
  `N - 1`.

Explicitly not implemented:

- liveness percentages.
- missed-count calculations.
- proposer enrichment.
- API routes.
- web pages.

### Phase 8b: Signature-To-CoreSlot Attribution Foundation

Status: PASS.

Completed:

- `operator_signing_evidence_v1` projection.
- `OperatorSigningEvidence` derived rows from `BlockSignature`.
- deterministic `signatureKey` upserts.
- scoped attribution reset command.
- projection cursor/failure behavior.
- attribution by `committedBlockHeight`, not `sourceBlockHeight`.
- temporal lookup via `findConsensusWindowAtHeight`.
- read-only coverage-existence check to distinguish `no_consensus_window` from
  `unmapped_validator`.
- historical `slotId`, `operatorAddress`, `consensusPower`, and `consensusWindowId` from
  `CoreSlotConsensusWindow`, not current `CoreSlotProjection`.
- explicit statuses: `attributed`, `absent_no_validator`, `no_consensus_window`,
  `unmapped_validator`, `invalid_validator_address`, and `unknown_shape`.

Height semantics:

- range/cursor axis follows Phase 8a: containing block `sourceBlockHeight`.
- attribution axis uses `committedBlockHeight`.
- proposer semantics remain out of scope.

Explicitly not implemented:

- liveness percentages.
- missed-count calculations.
- proposer enrichment.
- API routes.
- web pages.

### Phase 8c-0: Coverage-Truth Check (analysis + scope decision)

Status: DONE (no projection/model added). See
`docs/research/phase-8c-0-coverage-truth-report.md`.

Established before building liveness:

- Ran the deferred Phase 8b live smoke: `OperatorSigningEvidence` = 131 rows (1:1 with
  `BlockSignature`), zero unresolved failures, cursor idle at 3585. `attributed` rows are
  exclusively slot 4 / `f060` over committed heights 3569–3583 (its reactivation window). 8b is
  confirmed correct on real data; the "smoke not run" caveat is discharged.
- **Scope decision: liveness is CoreSlots-only.** The localnet consensus set is 4 PoA validators,
  but only 2 are CoreSlots (slot 1 registered/never-active; slot 4 the one active operator). The
  three remaining genesis validators are not CoreSlots and are out of scope. The expected signer set
  is the **active-CoreSlot** set, NOT the consensus commit set; a completeness check against
  `commitSetSize` would be wrong.
- **Genesis seeding is a structural prerequisite (verified in node source).** `InitGenesis`
  (`x/coreslot/keeper/genesis.go:22-41`) writes slot state directly with no lifecycle emitters; its
  one event fires in `InitChain` (`module.go:79-82`), which CometBFT does not surface in
  `/block_results`. So genesis CoreSlots are invisible to an event-only temporal map and must be
  seeded from `/genesis` app_state. This blocks Phase 8c-1.
- Current local DB is a sparse smoke set (36 non-contiguous blocks, 119–3585). Recommended fixture
  reset: restart localnet with 4 genesis CoreSlot operators and re-ingest contiguously from height 1.

## 4. Designed But Not Yet Implemented

> **Note (2026-06-26):** this whole section is historical — the CoreSlot semantic design below is
> fully implemented (Phases 6a/6b) and live-exercised. Retained for design rationale only.

### Phase A/B-6: CoreSlot Semantic Projection Design

Designed:

- `CoreSlotProjection`.
- `CoreSlotLifecycleEvent`.
- metadata/payout/params change projections.
- consensus key rotation projection.
- projection cursor.
- projection failures.
- rebuild-from-generic-rows invariant.
- message + event correlation strategy.
- metadata-first proof slice using real A/B-5 smoke data.

Reviewed and accepted refinements:

- Use events/snapshots as primary source for `consensus_address`.
- Pubkey Any decoding is now possible from descriptors, but should be fallback/enrichment.
- Build a temporal `consensusAddress -> slotId/operator` map once and reuse it for liveness,
  proposer enrichment, block pages, and operator pages.
- `ProjectionFailure` should capture drift/correlation issues instead of silently mutating.
- Filter semantic projections to successful transactions only.
- Enrich `Account.accountKind` where cheap and clear: operator, payout, authority, module.

Hard fixture needs before full confidence (**all live-exercised 2026-06-26**):

- ~~delayed `key_rotation_requested` tx to later EndBlock `key_rotated`~~ — done (slot 3 rotation,
  applied at +1, window switch at +2).
- ~~queued params to later `params_activated`~~ — `update-params` exercised live (applied immediately
  with `activation_delay_blocks=0`; emitted `coreslot_params_updated`).

### Operator Experience Milestone

Designed:

- operator self-service page.
- per-operator liveness/uptime.
- onboarding page.
- "How this network works" explainer.
- per-operator economics.
- authority-action audit log.

Important conclusion:

- Most operator UX is pages/API over already-built projections.
- **The per-operator liveness data dependency is now fully satisfied** — `CoreSlotHealthSnapshot`
  (per-operator health/uptime/streaks) + `NetworkLivenessRiskSnapshot` (network halt-risk) plus the
  lifecycle/payout/metadata/key-rotation/rewards projections cover every operator-page need. Operator
  UX is now purely API (Phase 9) + web (Phase 11) work over existing data.

## 5. Known Gaps

### Data Gaps

1. ~~Block commit signatures and CoreSlot attribution are stored, but liveness is not computed.~~
   **RESOLVED.** 8a `BlockSignature` → 8b `OperatorSigningEvidence` → 8c-1 per-height evidence →
   8c-2 summaries → 8c-3 health + network halt-risk. Full stack live-validated.

2. ~~Temporal consensus-address map is not genesis-complete.~~ **RESOLVED** by Phase 8c-0b
   (genesis-baseline seed of `CoreSlotConsensusWindow` from `/genesis` app_state, one ACTIVE window
   per genesis slot at `effectiveFromHeight = 1`, then event replay). Genesis windows and the
   `validatorUpdateHeight + 2` boundary are live-proven (see Open Question #1). Liveness is
   CoreSlots-only.

3. Snapshot tables must be categorized clearly.
   - Rebuildable derived projections are different from observed live samples.
   - Module balance snapshots should be treated as observed samples unless tied to a
     specific indexed event/height.

4. User-facing bech32 consensus address decoding is deferred.
   - Low-level transport can reject bech32.
   - Search/self-service should eventually decode `twilightvalcons...` to lowercase hex.

5. Phase 7.2 live rewards claim fixture is still open.
   - Phase 7 / 7.1 is merge-ready, and live rewards snapshot smoke passed.
   - A real `MsgClaimRewards` / `reward_claimed` fixture has not been exercised because the
     localnet had no finalized claimable rewards.
   - Implement once at least one epoch has finalized and
     `getClaimableRewards(slotId, startEpoch, endEpoch)` returns a non-empty range.
   - This does not block Phase 8a block-signature ingestion, but it should be completed
     before rewards API/web/operator-economics pages rely on live claim behavior.

6. ~~Phase 8c must preserve the attribution taxonomy from Phase 8b.~~ **RESOLVED in 8c-1.** Missed =
   expected active CoreSlots minus flag-2 signed evidence (set-difference); `no_consensus_window` /
   `unmapped_validator` / `absent_no_validator` are kept out of missed semantics. Both ABSENT and NIL
   count as missed with the cause retained. Live-validated (41 slot-4 misses = 39 absent + 2 nil).

### Proposer and signature height semantics

Block proposer and commit signatures have different height semantics:

- `header.proposer_address` belongs to block height `N`.
- `last_commit.signatures` included in block `N` are signatures for the committed block
  `N-1`.

Liveness projection must attribute signatures from block `N` to height `N-1`, but proposer
enrichment must not shift the proposer address. The proposer in block `N` remains the
proposer for block `N`. **Implemented** in `proposer_attribution_v1`: commit-signature attribution
(8b) uses `committedBlockHeight` (≈ N-1), while proposer attribution joins at the block's own height
N — the two height axes are kept distinct.

### UX Gaps

1. No operator liveness/uptime UI.
2. No consolidated operator page.
3. No onboarding page explaining how to become an operator.
4. No "How Twilight Core works" page.
5. No authority-action audit log page.
6. No tokenomics/halving visualization.

These are not reasons to redesign the foundation. They should be explicit later milestones.

### Resolved Engineering TODOs

#### Combined CoreSlot semantic rebuild command

Completed in Phase 6a-4 for the currently implemented CoreSlot projection set:

1. metadata
2. lifecycle
3. payout
4. params

The command resets and replays CoreSlot semantic state in deterministic order while
preserving generic canonical rows.

Future Phase 6b projections must extend this command rather than creating a second rebuild
path. The expected future order is:

0. genesis seed (temporal-map baseline from `/genesis` app_state — see Phase 8c-0)
1. metadata
2. lifecycle
3. payout
4. params
5. key rotation
6. temporal consensus map (genesis seed first, then event replay)

#### Deterministic ProjectionFailure keys

Completed in Phase 6a-3.

Semantic failure writes now use deterministic `failureKey` upserts across metadata,
lifecycle, payout, and params projections. This prevents unresolved failure rows from
accumulating on idempotent reruns over malformed or ambiguous data.

Future projections must continue using the same pattern.

## 6. Recommended Remaining Phases

### Phase 6a: CoreSlot Semantic Projection (completed)

Done across Phases 6a-1 through 6a-4: metadata, lifecycle, payout, and params projections,
deterministic `failureKey` upserts, and the combined CoreSlot semantic rebuild command. See
the completed implementation section above. Not in scope here: key rotation, temporal
consensus map, rewards, liveness, API/web.

### Phase 6b: Key Rotation and Temporal Consensus Map (completed)

Done: `coreslot_key_rotation_v1` (`CoreSlotConsensusKeyRotation`) and the temporal consensus map
(`CoreSlotConsensusWindow`, `coreslot_temporal_map_v1`) with the `validatorUpdateHeight + 2` boundary
and the 8c-0b genesis seed. Key rotation + window close/reopen are **live-proven** (behavioral
validation). The design notes below are historical.

Recommended split (delivered):

1. Phase 6b-1: key rotation projection.
2. Phase 6b-2: temporal consensus map / validator-set timeline.

Scope:

- `MsgRotateConsensusKey`.
- `coreslot_key_rotation_requested`.
- `coreslot_key_rotated`.
- `coreslot_rotation_cancelled`.
- delayed active-slot rotation behavior.
- event-only EndBlock rotation application.
- validator update event handling where needed for effective set windows.
- `consensusAddress -> slotId/operator` windows.

This phase unlocks:

- proposer-to-slot joins.
- block proposer enrichment.
- liveness projection.
- operator timeline.
- authority-action views.

### Phase 7: Rewards Semantic Projection (completed)

Goal:

- Implement rewards projections.

Scope:

- reward epochs.
- claim records from `SlotRewards`.
- claimable range checks from `ClaimableRewards`.
- claim tx correlation from messages/events.
- cumulative emitted and supply context.
- module balance observed samples.
- rewards pause/resume and params events.

Do not treat `EpochReward` as claim truth.

Completed in Phase 7 / 7.1. Remaining evidence task is Phase 7.2 live rewards claim
fixture, which is not a merge blocker for Phase 7 / 7.1.

### Phase 7.2: Live Rewards Claim Fixture

Goal:

- Exercise live claim behavior once a finalized claimable epoch exists.

Scope:

- wait for or configure a finalized epoch.
- query claimable rewards for one active slot.
- submit `MsgClaimRewards`.
- index the tx/event.
- run `rewards_semantic_v1`.
- verify `RewardClaimEvent` exists.
- verify matching `SlotRewardProjection` rows reconcile if sampled rows exist.
- verify no fabricated amounts.
- verify idempotent rerun.

Sequencing:

- Does not block Phase 8a block-signature ingestion.
- Should be completed before rewards API/web/operator-economics pages expose claim behavior
  as production-ready.

### Phase 8a: Block Signature Ingestion (completed)

Goal:

- Add canonical-adjacent block signature data.

Scope:

- parse `block.last_commit.signatures` from stored/fetched block raw JSON.
- store `BlockSignature`.
- attribute signatures to committed height N-1.

No staking validator APIs.

Completed in Phase 8a as `block_signatures_v1`. It stores raw commit-signature evidence only:
no CoreSlot attribution, liveness score, proposer enrichment, API, or web work.

### Phase 8b: Signature-To-CoreSlot Attribution (completed)

Goal:

- Add operator/CoreSlot attribution for observed commit-signature evidence.

Scope:

- consume `BlockSignature` rows.
- join validator addresses to `CoreSlotConsensusWindow` by committed height.
- store `OperatorSigningEvidence`.
- keep no-window/unmapped/absent rows separate from missed signatures.

No staking validator APIs.

Completed in Phase 8b as `operator_signing_evidence_v1`. It stores attribution evidence
only: no liveness score, missed-count calculation, proposer enrichment, API, or web work.

### Phase 8c-0b: Genesis Temporal-Map Seed (completed)

Goal:

- Make the temporal map genesis-complete so the expected CoreSlot signer set is trustworthy.

Scope:

- added `ChainClient.getGenesis()` over CometBFT `/genesis`, with `/genesis_chunked` fallback for
  large genesis responses.
- parse `app_state.coreslot.{slots, params, reward_weights, reserved_consensus_addresses,
  pending_key_rotations}`.
- seed one ACTIVE `CoreSlotConsensusWindow` per genesis slot with `status==ACTIVE`,
  `effectiveFromHeight = 1` (no `+2` offset for the genesis baseline), then replay event deltas.
- derive consensus address from `consensus_pubkey` when genesis omits a precomputed
  `consensus_address`.
- rebuildable, idempotent, `ProjectionFailure` on any unmappable genesis slot.

Result:

- genesis seed runs as step 0 of `coreslot_temporal_map_v1`.
- combined CoreSlot semantic rebuild passes the ChainClient into temporal-map replay and runs
  `metadata -> lifecycle -> payout -> params -> key_rotation -> temporal_map(seed -> replay)`.
- no new Prisma model was needed; the seed reuses `CoreSlotConsensusWindow`.
- inactive/keyless genesis slots are skipped without failure; active missing/invalid consensus
  addresses fail deterministically.
- local sparse smoke over 119..3585 confirmed four genesis windows at height 1, zero temporal-map
  failures, slot 4's seeded `f060...` window closing at 3556, and attribution improving to
  `130 attributed / 1 absent_no_validator / 0 unresolved failures`.

This removes the Phase 8c-1 blocker at the design/code level. A fresh contiguous localnet fixture
with active genesis CoreSlot operators is still recommended before using liveness evidence as a
product signal.

### Phase 8c-0c: Live One-Node Liveness Drill (completed)

Status: DONE (analysis + live evidence; no projection added). See
`docs/research/phase-8c-0c-liveness-drill-report.md`. Stopped one of four CoreSlot operators
(slot 4) on the clean fixture and re-ingested. Key empirical finding: an absent validator is
**anonymous in the commit** — flag-1 ABSENT entries carry an empty `validator_address`, so 8b
classifies them `absent_no_validator`. Misses therefore **must** be computed by set-difference
(expected active CoreSlots minus flag-2 signed observations), never read off a flag. NIL (flag 3)
entries are address-bearing and identifiable but still missed. This fixed the 8c-1 design.

### Phase 8c-1: Liveness — Expected Set + Missed Evidence (completed)

Status: **PASS.** See `docs/research/phase-8c-1-coreslot-liveness-report.md`. Implemented
`coreslot_liveness_v1` / `CoreSlotLivenessEvidence`: one row per (committed height, active CoreSlot),
`signed` | `missed` with cause `absent` | `nil`.

- consumes materialized `OperatorSigningEvidence` + genesis-seeded `CoreSlotConsensusWindow` only
  (no live RPC/genesis/validator-set reads).
- expected signers = active CoreSlots at committed H via new
  `findActiveCoreSlotWindowsAtHeight` (CoreSlots-only, not the consensus commit set).
- missed = expected active CoreSlots minus flag-2 signed evidence; both ABSENT and NIL are missed,
  cause retained. Committed heights read from `OperatorSigningEvidence.committedBlockHeight`, never
  derived. Cursor axis = `sourceBlockHeight` (matches 8a/8b).
- per-height compute→validate→write with hard height-level guards (absent-count mismatch, duplicate
  expected/signed slot, nil+signed same slot, attributed-not-expected). Failure policy: a hard
  failure invalidates the committed height — existing rows for H are deleted, no new rows are
  written, and a deterministic `ProjectionFailure` is recorded; processing continues.
- live-validated on the 4-operator fixture (heights 1..361): 1440 rows, 1399 signed, 41 missed (all
  slot 4: 39 absent + 2 nil), 0 unresolved failures.

No staking validator APIs. Uptime %, rolling summaries, current health, proposer enrichment, API,
and web remain deferred to Phase 8c-2+.

### Phase 8c-2: Liveness Summaries (completed)

Status: **PASS.** See `docs/research/phase-8c-2-coreslot-liveness-summaries-report.md`. Implemented
`coreslot_liveness_summary_v1` / `CoreSlotLivenessSummary`: rebuildable aggregates over
`CoreSlotLivenessEvidence`, one row per `(slotId, windowKind)` for
`{lifetime, recent_100, recent_500, recent_1000}`. Numeric only (health labels → 8c-3).

- consumes `CoreSlotLivenessEvidence` only (+ `ProjectionFailure` for coverage); no live RPC/genesis/
  validator-set, no re-reading 8a/8b, no proposer/API/web.
- prerequisite: added reusable `ProjectionFailure.committedHeight`; 8c-1 now stamps the exact
  committed height on height-level failures, so summaries map invalidated heights precisely.
- per-(slot,window): expected/signed/missed/absent/nil counts, `uptimeBps =
  floor(signed*10000/expected)`, signed/missed streaks, latestMissedHeight, coverage
  (first/last/span/evidence counts), and `invalidHeightCount`/`summaryStatus` (exact, coverage-only —
  never changes counts). recent_N = trailing N present evidence heights (sparse-safe).
- full recompute + delete-all/createMany; scoped reset; standalone CLI after `coreslot_liveness`.
- live-validated (1440 evidence rows → 16 summaries): slots 1-3 lifetime uptime 10000; slot 4
  lifetime 8861 bps (319/360), recent_100 5900 bps (59/100), recent_500/1000 = lifetime; 0
  incomplete, 0 unresolved failures.

Health labels/thresholds, network halt-risk, per-operator grain, API, and web remain deferred.

### Phase 8c-3: CoreSlot Health / Network Halt-Risk (completed)

Status: **PASS.** See `docs/research/phase-8c-3-coreslot-health-report.md`. Implemented
`coreslot_health_v1` writing `CoreSlotHealthSnapshot` (per active CoreSlot) +
`NetworkLivenessRiskSnapshot` (single latest). Policy layer over 8c-2; numeric truth stays in the
summaries.

- consumes `CoreSlotLivenessSummary` + `CoreSlotConsensusWindow` (active set via
  `findActiveCoreSlotWindowsAtHeight`) + `ProjectionFailure`; no BlockSignature/OperatorSigningEvidence,
  no live reads, no proposer/API/web, equal-power v1.
- health from recent_100 (lifetime/recent_500/recent_1000 = context); strict precedence
  unknown → incomplete → down(streak≥10) → degraded(streak 1-9 / recent misses) → healthy. Constants
  `degradedUptimeBps 9900`, `downMissedStreak 10`, versioned `coreslot_health_policy_v1`.
- active set = temporal-map windows at networkLatestHeight; only active slots emitted; active-without-
  summary → unknown/missing_summary; an active unknown/incomplete slot forces network
  unknown/coverage_unknown.
- network halt-risk (equal power): unknown(no_slots/coverage) → critical(avail ≤ 6666 bps) →
  warning(down/degraded present) → normal; single deterministic latest row.
- live-validated: slots 1-3 healthy, slot 4 degraded (recovered, streak 0 → not down), network
  warning, availablePowerBps 10000, 0 failures.

API, web, per-operator grain, consensusPower weighting, historical network snapshots remain deferred.

### Live Behavioral Validation (completed)

Status: **PASS (all categories).** See `docs/research/phase-8c-live-behavioral-validation-report.md`
and runbook Part G (`docs/research/localnet/fixture-reset-runbook.md`). Drove the live 4-CoreSlot
localnet with REAL `twilightd coreslot` transactions (no DB manipulation) and verified the indexer's
derived rows for every category: metadata, payout, params, lifecycle (inactivate→reactivate),
suspend→reactivate, key rotation (with node restart), and add+remove operator. Results:

- The `validatorUpdateHeight + 2` membership boundary is **empirically proven** for inactivate,
  reactivate, suspend, and key rotation — every `/validators` transition matched `txHeight + 2`.
- The genesis-window **close** path ran on live data for the first time (closes Open Question #1).
- Inactive/suspended ≠ missed (window-closed slot produces no missed rows); attribution follows the
  slotId across a key rotation; the anonymous-absent set-difference correctly attributes a
  freshly-added operator's misses → `down`; health/halt-risk react correctly.
- Zero unresolved `ProjectionFailure` across the entire run. Operational gotchas recorded
  (`query tx` unreliable → verify via indexer; `update-params` needs numeric int64 fields; shared
  advisory lock needs a gap between projection runs; swap only `priv_validator_key.json` on rotation).

### Proposer Attribution (completed)

Status: **PASS.** Implemented `proposer_attribution_v1` / `BlockProposerAttribution` — one row per
block height attributing `Block.proposerAddress` to historical CoreSlot ownership via the temporal
map. Completes the validator surface (the proposer side, complementing the commit-signature side).

- the proposer of block N belongs to height **N** (no `-1` shift, unlike commit signatures) — the
  join uses `findConsensusWindowAtHeight(proposerAddress, N)`.
- `Block.proposerAddress` is CometBFT **uppercase** hex; window `consensusAddress` is lowercase — the
  projector lowercases before the join (raw uppercase preserved in `rawProposerAddress`).
- statuses mirror 8b: `attributed`, `unmapped_validator`, `no_consensus_window`, `missing_proposer`,
  `invalid_proposer_address`. Rebuildable, idempotent, scoped reset, deterministic `ProjectionFailure`.
- consumes `Block` + `CoreSlotConsensusWindow` only; no live reads. Standalone CLI, run after the
  temporal map.
- live-validated over the fixture: **3196/3196 attributed**, 0 unmapped/no-window/failures;
  blocks-proposed per operator (slot 3's count continuous across its key rotation — both consensus
  addresses attribute to the same slotId).

### Sequencing note: rewards and liveness

Rewards and liveness can proceed in parallel after the CoreSlot temporal map exists. Rewards
depends mostly on rewards rows and generic tx/event data; liveness depends on block
signatures plus the temporal consensus map. They do not need to block each other. Because
liveness is a primary operator-facing gap, it may be pulled level with or ahead of rewards
once the temporal map is ready.

### Phase 9: API Foundation

Goal:

- Expose indexed data through a stable explorer API.

Scope:

- health/live/ready.
- indexer status and lag.
- blocks and block detail.
- txs and tx detail.
- accounts and balances.
- search.
- CoreSlot projections.
- rewards projections.
- operator liveness/economics.

### Phase 10: Web Foundation and Generic Explorer

Goal:

- Build the web app shell and generic explorer pages.

Scope:

- dark Twilight theme adapted from reference explorer.
- dashboard.
- blocks.
- txs.
- accounts.
- search.
- supply/network/API status.

Do not bring old zkOS/dark-pool/BTC bridge pages forward.

### Phase 11: Twilight-Specific Pages

Goal:

- Build CoreSlot, rewards, and operator-facing pages.

Scope:

- CoreSlot list/detail.
- lifecycle timeline.
- key rotation/payout/metadata history.
- rewards overview.
- epoch detail.
- claims.
- operator self-service page.
- operator economics.
- authority-action audit log.
- network liveness view.
- tokenomics/halving view.

### Phase 12: Operator Education and Onboarding

Goal:

- Make the explorer understandable to humans who do not already know the chain.

Scope:

- "How Twilight Core works".
- "Become an Operator".
- live CoreSlot params.
- open slots.
- authority/emergency authority explanation.
- register-to-activate flow.
- no-staking/no-gov/no-mint/no-distribution explanation.

This can be built earlier once API/web scaffolding exists because it is mostly static plus
live params.

### Phase 13: Deployment and Production Hardening

Goal:

- Make the system deployable and operable.

Scope:

- Docker Compose / production packaging.
- migration/deploy workflow.
- nginx/TLS later.
- indexer lag monitoring.
- retry/backoff.
- reindex/reset workflow.
- gap detection and missing-height repair.
- DB backup strategy.
- rate limiting.
- multi-RPC fallback.
- deeper integration tests.
- optional `GrpcChainClient`.

Sequencing: some reliability hardening should move earlier than final deployment hardening.
Gap detection, indexer lag monitoring, and basic live-node smoke checks should exist before
public API/web exposure. Retry/backoff and multi-RPC fallback can be staged later but should
not be forgotten.

## 7. Updated Phase Count

The entire backend/projection stack is complete: CoreSlot semantic (6a), key rotation + temporal map
(6b), rewards (7/7.1), and the full liveness stack (8a → 8b → 8c-0b/0c → 8c-1/2/3), all live-proven.

Remaining:

- MVP usable explorer: ~3 phases — **API foundation (9)**, web foundation (10), Twilight-specific
  pages (11).
- Production-grade operator explorer: ~5 phases — the above + operator education/onboarding (12) and
  deployment/hardening (13).

Open evidence tasks (not phase blockers): Phase 7.2 live rewards-claim fixture; and the optional
broader liveness drills (multi-node halt → network `critical`; rotation-mid-outage).

Dependencies that must not be blurred:

- operator economics depends on rewards projection (built; 7.2 for live claims).
- authority audit depends on lifecycle/params projections (built).
- per-operator liveness/health pages depend on 8c-3 (built).
- onboarding/explainer can land early once the web/API shell exists.

## 8. Current Open Questions

1. ~~What is the exact validator-set effective boundary for activation/key rotation?~~
   **RESOLVED — live-proven (2026-06-26 behavioral validation).** `validatorUpdateHeight + 2` is the
   confirmed boundary, now empirically matched against live `/validators` for inactivate (3010→drop
   3012), reactivate (3017→return 3019), suspend (3187→drop 3189), reactivate (3190→return 3192), and
   key rotation (applied 3049→window switch 3051). The genesis-window **close** path ran on live data
   (slot 4 genesis window closed at 3012; slot 2/3 genesis windows closed on suspend/rotation), and
   **remove** was exercised (slot 5 register→activate→inactivate→remove). Do not use `H+1`.

2. ~~Should `BlockSignature` be added as generic indexed data or projection data?~~
   **RESOLVED.** Implemented as the rebuildable projection `block_signatures_v1`, parsed from stored
   `Block.rawJson` `last_commit.signatures` (no new RPC call to rebuild). Canonical-adjacent but
   derived/rebuildable, consistent with the projection model.

3. How much bech32 consensus-address decoding should live in `packages/chain-client`?
   - Recommended: low-level transport remains hex-only; API/search layer normalizes user
     paste input.

4. Should module balance snapshots be materialized in the same projection namespace?
   - Recommended: mark them as observed samples, not rebuildable semantic truth.

5. Which operator pages should ship first?
   - Recommended: "How it works" and onboarding first for trust, then operator self-service
     once liveness/economics data exists.

## 9. Guardrails Going Forward

- Do not add staking/delegation/governance/mint/distribution models.
- Do not call unsupported standard module REST routes.
- Do not bypass `ChainClient` from indexer/processors.
- Do not mutate generic rows from semantic projectors.
- Do not make semantic projections non-rebuildable without documenting why.
- Do not treat failed tx messages as successful semantic state changes.
- Do not treat `EpochReward` as current claim truth.
- Do not build liveness from current snapshots only; it must be historical and temporal.
- Liveness is CoreSlots-only: the expected signer set is the active-CoreSlot set, never the full
  consensus commit set. Do not enumerate non-CoreSlot consensus validators as expected signers or
  misses, and do not gauge completeness by comparing window count to `commitSetSize`.
- The temporal map must be genesis-seeded from `/genesis` app_state (genesis CoreSlots emit no
  indexable event). Seed one ACTIVE window per genesis slot at `effectiveFromHeight = 1` (no `+2`
  offset for the genesis baseline), then replay events on top. Keep it rebuildable — genesis is fixed.
- For block-height validator-set membership, CoreSlot temporal windows use
  `validatorUpdateHeight + 2`, based on Phase 6b-3 live localnet evidence and live-confirmed by
  the Phase 6b-4 rerun (reactivation 3567->3569, rotation 3582->3584 matched
  `/validators?height`). Do not use `H+1` for liveness/proposer block-height attribution.
- Do not revive old zkOS/dark-pool/BTC bridge product pages.
- Tolerate unknown future Msg and event types. Store raw payloads, record
  `unknown_semantic_type` or an equivalent `ProjectionFailure` where semantic interpretation
  is expected, and continue. Unknown semantic types must not crash indexing/projection or be
  silently treated as successful known state changes. (Guardrail, not a fully implemented
  behavior yet.)
- Maintain at least one live-node integration smoke path for chain-alignment-sensitive
  behavior. Assumption-only tests are not enough for custom Twilight routes, message
  decoding, event attributes, delayed rotations, and liveness boundary behavior. Phase 6b
  and Phase 8 should use live/localnet fixtures for delayed rotation and signature
  attribution.

## 10. Immediate Next Step

Recommended next implementation step:

**Phase 9: API foundation** — the full liveness backend stack (8a → 8b → 8c-0b/0c → 8c-1 → 8c-2 →
8c-3) is complete and live-validated, so the next step is exposing indexed/derived data through a
stable explorer API (health/live/ready, indexer status, blocks/txs/accounts/search, CoreSlot +
rewards projections, operator liveness/health/economics). Web (Phase 10) and Twilight-specific pages
(Phase 11) follow.

The operator-liveness data dependency that gated the operator UX milestone is now fully satisfied:
`CoreSlotHealthSnapshot` + `NetworkLivenessRiskSnapshot` give per-operator health and network
halt-risk directly.

The live behavioral validation (2026-06-26) closed the lifecycle/rotation/boundary live-coverage
gaps. Still worth exercising before product surfaces (not blockers): multi-node simultaneous outage
(network `critical`), and a consensus-key rotation *mid-outage* (the rotation guard ran clean on a
healthy chain, not yet during a concurrent outage).

Phase 7.2 (live rewards claim fixture) can run in parallel once a finalized claimable epoch exists.
It does not block Phase 9, but should be completed before rewards API/web/operator-economics surfaces
expose claim behavior as production-ready.
