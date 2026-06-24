# Twilight Core Explorer Phase 6a-1 CoreSlot Metadata Projection Report

Date: 2026-06-24

Status: PASS

## 1. Summary

Phase 6a-1 adds the first rebuildable semantic projection layer over the existing generic
indexer tables.

The proof slice projects:

- `/twilight.coreslot.v1.MsgUpdateOperatorMetadata`
- matching `coreslot_metadata_updated` event

Generic rows remain canonical. The new semantic rows are derived from existing
`ExplorerTransaction`, `Message`, and `Event` rows, are idempotent, and can be reset without
deleting generic indexer data.

This phase intentionally does not implement lifecycle, payout, params, key rotation,
temporal consensus mapping, rewards, liveness, API routes, or web pages.

## 2. Files Changed

- `prisma/schema.prisma`
- `prisma/migrations/20260624000200_coreslot_metadata_projection/migration.sql`
- `apps/indexer/package.json`
- `apps/indexer/src/projections/advisory-lock.ts`
- `apps/indexer/src/projections/cursor.ts`
- `apps/indexer/src/projections/reset.ts`
- `apps/indexer/src/projections/types.ts`
- `apps/indexer/src/projections/coreslot-metadata.ts`
- `apps/indexer/src/projections/coreslot-metadata-cli.ts`
- `apps/indexer/src/projections/reset-coreslot-metadata.ts`
- `apps/indexer/test/projections/coreslot-metadata.test.js`
- `docs/research/phase-6a-1-coreslot-metadata-projection-report.md`

## 3. Prisma Models and Migration

Added semantic projection models:

- `ProjectionCursor`
- `ProjectionFailure`
- `CoreSlotProjection`
- `CoreSlotMetadataChange`

`ProjectionCursor` is separate from `IndexerCursor` so semantic projection state cannot
advance or halt generic block ingestion state.

`CoreSlotProjection` is intentionally minimal and nullable. In this phase it only receives:

- `slotId`
- `operatorAddress`
- `metadataJson`
- source refs
- update heights

Lifecycle, status, payout, consensus, power, reward weight, and removed state are left null
unless a later phase has a reliable source.

`CoreSlotMetadataChange.sourceMessageId` is unique, giving idempotency for the append-only
metadata history.

## 4. Projection Architecture

Projection code lives under:

```text
apps/indexer/src/projections/
```

Added:

- projection advisory lock with a key distinct from the generic indexer lock
- projection cursor helpers
- reset helper
- CoreSlot metadata projector
- CoreSlot metadata CLI

Projection name:

```text
coreslot_metadata_v1
```

The projector reads only generic rows:

- successful `ExplorerTransaction` rows
- `Message` rows for `/twilight.coreslot.v1.MsgUpdateOperatorMetadata`
- `Event` rows for `coreslot_metadata_updated`

It does not call the chain and does not mutate generic rows.

## 5. Metadata Correlation Rule

A metadata projection requires:

1. parent transaction is successful
2. message type is `/twilight.coreslot.v1.MsgUpdateOperatorMetadata`
3. event type is `coreslot_metadata_updated`
4. same `txHash`
5. event `msg_index`, when present, equals `Message.msgIndex`
6. event `slot_id` equals message `slot_id`
7. event `operator_address` equals message `operator`

The message supplies the metadata payload because the event confirms the effect but omits
the metadata body.

On successful correlation:

- upsert `CoreSlotMetadataChange` by `sourceMessageId`
- upsert `CoreSlotProjection` by `slotId`
- retain source message/event references and raw source JSON

## 6. Cursor and Failure Behavior

The projection cursor advances only after semantic writes for the height commit.

Handled failure kinds in this phase:

- `missing_event`
- `missing_message`
- `ambiguous_event`
- `ambiguous_message`
- `invalid_slot_id`
- `missing_required_payload`

Failed transactions do not create semantic state. Projection failures do not halt the
generic indexer.

Unexpected semantic write errors mark the projection cursor `halted_error` without advancing
it to the failed height.

## 7. Reset and Rebuild Behavior

The reset helper deletes only rows for the CoreSlot metadata projection:

- `CoreSlotMetadataChange`
- `CoreSlotProjection`
- `ProjectionFailure` where `projectionName = coreslot_metadata_v1`
- `ProjectionCursor` where `projectionName = coreslot_metadata_v1`

