# Twilight Core Explorer Phase 6a-3 CoreSlot Payout / Params Projection Report

Date: 2026-06-24

Status: PASS

## 1. Summary

Phase 6a-3 extends the rebuildable CoreSlot semantic projection layer to the remaining
tx-bound, non-rotation CoreSlot change surfaces:

- `/twilight.coreslot.v1.MsgUpdatePayoutAddress` + `coreslot_payout_updated`
- `/twilight.coreslot.v1.MsgUpdateParams` + `coreslot_params_updated`

Generic rows remain canonical. Payout and params rows are derived from existing
`ExplorerTransaction`, `Message`, and `Event` rows. Only successful transactions can create
semantic state. Events confirm effects; messages provide payloads omitted by events.

This phase intentionally does not implement key rotation, temporal consensus mapping,
validator update projection, rewards, liveness, API routes, or web pages.

## 2. Files Changed

- `prisma/schema.prisma`
- `prisma/migrations/20260624000400_coreslot_payout_params_projection/migration.sql`
- `apps/indexer/package.json`
- `apps/indexer/src/projections/types.ts`
- `apps/indexer/src/projections/coreslot-payout.ts`
- `apps/indexer/src/projections/coreslot-payout-cli.ts`
- `apps/indexer/src/projections/reset-payout.ts`
- `apps/indexer/src/projections/reset-coreslot-payout.ts`
- `apps/indexer/src/projections/coreslot-params.ts`
- `apps/indexer/src/projections/coreslot-params-cli.ts`
- `apps/indexer/src/projections/reset-params.ts`
- `apps/indexer/src/projections/reset-coreslot-params.ts`
- `apps/indexer/test/projections/coreslot-payout-params.test.js`
- `apps/indexer/test/projections/coreslot-metadata.test.js`
- `apps/indexer/test/projections/coreslot-lifecycle.test.js`
- `docs/research/phase-6a-3-coreslot-payout-params-projection-report.md`

## 3. Prisma Models and Migration

Added:

- `CoreSlotPayoutChange`
- `CoreSlotParameterChange`

Updated:

- `ProjectionFailure.failureKey String? @unique`

`CoreSlotPayoutChange.sourceMessageId` is unique for idempotent payout history.
`CoreSlotParameterChange.sourceMessageId` is unique for idempotent params history.

`ProjectionFailure.failureKey` gives semantic failures a deterministic upsert key. The key
is populated by metadata, lifecycle, payout, and params failure writes.

## 4. Payout Projection Behavior

Projection name:

```text
coreslot_payout_v1
```

The payout projector reads only:

- successful `ExplorerTransaction` rows
- `Message` rows for `/twilight.coreslot.v1.MsgUpdatePayoutAddress`
- `Event` rows for `coreslot_payout_updated`

The event confirms the payout update but omits the new payout address. The projector
therefore requires the decoded message payload before it creates `CoreSlotPayoutChange`.

On confirmed correlation, it updates `CoreSlotProjection.payoutAddress` and source refs.

## 5. Params Projection Behavior

Projection name:

```text
coreslot_params_v1
```

The params projector reads only:

- successful `ExplorerTransaction` rows
- `Message` rows for `/twilight.coreslot.v1.MsgUpdateParams`
- `Event` rows for `coreslot_params_updated`

The event confirms the params update but omits full params. The decoded message payload is
stored as `CoreSlotParameterChange.paramsJson`.

Params are global module state, so this phase does not mutate `CoreSlotProjection`.

## 6. Correlation Rules

Payout messages match events by:

1. same `txHash`
2. event type `coreslot_payout_updated`
3. event `msg_index` equals `Message.msgIndex` when present
4. event `slot_id` equals message `slot_id`
5. event `operator_address` equals message `operator` when present

Params messages match events by:

1. same `txHash`
2. event type `coreslot_params_updated`
3. event `msg_index` equals `Message.msgIndex` when present
4. event `authority` equals message `authority` when present

Message without event creates `ProjectionFailure(missing_event)`.
Event without message creates `ProjectionFailure(missing_message)`.
Ambiguous correlations create `ProjectionFailure(ambiguous_event)` or
`ProjectionFailure(ambiguous_message)`.

## 7. CoreSlotProjection Update Rules

Payout projection updates only:

- `operatorAddress`
- `payoutAddress`
- `updatedHeight`
- last source refs

It does not clear:

- `metadataJson`
- `status`
- `consensusAddress`
- `consensusPubkeyJson`
- `rewardWeight`
- `consensusPower`
- `createdHeight`
- `removedHeight`

Params projection does not modify `CoreSlotProjection`.

## 8. ProjectionFailure / failureKey Behavior

Failure kinds used by this phase:

- `missing_event`
- `missing_message`
- `ambiguous_event`
- `ambiguous_message`
- `invalid_slot_id`
- `invalid_payout_address`
- `invalid_params_payload`
- `missing_required_payload`

