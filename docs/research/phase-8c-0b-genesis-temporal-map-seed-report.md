# Phase 8c-0b / 6b-5 — Genesis Temporal-Map Seed Report

## 1. Summary

Implemented the genesis baseline seed for `coreslot_temporal_map_v1`.

The temporal map now opens height-1 `CoreSlotConsensusWindow` rows for active CoreSlot entries found
in immutable genesis state, then replays lifecycle/key-rotation deltas on top. This fixes the
structural gap discovered in Phase 8c-0: genesis CoreSlot activation does not emit an indexable
`coreslot_activated` event, so an event-only temporal map cannot see founding CoreSlot validators.

No liveness percentages, missed-signature evidence, proposer enrichment, API routes, or web pages
were implemented.

## 2. Files Changed

- `packages/chain-client/src/routes.ts`
- `packages/chain-client/src/types.ts`
- `packages/chain-client/src/rest-rpc-client.ts`
- `packages/chain-client/src/index.ts`
- `packages/chain-client/test/rest-rpc-client.test.js`
- `apps/indexer/src/projections/coreslot-temporal-map.ts`
- `apps/indexer/src/projections/coreslot-temporal-map-cli.ts`
- `apps/indexer/src/projections/coreslot-semantic-rebuild.ts`
- `apps/indexer/src/projections/coreslot-semantic-rebuild-cli.ts`
- `apps/indexer/src/projections/types.ts`
- `apps/indexer/test/projections/coreslot-temporal-map.test.js`
- `apps/indexer/test/projections/coreslot-semantic-rebuild.test.js`
- `docs/research/explorer-project-checkpoint.md`

## 3. ChainClient.getGenesis

Added `ChainClient.getGenesis()` behind the existing transport boundary.

`RestRpcChainClient` now supports:

- CometBFT `/genesis` happy path.
- `/genesis_chunked?chunk=N` fallback when CometBFT reports the genesis response is too large.
- Base64 chunk assembly + JSON parsing for chunked genesis.
- A normalized `GenesisSource` with `chainId`, `initialHeight`, `coreSlot`, and preserved `raw`.

The temporal-map projector receives a `ChainClient` and does not call RPC directly.

## 4. Prisma / Migration

No Prisma migration was added.

The seed reuses the existing `CoreSlotConsensusWindow`, `ProjectionCursor`, and
`ProjectionFailure` models under the existing `coreslot_temporal_map_v1` projection ownership.

## 5. Seeding Rules

For each `app_state.coreslot.slots` entry:

- Seed only slots with `status == ACTIVE` / `SLOT_STATUS_ACTIVE`.
- Require a valid 40-character hex consensus address for active slots.
- If genesis provides `consensus_pubkey` instead of `consensus_address`, derive the consensus address
  as `sha256(pubkey_bytes)[:20]` lowercase hex.
- Normalize consensus addresses to lowercase hex.
- Skip inactive/keyless genesis slots without failure.
- Create one active `CoreSlotConsensusWindow` per active genesis CoreSlot.
- Use `openedByKind = genesis`.
- Preserve the raw genesis slot entry in `rawOpenJson`.

Active genesis slots with missing/invalid consensus addresses create deterministic
`ProjectionFailure` rows; they are never guessed.

## 6. Genesis-Baseline Height Semantics

Genesis windows use:

- `effectiveFromHeight = 1`
- `validatorUpdateHeight = null`

This is the explicit exception to the Phase 6b-4 rule. The `validatorUpdateHeight + 2` offset applies
to lifecycle and key-rotation validator-set updates, not to the initial genesis validator set.

## 7. Event-Replay Interaction

The temporal-map rebuild order is now:

1. genesis seed
2. per-height lifecycle/key-rotation event replay

Seeded windows use the same `openActiveWindow` path as event-driven windows, so conflict detection,
dedupe, and close/supersede behavior stay shared.

Later inactivation/suspension/removal events close seeded windows at the normal membership boundary
(`validatorUpdateHeight + 2`). Later key rotations close the old seeded window and open the new
window at the rotation boundary.

The combined CoreSlot semantic rebuild now passes `ChainClient` into temporal-map replay so the
combined order remains:

