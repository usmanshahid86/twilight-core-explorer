# Twilight Core Explorer Phase 6a-2 CoreSlot Lifecycle Projection Report

Date: 2026-06-24

Status: PASS

## 1. Summary

Phase 6a-2 extends the semantic projection layer from the metadata proof slice into the
first CoreSlot lifecycle projection.

The projector derives lifecycle state from existing generic rows:

- `ExplorerTransaction`
- `Message`
- `Event`

Generic rows remain canonical. Lifecycle semantic rows are derived, idempotent, and
rebuildable. Only successful transactions can create lifecycle state.

This phase intentionally does not implement key rotation, payout changes, params changes,
temporal consensus mapping, rewards, liveness, API routes, or web pages.

## 2. Files Changed

- `prisma/schema.prisma`
- `prisma/migrations/20260624000300_coreslot_lifecycle_projection/migration.sql`
- `apps/indexer/package.json`
- `apps/indexer/src/projections/types.ts`
- `apps/indexer/src/projections/coreslot-lifecycle.ts`
- `apps/indexer/src/projections/coreslot-lifecycle-cli.ts`
- `apps/indexer/src/projections/reset-lifecycle.ts`
- `apps/indexer/src/projections/reset-coreslot-lifecycle.ts`
- `apps/indexer/test/projections/coreslot-lifecycle.test.js`
- `docs/research/phase-6a-2-coreslot-lifecycle-projection-report.md`

## 3. Prisma Model and Migration

Added:

- `CoreSlotLifecycleEvent`

Key fields:

- `sourceEventId @unique` for idempotency
- optional `sourceMessageId`
- `height`, `txHash`, `msgIndex`
- nullable `slotId`
- `eventType`
- `oldStatus`, `newStatus`
- `operatorAddress`
- `consensusAddress`
- `power`
- `reason`
- `evidenceReference`
- `authority`
- raw event/message JSON

Indexes:

- `slotId, height`
- `eventType`
- `operatorAddress`
- `consensusAddress`
- `txHash`

No key rotation table or temporal consensus map was added.

## 4. Lifecycle Event and Message Surface

Implemented lifecycle events:

- `coreslot_registered`
- `coreslot_activated`
- `coreslot_inactivated`
- `coreslot_suspended`
- `coreslot_removed`

Implemented message mappings:

- `/twilight.coreslot.v1.MsgRegisterCoreSlot` -> `coreslot_registered`
- `/twilight.coreslot.v1.MsgActivateCoreSlot` -> `coreslot_activated`
- `/twilight.coreslot.v1.MsgInactivateCoreSlot` -> `coreslot_inactivated`
- `/twilight.coreslot.v1.MsgSuspendCoreSlot` -> `coreslot_suspended`
- `/twilight.coreslot.v1.MsgRemoveCoreSlot` -> `coreslot_removed`

Out of scope and ignored by this projector:

- key rotation events
- validator update emitted events
- payout events
- metadata events
- params events

## 5. Correlation Rules

Lifecycle messages and events are matched by:

1. same `txHash`
2. expected message-to-event type mapping
3. event `msg_index` equals `Message.msgIndex` when present
4. event `slot_id` equals message `slot_id` where the message has `slot_id`
5. event `operator_address` equals message operator/operator address where both exist

If exactly one event matches a message:

- create or update `CoreSlotLifecycleEvent`
- update `CoreSlotProjection` from the confirmed event

If zero events match:

- create `ProjectionFailure(missing_event)`
- do not update `CoreSlotProjection` from message intent alone

If more than one event matches:

- create `ProjectionFailure(ambiguous_event)`
- do not project that message

Event-only lifecycle rows:

- if a well-formed lifecycle event has no matching message, create `CoreSlotLifecycleEvent`
  from event-confirmed data and record `ProjectionFailure(missing_message)`
- message-only fields such as `authority` and `evidenceReference` remain null

## 6. CoreSlotProjection Update Rules

Lifecycle projection updates only lifecycle-owned fields.

`coreslot_registered`:

- status from event `new_status`, usually `PENDING`
- operator address
- consensus address normalized to lowercase hex
- `createdHeight`
- optional register message fields if present and safely decoded:
  - `metadataJson`
  - `payoutAddress`
  - `consensusPubkeyJson`

`coreslot_activated`:

- status `ACTIVE`
- operator address
- consensus address
- consensus power
- update source refs

`coreslot_inactivated`:

- status `INACTIVE`
- consensus power when present, typically `0`
- update source refs

`coreslot_suspended`:

- status `SUSPENDED`
- consensus power when present, typically `0`
- reason from event/message
- evidence reference from message where present
- update source refs

`coreslot_removed`:

- status `REMOVED`
- `removedHeight`
- consensus power when present, typically `0`
- update source refs

The projector does not clear `metadataJson`, `payoutAddress`, or other fields owned by
different projection phases.