Failure writes now use deterministic `failureKey` upserts across metadata, lifecycle,
payout, and params projections.

The key includes:

- projection name
- failure kind
- source height
- tx hash
- msg index
- source message/event IDs
- type URL
- event type

This prevents unresolved failure rows from accumulating on idempotent reruns.

## 9. Reset and Rebuild Behavior

Payout reset deletes only:

- `CoreSlotPayoutChange`
- `ProjectionFailure` where `projectionName = coreslot_payout_v1`
- `ProjectionCursor` where `projectionName = coreslot_payout_v1`

Params reset deletes only:

- `CoreSlotParameterChange`
- `ProjectionFailure` where `projectionName = coreslot_params_v1`
- `ProjectionCursor` where `projectionName = coreslot_params_v1`

Both reset paths preserve generic canonical rows and unrelated semantic rows.

Because payout updates `CoreSlotProjection.payoutAddress`, full production rebuild tooling
still needs the future combined CoreSlot semantic rebuild command:

```text
metadata -> lifecycle -> payout/params -> key rotation -> temporal consensus map
```

## 10. Tests

Added normal unit/fixture tests for payout:

1. payout message + matching event creates `CoreSlotPayoutChange`
2. payout message + matching event updates `CoreSlotProjection.payoutAddress`
3. payout preserves metadata and lifecycle-owned fields
4. failed payout tx does not project
5. missing event creates `ProjectionFailure(missing_event)`
6. event without message creates `ProjectionFailure(missing_message)`
7. ambiguous events create `ProjectionFailure(ambiguous_event)`
8. missing payout payload creates `ProjectionFailure(missing_required_payload)`
9. invalid slot id creates `ProjectionFailure(invalid_slot_id)`
10. invalid payout address creates `ProjectionFailure(invalid_payout_address)`
11. rerun is idempotent for unresolved failures
12. reset preserves generic and unrelated semantic rows

Added normal unit/fixture tests for params:

1. params message + matching event creates `CoreSlotParameterChange`
2. params payload is stored as `paramsJson`
3. failed params tx does not project
4. missing event creates `ProjectionFailure(missing_event)`
5. event without message creates `ProjectionFailure(missing_message)`
6. ambiguous events create `ProjectionFailure(ambiguous_event)`
7. missing params payload creates `ProjectionFailure(invalid_params_payload)`
8. rerun is idempotent for unresolved failures
9. reset preserves generic rows
10. params projection does not mutate `CoreSlotProjection`

`npm --prefix apps/indexer test` result:

- 60 tests total
- 59 passed
- 1 skipped existing opt-in Postgres integration test
- 0 failed

## 11. Optional Local Smoke Result

Local Postgres was available.

Migration command:

```text
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public npm run db:deploy
```

Result:

- migration `20260624000400_coreslot_payout_params_projection` applied successfully

Payout projection command:

```text
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public \
CHAIN_ID=twilight-localnet-1 \
START_HEIGHT=119 \
END_HEIGHT=121 \
RESET_PROJECTION=true \
npm --prefix apps/indexer run project:coreslot-payout:dev
```

Params projection command:

```text
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public \
CHAIN_ID=twilight-localnet-1 \
START_HEIGHT=119 \
END_HEIGHT=121 \
RESET_PROJECTION=true \
npm --prefix apps/indexer run project:coreslot-params:dev
```

The known smoke range contains the metadata tx but no payout or params tx. Result:

- `CoreSlotPayoutChange = 0`
- payout `ProjectionFailure = 0`
- payout cursor idle at 121
- `CoreSlotParameterChange = 0`
- params `ProjectionFailure = 0`
- params cursor idle at 121

## 12. Validation

Commands run:

```text
npm install
npm run db:generate
npm run typecheck
npm test
npm run lint
npm --prefix apps/indexer test
```

Results:

- install passed/no-op
- Prisma generate passed
- typecheck passed
- tests passed
- lint passed
- indexer tests passed

## 13. Known Limitations

- Key rotation is not projected yet.
- `coreslot_validator_update_emitted` is not handled yet.
- Temporal consensus-address mapping is not implemented yet.
- Snapshot reconciliation is not implemented yet.
- Rewards projection is not implemented yet.
- Liveness projection is not implemented yet.
- API/web pages are not implemented yet.
- The combined CoreSlot semantic rebuild command is still future work.

## 14. Explicit Non-Goals

- No key rotation projection.
- No temporal consensus map.
- No validator update projection.
- No block signature/liveness ingestion.
- No rewards projection.
- No API routes.
- No web pages.
- No generated gRPC clients.
- No buf migration.
- No chain repo changes.
- No staking/gov/mint/distribution compatibility.

## 15. Next Recommended Step

Proceed to Phase 6b: key rotation + temporal consensus map.

Before or during 6b, decide whether to add the combined CoreSlot semantic rebuild command
first so shared `CoreSlotProjection` fields can be reset and replayed in deterministic
order.