`metadata -> lifecycle -> payout -> params -> key_rotation -> temporal_map(seed -> replay)`.

## 8. Failure Handling

New/reused deterministic failure cases:

- `genesis_unavailable`
- `genesis_coreslot_malformed`
- `invalid_consensus_address`
- `temporal_window_conflict`

Genesis unavailability or malformed `app_state.coreslot` fails loudly and records
`ProjectionFailure`; silent skip is not allowed because it would recreate the launch-window gap.

Projection failures are scoped to `coreslot_temporal_map_v1`; generic ingestion remains unaffected.

## 9. Reset / Rebuild

No separate reset command was added.

The existing temporal-map reset already clears:

- `CoreSlotConsensusWindow`
- `ProjectionFailure` rows for `coreslot_temporal_map_v1`
- `ProjectionCursor` rows for `coreslot_temporal_map_v1`

Generic rows, CoreSlot metadata/lifecycle/payout/params/key-rotation rows, rewards rows, and
signature evidence rows are not deleted by the temporal-map reset.

## 10. Tests

Added/updated tests for:

- `getGenesis()` `/genesis` happy path.
- `getGenesis()` `/genesis_chunked` fallback.
- one active genesis window per active genesis CoreSlot.
- no `+2` offset for genesis baseline.
- inactive/keyless genesis slots skipped without failure.
- active missing/invalid consensus addresses creating `invalid_consensus_address`.
- duplicate active genesis consensus addresses creating `temporal_window_conflict`.
- malformed missing `app_state.coreslot` creating `genesis_coreslot_malformed`.
- seeded window closing on later inactivation.
- seeded window superseded by later key rotation.
- seed idempotency.
- reset + rebuild reproducibility.
- combined rebuild passing a ChainClient into temporal-map replay.
- no liveness/miss/proposer/API/web scope leak.

## 11. Optional Local DB Smoke

Run against the existing sparse localnet DB (`Block` range 119..3585) with local RPC available.

Temporal-map reset + replay:

- seed created four genesis windows at `effectiveFromHeight = 1`.
- local genesis provided `consensus_pubkey` values, and the seed derived their CometBFT consensus
  addresses.
- slot 4 / `f060bf2347c76488a0390285e3b9ef3a44ec7d23` genesis window closed at height 3556
  from the later inactivation event.
- later slot 4 reactivation opened `f060...` at 3569 and key rotation opened `fa90...` at 3584.
- unresolved `coreslot_temporal_map_v1` failures: 0.
- temporal cursor: `idle` at 3585.

Operator-signing attribution rerun over the same range:

- `OperatorSigningEvidence` distribution: `attributed = 130`, `absent_no_validator = 1`.
- unresolved `operator_signing_evidence_v1` failures: 0.
- slot 4 / `f060...` signatures at committed heights 118..3583 are now attributed, including the
  previously uncovered genesis-active period.

The current local DB is still a sparse smoke fixture. The recommended next localnet fixture is a
fresh, contiguous localnet with active genesis CoreSlot operators, followed by:

1. generic ingest from height 1,
2. combined CoreSlot semantic rebuild with genesis seed,
3. `block_signatures_v1`,
4. `operator_signing_evidence_v1`,
5. Phase 8c-1 expected-set/miss evidence.

## 12. Known Limitations

- The seed depends on the genesis CoreSlot JSON shape; tests cover the expected `slots` array/map
  shape, but a live rebuilt genesis fixture should still be captured.
- No current liveness product is produced yet.
- No missed-signature evidence is produced yet.
- No proposer enrichment is produced yet.
- No API/web surfaces expose the seeded map yet.

## 13. Explicit Non-Goals

- liveness percentages
- missed-signature counts
- expected-set/miss evidence
- proposer enrichment
- API routes
- web pages
- rewards changes
- chain repo changes
- generated gRPC clients

## 14. Next Recommended Step

Proceed to **Phase 8c-1 — Expected Set + Missed Evidence** after running a fresh contiguous localnet
fixture with genesis CoreSlot operators, so the new seed can be validated end to end against
operator-signing attribution.