## 7. ProjectionFailure Behavior

Handled failure cases:

- `missing_event`
- `missing_message`
- `ambiguous_event`
- `ambiguous_message`
- `invalid_slot_id`
- `invalid_consensus_address`
- `missing_required_payload`

Consensus addresses are normalized as 40-character lowercase hex. Invalid consensus address
values produce `ProjectionFailure(invalid_consensus_address)`.

Projection failures do not halt the generic indexer. Unexpected projector write errors mark
the lifecycle projection cursor as `halted_error`.

Idempotent reruns avoid duplicate unresolved failures by clearing unresolved lifecycle
failures for the height before recomputing that height.

## 8. Reset and Rebuild Behavior

Lifecycle reset deletes only:

- `CoreSlotLifecycleEvent`
- `ProjectionFailure` where `projectionName = coreslot_lifecycle_v1`
- `ProjectionCursor` where `projectionName = coreslot_lifecycle_v1`

It preserves:

- all generic indexer rows
- `CoreSlotMetadataChange`
- `CoreSlotProjection`

Because lifecycle updates can write fields on `CoreSlotProjection`, a full CoreSlot rebuild
should run metadata and lifecycle projections in a known order. This phase keeps lifecycle
reset narrow to avoid deleting metadata-owned state.

## 9. Tests

Added synthetic lifecycle projection tests for:

1. register message + `coreslot_registered` event creates `CoreSlotLifecycleEvent`
2. register updates `CoreSlotProjection` with `PENDING`, operator, and lowercase consensus
   address
3. activate updates status `ACTIVE` and consensus power
4. inactivate updates status `INACTIVE` and power `0`
5. suspend updates status `SUSPENDED` and captures reason/evidence reference
6. remove updates status `REMOVED` and `removedHeight`
7. failed tx with lifecycle message does not project state
8. message without matching event creates `ProjectionFailure(missing_event)`
9. event without matching message creates `ProjectionFailure(missing_message)` and an
   event-only lifecycle row
10. two matching events create `ProjectionFailure(ambiguous_event)` and no duplicate
    lifecycle projection
11. invalid `slot_id` creates `ProjectionFailure(invalid_slot_id)`
12. invalid `consensus_address` creates `ProjectionFailure(invalid_consensus_address)`
13. rerunning the same range is idempotent
14. reset deletes lifecycle semantic rows and preserves generic rows
15. lifecycle projection does not clear existing `CoreSlotProjection.metadataJson`
16. projection cursor does not advance on semantic write failure

`npm --prefix apps/indexer test` result:

- 38 tests total
- 37 passed
- 1 skipped existing opt-in Postgres integration test
- 0 failed

## 10. Optional Local Smoke

Local Postgres was available.

Migration command:

```text
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public npm run db:deploy
```

Result:

- migration `20260624000300_coreslot_lifecycle_projection` applied successfully

Projection command:

```text
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public \
CHAIN_ID=twilight-localnet-1 \
START_HEIGHT=119 \
END_HEIGHT=121 \
RESET_PROJECTION=true \
npm --prefix apps/indexer run project:coreslot-lifecycle:dev
```

Result for this range:

- `CoreSlotLifecycleEvent = 0`
- lifecycle `ProjectionFailure = 0`
- lifecycle cursor status `idle`
- lifecycle cursor last projected height `121`

This was expected because the 119..121 local smoke range contains the metadata tx but no
lifecycle txs.

## 11. Validation

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

Static guards:

- no stale active-slots route references
- unsupported standard module route mentions remain docs-only non-goal/guard references

## 12. Known Limitations

- Key rotation is not projected yet.
- `coreslot_validator_update_emitted` is not handled yet.
- Temporal consensus-address mapping is not implemented yet.
- Payout and params changes are not projected yet.
- Snapshot reconciliation is not implemented yet.
- Synthetic lifecycle fixtures are used for lifecycle coverage; no lifecycle localnet drill
  was forced in this phase.
- Lifecycle reset is narrow and does not clear lifecycle-owned fields from
  `CoreSlotProjection`; full CoreSlot rebuild ordering must be handled by a later combined
  rebuild command.

## 13. Explicit Non-Goals

- No key rotation projection.
- No payout projection.
- No params projection.
- No temporal consensus map.
- No block signature/liveness ingestion.
- No rewards projection.
- No API routes.
- No web pages.
- No generated gRPC clients.
- No buf migration.
- No chain repo changes.
- No staking/gov/mint/distribution compatibility.

## 14. Next Recommended Step

Proceed to Phase 6a-3: payout / params / metadata generalization.

Recommended scope:

- project `coreslot_payout_updated` using message payload for new payout address
- project `coreslot_params_updated` using message payload for params
- keep metadata projection reusable under the same correlation conventions
- do not implement key rotation or temporal consensus map until Phase 6b