It preserves all generic rows:

- `Block`
- `ExplorerTransaction`
- `Message`
- `Event`
- `Account`
- `IndexerCursor`
- `DecodeFailure`

## 8. Tests

Added normal unit/fixture tests for:

1. successful metadata message + matching event creates `CoreSlotMetadataChange`
2. successful metadata message + matching event updates `CoreSlotProjection.metadataJson`
3. failed tx with metadata message does not project
4. metadata message without matching event creates `ProjectionFailure(missing_event)`
5. metadata event without matching message creates `ProjectionFailure(missing_message)`
6. two matching events create `ProjectionFailure(ambiguous_event)` and no projection
7. missing payload creates `ProjectionFailure(missing_required_payload)`
8. rerunning the same range is idempotent
9. reset deletes only semantic metadata projection rows and preserves generic rows
10. projection cursor does not advance when semantic writes fail

`npm --prefix apps/indexer test` result:

- 22 tests total
- 21 passed
- 1 skipped existing opt-in Postgres integration test
- 0 failed

## 9. Optional Local Smoke Projection

Local Postgres was available.

Migration command:

```text
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public npm run db:deploy
```

Result:

- migration `20260624000200_coreslot_metadata_projection` applied successfully

Projection command:

```text
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public \
CHAIN_ID=twilight-localnet-1 \
START_HEIGHT=119 \
END_HEIGHT=121 \
RESET_PROJECTION=true \
npm --prefix apps/indexer run project:coreslot-metadata:dev
```

Smoke result:

- `CoreSlotProjection = 1`
- `CoreSlotMetadataChange = 1`
- `ProjectionFailure = 0`
- `ProjectionCursor.status = idle`
- `ProjectionCursor.lastProjectedHeight = 121`

Projected metadata change:

- height: `120`
- tx hash: `2BF1A0557CBBA9FAB26671E471BDEC36A24A823032FFC91AF529092655E78A81`
- slot id: `1`
- operator: `twilight17n30thc6ntha6rpjvk46yrwvkd86guy9crevra`
- metadata: `{ "moniker": "explorer-smoke-1782273257" }`

Idempotency rerun without reset:

- `CoreSlotProjection = 1`
- `CoreSlotMetadataChange = 1`
- `ProjectionFailure = 0`

## 10. Validation

Commands run:

```text
npm run db:generate
npm --prefix apps/indexer run typecheck
npm --prefix apps/indexer test
npm run typecheck
npm test
npm run lint
```

Results:

- typecheck passed
- tests passed
- lint passed

Static guards:

```text
active-slots stale-route regression guard
grep -R "/cosmos/staking\|/cosmos/gov\|/cosmos/mint\|/cosmos/distribution" apps packages prisma docs scripts --exclude-dir=node_modules || true
```

Results:

- no stale active-slots route implementation references
- unsupported standard module route mentions are docs-only non-goal/guard references

## 11. Known Limitations

- Only `MsgUpdateOperatorMetadata` is projected.
- Only `coreslot_metadata_updated` is correlated.
- `CoreSlotProjection` status, payout, consensus address, consensus pubkey, reward weight,
  power, and removal state are intentionally not populated yet.
- No snapshot reconciliation yet.
- No localnet fixture for lifecycle, key rotation, or params activation yet.
- `ProjectionFailure` rows are recomputed per height for unresolved failures during rerun.

## 12. Explicit Non-Goals

- No CoreSlot lifecycle projection.
- No payout projection.
- No params projection.
- No key rotation projection.
- No temporal consensus map.
- No rewards projection.
- No liveness projection.
- No API routes.
- No web pages.
- No generated gRPC clients.
- No buf migration.
- No chain repo changes.
- No staking/gov/mint/distribution compatibility.

## 13. Next Recommended Step

Proceed to Phase 6a-2: CoreSlot lifecycle projection.

Recommended scope:

- project register/activate/inactivate/suspend/remove lifecycle events
- use successful-tx filtering
- retain source message/event refs
- populate status/operator/consensus fields only from confirmed lifecycle sources
- add local fixtures for event/message correlation edge cases
- do not implement key rotation or temporal consensus map until Phase 6b
