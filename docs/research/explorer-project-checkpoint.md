# Twilight Core Explorer Project Checkpoint

Date: 2026-06-25

Status: checkpoint after Phase A/B foundation, descriptor decoder work, chain-alignment
cleanup, the full CoreSlot semantic projection set (Phases 6a-1 through 6a-4: metadata,
lifecycle, payout, params, and the combined rebuild command), and operator-experience
review.

This document summarizes what has already been decided and built, what is still only
designed, and the recommended sequence from here. It is intended to keep implementation
aligned before the next semantic projection phase (6b: key rotation and temporal consensus
map).

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

## 4. Designed But Not Yet Implemented

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

Hard fixture needs before full confidence:

- delayed `key_rotation_requested` tx to later EndBlock `key_rotated`.
- queued params to later `params_activated`.

### Operator Experience Milestone

Designed:

- operator self-service page.
- per-operator liveness/uptime.
- onboarding page.
- "How this network works" explainer.
- per-operator economics.
- authority-action audit log.

Important conclusion:

- Most operator UX is pages/API over already-planned projections.
- Per-operator liveness is the main missing data dependency.

## 5. Known Gaps

### Data Gaps

1. Block commit signatures are not stored yet.
   - Needed for per-operator liveness/uptime.
   - Source is already in `/block` as `last_commit.signatures`.
   - No new RPC call is required.

2. Temporal consensus-address map is not implemented.
   - Needed for liveness, proposer-to-slot joins, and historical slot identity.
   - Must account for activation, removal, suspension, inactivation, and key rotation.

3. Snapshot tables must be categorized clearly.
   - Rebuildable derived projections are different from observed live samples.
   - Module balance snapshots should be treated as observed samples unless tied to a
     specific indexed event/height.

4. User-facing bech32 consensus address decoding is deferred.
   - Low-level transport can reject bech32.
   - Search/self-service should eventually decode `twilightvalcons...` to lowercase hex.

### Proposer and signature height semantics

Block proposer and commit signatures have different height semantics:

- `header.proposer_address` belongs to block height `N`.
- `last_commit.signatures` included in block `N` are signatures for the committed block
  `N-1`.

Liveness projection must attribute signatures from block `N` to height `N-1`, but proposer
enrichment must not shift the proposer address. The proposer in block `N` remains the
proposer for block `N`.

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

1. metadata
2. lifecycle
3. payout
4. params
5. key rotation
6. temporal consensus map

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

### Phase 6b: Key Rotation and Temporal Consensus Map

Goal:

- Implement CoreSlot key rotation projection and the historical temporal consensus-address
  map.

Recommended split:

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

### Phase 7: Rewards Semantic Projection

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

### Phase 8: Liveness Ingestion and Projection

Goal:

- Add operator signing/uptime data.

Scope:

- parse `block.last_commit.signatures` from stored/fetched block raw JSON.
- store `BlockSignature`.
- attribute signatures to committed height N-1.
- join signatures to temporal consensus map.
- compute per-slot/operator liveness windows.
- detect unmapped signers as projection failures.
- fixture activation/rotation boundary behavior on localnet.

No staking validator APIs.

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

From this checkpoint:

CoreSlot metadata/lifecycle/payout/params projection (Phase 6a) is complete.

- MVP usable explorer: roughly 5 phases remain.
  1. CoreSlot key rotation + temporal map.
  2. Rewards projection.
  3. API foundation.
  4. web foundation.
  5. Twilight-specific pages.

- Production-grade operator explorer: roughly 7 phases remain.
  1. CoreSlot key rotation + temporal map.
  2. Rewards projection.
  3. Liveness ingestion/projection.
  4. API foundation.
  5. web and Twilight pages.
  6. operator education/onboarding.
  7. deployment/hardening.

The phases can be batched differently, but the dependencies should not be blurred:

- liveness depends on CoreSlot temporal mapping.
- operator economics depends on rewards projection.
- authority audit depends on lifecycle/params projections.
- onboarding/explainer can land early once the web/API shell exists.

## 8. Current Open Questions

1. What is the exact validator-set effective boundary for activation/key rotation?
   - Likely EndBlock(H) applies to signing block H+1.
   - Must be pinned with localnet fixtures.

2. Should `BlockSignature` be added as generic indexed data or projection data?
   - Recommended: canonical-adjacent generic data because it comes directly from `/block`.
   - `BlockSignature` should be treated as canonical-adjacent generic data, but still
     rebuildable. It is parsed from stored raw CometBFT block JSON, assuming `Block.rawJson`
     preserves the `/block` response including `last_commit.signatures`. No new RPC call is
     required to rebuild `BlockSignature` if the raw block payload is already stored.

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

Phase 6b-1: CoreSlot key rotation projection.

Minimum acceptance:

- `CoreSlotConsensusKeyRotation` or equivalent key-rotation history model.
- projection name `coreslot_key_rotation_v1`.
- projection from existing generic `ExplorerTransaction`, `Message`, and `Event` rows.
- support for requested, applied, immediate-applied, and cancelled rotations.
- requested/cancelled rotations must not update `CoreSlotProjection.consensusAddress`.
- applied rotations update `CoreSlotProjection.consensusAddress`.
- deterministic `ProjectionFailure.failureKey` behavior.
- combined CoreSlot semantic rebuild order extended after params with key rotation.
- no temporal consensus map yet.
- no rewards/liveness/API/web pages yet.

After that, proceed to Phase 6b-2: temporal consensus map / validator-set timeline.
