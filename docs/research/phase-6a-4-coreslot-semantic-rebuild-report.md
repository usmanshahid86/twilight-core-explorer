# Twilight Core Explorer Phase 6a-4 Combined CoreSlot Semantic Rebuild Report

Date: 2026-06-25

Status: PASS

## 1. Summary

Phase 6a-4 adds a single, safe, deterministic command that resets and replays all
currently implemented CoreSlot semantic projections:

- `coreslot_metadata_v1`
- `coreslot_lifecycle_v1`
- `coreslot_payout_v1`
- `coreslot_params_v1`

The combined command establishes the safe rebuild pattern now, before key rotation and the
temporal consensus map are added in Phase 6b. It composes the existing per-projection range
helpers rather than duplicating projection logic, so each projection keeps its own cursor,
failure semantics, and correlation rules.

Generic canonical rows (`Block`, `ExplorerTransaction`, `Message`, `Event`, `Account`,
`DecodeFailure`, `IndexerCursor`) are never deleted or mutated. No schema migration was
required: this phase is pure orchestration plus a scoped combined reset.

This phase intentionally does not implement key rotation, temporal consensus mapping,
validator update projection, rewards, liveness, API routes, or web pages.

## 2. Files Changed

- `apps/indexer/src/projections/types.ts`
  - Added `CORESLOT_SEMANTIC_PROJECTIONS` (the four implemented CoreSlot projection names,
    in deterministic order).
- `apps/indexer/src/projections/reset-semantic.ts` (new)
  - `resetCoreSlotSemanticProjections` + `ResetCoreSlotSemanticPrisma`.
- `apps/indexer/src/projections/reset-coreslot-semantic.ts` (new)
  - Combined reset CLI wrapper.
- `apps/indexer/src/projections/coreslot-semantic-rebuild.ts` (new)
  - Orchestrator, default step builder, high-level `projectCoreSlotSemanticRebuild`,
    `CoreSlotSemanticRebuildError`, `CORESLOT_SEMANTIC_REBUILD_ORDER`.
- `apps/indexer/src/projections/coreslot-semantic-rebuild-cli.ts` (new)
  - Combined rebuild CLI: env resolution, advisory lock, dry-run, cursor reporting.
- `apps/indexer/package.json`
  - Added `project:coreslot-semantic`, `project:coreslot-semantic:dev`,
    `project:coreslot-semantic:reset` scripts.
- `apps/indexer/test/projections/coreslot-semantic-rebuild.test.js` (new)
  - 16 tests: ordering, reset-before-project, failure-stop, reset safety, idempotency, and
    shared-field preservation against the real projectors.
- `docs/research/phase-6a-4-coreslot-semantic-rebuild-report.md` (this report)

No Prisma schema or migration changes.

## 3. Reset Behavior

`resetCoreSlotSemanticProjections` runs a single transaction that deletes:

- `CoreSlotMetadataChange`
- `CoreSlotLifecycleEvent`
- `CoreSlotPayoutChange`
- `CoreSlotParameterChange`
- `CoreSlotProjection`
- `ProjectionFailure` where `projectionName IN (CORESLOT_SEMANTIC_PROJECTIONS)`
- `ProjectionCursor` where `projectionName IN (CORESLOT_SEMANTIC_PROJECTIONS)`

It preserves:

- all generic canonical rows.
- any non-CoreSlot `ProjectionFailure` / `ProjectionCursor` rows, because both deletes are
  scoped to the four CoreSlot projection names via `{ in: [...] }` rather than a blanket
  `deleteMany()`.

`CoreSlotProjection` is the one shared semantic table written by metadata, lifecycle, and
payout. The combined reset deletes it once up front so the ordered replay can rebuild it
from scratch without one projection's narrow reset clobbering another's fields.

## 4. Rebuild Order

Deterministic order, defined once in `CORESLOT_SEMANTIC_REBUILD_ORDER`:

```text
metadata -> lifecycle -> payout -> params
```

Rationale:

- metadata establishes `CoreSlotProjection.metadataJson`.
- lifecycle establishes status/operator/consensus/power without clearing metadata.
- payout establishes `payoutAddress` without clearing metadata/lifecycle fields.
- params is global module-change history and never mutates `CoreSlotProjection`.

Future order (Phase 6b, not implemented):

```text
... -> key rotation -> temporal consensus map
```

The orchestrator runs each step's range projector over the same `[startHeight, endHeight]`.
It calls the existing range helpers (`projectCoreSlot*Range`) directly; the individual
projectors are unchanged.

## 5. Cursor Behavior

No new combined cursor was added. Each underlying projection keeps and advances its own
`ProjectionCursor`:

- `coreslot_metadata_v1`
- `coreslot_lifecycle_v1`
- `coreslot_payout_v1`
- `coreslot_params_v1`

When `RESET_PROJECTION=true`, the combined reset deletes all four CoreSlot cursors first;
each projector then re-creates and advances its own cursor as it replays. The CLI reports
all four final cursor heights/statuses after a run (and current statuses in dry-run mode).

Start/end resolution in the CLI:

- `END_HEIGHT` defaults to `max(Block.height)`.
- With `RESET_PROJECTION=true` and no `START_HEIGHT`, start from the earliest indexed block
  (`min(Block.height)`).
- With `RESET_PROJECTION=false`, `START_HEIGHT` is required. A non-reset combined run over
  four projections that may sit at different cursors would otherwise be ambiguous, so the
  command requires an explicit start instead of guessing.

## 6. Failure Behavior

If a projection step throws, the orchestrator stops immediately: no later projection runs,
and a `CoreSlotSemanticRebuildError` is raised naming the failed projection and listing the
projections that completed before it. The CLI logs this and exits non-zero.

Because each per-height projection runs inside its own DB transaction and only the injected
projection steps touch the database, a mid-rebuild failure cannot mutate generic canonical
rows. The failing projection's own per-height transaction is rolled back by the underlying
projector, and its cursor is marked halted by the existing halt path. Generic
`IndexerCursor` is never written by any rebuild path.

## 7. Tests

`apps/indexer/test/projections/coreslot-semantic-rebuild.test.js` adds 16 tests.

Orchestration (injected step seams):

1. runs projections in metadata -> lifecycle -> payout -> params order.
2. forwards the same start/end range to every projection.
3. resets first, then projects, when `reset` is true.
4. does not reset when `reset` is false.
5. stops after a failing projection and reports which one failed (later steps never run).

Reset safety (in-memory model):

6. deletes all CoreSlot semantic change tables and the projection.
7. deletes only `ProjectionFailure` rows for CoreSlot projection names.
8. deletes only `ProjectionCursor` rows for CoreSlot projection names.
9. preserves all generic canonical rows.

Full rebuild against the real projectors (in-memory model):

10. rebuilds metadata, lifecycle, and payout into one `CoreSlotProjection`.
11. preserves `metadataJson` when lifecycle runs after metadata.
12. preserves lifecycle-owned fields when payout runs after lifecycle.
13. params projection does not mutate `CoreSlotProjection`.
14. idempotent across two combined rebuilds of the same range.
15. advances each projection cursor to the end height.
16. stops the rebuild and leaves generic rows untouched when a projection throws.

`npm --prefix apps/indexer test` result:

- 76 tests total
- 75 passed
- 1 skipped (existing opt-in Postgres integration test)
- 0 failed

## 8. Optional Local Smoke

Local Postgres was available with the known 119..121 smoke range.

```text
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public \
CHAIN_ID=twilight-localnet-1 \
START_HEIGHT=119 END_HEIGHT=121 RESET_PROJECTION=true \
npm --prefix apps/indexer run project:coreslot-semantic
```

Dry-run (`DRY_RUN=true`) printed the chainId, range, reset flag, projection order, and
current cursor statuses.

Real run result (matches the expected metadata-only range):

- `CoreSlotProjection = 1`
- `CoreSlotMetadataChange = 1`
- `CoreSlotLifecycleEvent = 0`
- `CoreSlotPayoutChange = 0`
- `CoreSlotParameterChange = 0`
- `ProjectionFailure` for the four CoreSlot projection names = 0
- all four projection cursors idle at height 121
- generic rows preserved (`Block = 3`, `ExplorerTransaction = 1`, `Message = 1`,
  `Event = 5`)

## 9. Validation

```text
npm install                 # no-op
npm run db:generate         # passed
npm run typecheck           # passed (exit 0, no TS errors)
npm test                    # passed
npm run lint                # passed (exit 0)
npm --prefix apps/indexer test   # 75 passed, 1 skipped, 0 failed
```

Static guards:

```text
grep -R "/twilight/coreslot/v1/slots/active" apps packages prisma docs scripts \
  --exclude-dir=node_modules   # no matches
grep -R "/cosmos/staking\|/cosmos/gov\|/cosmos/mint\|/cosmos/distribution" \
  apps packages prisma docs scripts --exclude-dir=node_modules
```

- no stale `/slots/active` route references.
- unsupported standard-route mentions appear only in docs as non-goal / guard references,
  never in source.

## 10. Known Limitations

- The combined rebuild currently covers metadata/lifecycle/payout/params only.
- Key rotation is not included yet.
- The temporal consensus map is not included yet.
- Snapshot reconciliation is not implemented yet.
- Rewards, liveness, API routes, and web pages are not implemented.

## 11. Explicit Non-Goals

- No key rotation projection.
- No temporal consensus map / ValidatorSetTimeline.
- No `coreslot_validator_update_emitted` projection.
- No block signature / liveness ingestion.
- No rewards projection.
- No API routes.
- No web pages.
- No generated gRPC clients.
- No buf migration.
- No chain repo changes.
- No staking/gov/mint/distribution compatibility.
- No mutation or deletion of generic canonical rows.

## 12. Next Recommended Step

Phase 6b: key rotation + temporal consensus map.

When key rotation lands, add its reset/projection to `CORESLOT_SEMANTIC_PROJECTIONS` and a
fifth step to `CORESLOT_SEMANTIC_REBUILD_ORDER` (then the temporal consensus map as the
sixth), so the combined command remains the single deterministic CoreSlot rebuild path.
