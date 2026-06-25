# Twilight Core Explorer Phase 6b-1 CoreSlot Key Rotation Projection Report

Date: 2026-06-25

Status: PASS

## 1. Summary

Phase 6b-1 adds the rebuildable CoreSlot semantic projection for consensus key rotation:

- `/twilight.coreslot.v1.MsgRotateConsensusKey`
- `coreslot_key_rotation_requested`
- `coreslot_key_rotated`
- `coreslot_rotation_cancelled`

It produces historical key-rotation rows (`CoreSlotConsensusKeyRotation`) covering requested
delayed rotations, immediate applied rotations, delayed applied rotations, and cancelled
rotations. `CoreSlotProjection.consensusAddress` is updated only when an applied rotation is
confirmed by a `coreslot_key_rotated` event.

The temporal consensus-address map / validator-set timeline is intentionally NOT implemented
here; that is Phase 6b-2. Generic rows remain canonical; key-rotation rows are derived from
existing `ExplorerTransaction`, `Message`, and `Event` rows.

## 2. Files Changed

New:

- `apps/indexer/src/projections/coreslot-key-rotation.ts`
- `apps/indexer/src/projections/coreslot-key-rotation-cli.ts`
- `apps/indexer/src/projections/reset-key-rotation.ts`
- `apps/indexer/src/projections/reset-coreslot-key-rotation.ts`
- `apps/indexer/test/projections/coreslot-key-rotation.test.js`
- `prisma/migrations/20260625000500_coreslot_key_rotation_projection/migration.sql`
- `docs/research/phase-6b-1-coreslot-key-rotation-projection-report.md`

Modified:

- `prisma/schema.prisma` — `CoreSlotConsensusKeyRotation` model.
- `apps/indexer/src/projections/types.ts` — projection name, type URL / event constants,
  status enum, `CORESLOT_SEMANTIC_PROJECTIONS` extended, new failure kinds.
- `apps/indexer/src/projections/reset-semantic.ts` — combined reset deletes key-rotation rows.
- `apps/indexer/src/projections/coreslot-semantic-rebuild.ts` — combined order extended with
  `key_rotation` after `params`.
- `apps/indexer/package.json` — `project:coreslot-key-rotation[:dev|:reset]` scripts.
- `apps/indexer/test/projections/coreslot-semantic-rebuild.test.js` — combined order/reset
  coverage extended for key rotation.

## 3. Prisma Model / Migration

Added `CoreSlotConsensusKeyRotation` (migration `20260625000500_coreslot_key_rotation_projection`).

Key fields: `slotId`, `operatorAddress`, `oldConsensusAddress`, `newConsensusAddress`,
`status` (`requested | applied | immediate_applied | cancelled`), `requestedHeight`,
`effectiveHeight`, `appliedHeight`, `cancelledHeight`, `power`, `reason`, source
message/event ids, per-phase tx/msg refs, and raw message/event JSON.

Idempotency uses unique indexes on the nullable `sourceRequestEventId`,
`sourceAppliedEventId`, and `sourceCancelledEventId`. In PostgreSQL multiple NULLs are
permitted, so these act as partial uniques over non-null event ids and back deterministic
upserts keyed by the originating event.

No changes to generic canonical tables.

## 4. Key Rotation Event / Message Surface

- `MsgRotateConsensusKey` carries `slot_id`, `operator`, and `new_consensus_pubkey` (an Any).
  The message generally does not carry the derived consensus address.
- `coreslot_key_rotation_requested` (tx-bound for active-slot delayed rotations).
- `coreslot_key_rotated` (tx-bound immediate, or EndBlock-only delayed application).
- `coreslot_rotation_cancelled` (tx-bound or EndBlock / lifecycle-triggered).

Events are loaded per height by type without a `txHash` filter so EndBlock-only effects are
captured. Event `new_consensus_address` / `old_consensus_address` are authoritative; the
message pubkey Any is stored raw for future derivation and is never a projection blocker.

## 5. Requested / Immediate / Delayed / Cancelled Semantics

- Requested: successful `MsgRotateConsensusKey` correlated to exactly one
  `coreslot_key_rotation_requested` event → `status = requested`. Does not touch
  `CoreSlotProjection.consensusAddress`.
- Immediate applied: successful `MsgRotateConsensusKey` correlated to a `coreslot_key_rotated`
  event in the same tx with no request event → `status = immediate_applied`; updates
  `CoreSlotProjection.consensusAddress`.
- Delayed applied: event-only `coreslot_key_rotated` linked to an existing `requested` row by
  `slotId + newConsensusAddress + effectiveHeight` → row becomes `status = applied`; updates
  `CoreSlotProjection.consensusAddress`. With no matching request, an event-only `applied` row
  is created, the projection is still updated (the event confirms the effect), and a
  `missing_request` failure is recorded as drift.
- Cancelled: `coreslot_rotation_cancelled` linked to an existing `requested` row → row becomes
  `status = cancelled`. Never updates `CoreSlotProjection.consensusAddress`. With no matching
  request, an event-only `cancelled` row is created plus a `missing_request` failure.

Idempotency: applied/cancelled events first look up an existing row by their own
`sourceAppliedEventId` / `sourceCancelledEventId` and re-apply in place. The requested upsert
sets `status` only on create, so reprojecting the request height never downgrades a row that
has since become applied or cancelled.

## 6. Correlation Rules

Tx-bound correlation (message ↔ requested/rotated event): same `txHash`, event `msg_index`
equals `Message.msgIndex` when present, event `slot_id` equals message `slot_id`.

Event-only correlation (applied/cancelled → prior requested rows): `slotId`,
`newConsensusAddress`, and `effectiveHeight` when the event provides it; `status = requested`.

Ambiguity: more than one matching requested row → `rotation_correlation_failed`, and the
projection consensus address is not updated.

## 7. CoreSlotProjection Update Rules

`CoreSlotProjection.consensusAddress` is updated only for confirmed applications
(`immediate_applied`, `applied`) with a valid new consensus address. The update sets
`consensusAddress`, `operatorAddress` (when known), `consensusPower` (when present),
`updatedHeight`, and `lastSource*` refs.

It is never updated on `requested`, `cancelled`, ambiguous applications, or invalid consensus
addresses. The update never clears `metadataJson`, `payoutAddress`, `status`, `createdHeight`,
or `removedHeight`.

## 8. ProjectionFailure Behavior

Deterministic `failureKey` upserts (shared helper) are used for all failures. Kinds:
`missing_event`, `missing_message`, `missing_request`, `ambiguous_event`,
`invalid_slot_id`, `invalid_consensus_address`, `missing_required_payload`,
`rotation_correlation_failed`.

- Per-height unresolved failures are cleared before recompute, and the deterministic key
  prevents duplicate unresolved failures on idempotent reruns.
- Failed transactions never produce tx-bound request/apply rows or failures (out-of-scope).
- Only unexpected write errors halt the `coreslot_key_rotation_v1` cursor; the generic
  indexer is unaffected.

## 9. Reset / Rebuild Behavior

Individual reset (`coreslot_key_rotation_v1`) deletes only `CoreSlotConsensusKeyRotation`,
its `ProjectionFailure` rows, and its `ProjectionCursor`. Generic rows and other CoreSlot
semantic rows are preserved.

Combined CoreSlot semantic reset now also clears `CoreSlotConsensusKeyRotation`. Combined
rebuild order:

```text
metadata -> lifecycle -> payout -> params -> key_rotation
```

The temporal consensus map is not part of the order yet.

## 10. Tests

`apps/indexer/test/projections/coreslot-key-rotation.test.js` adds 20 tests covering: requested
row creation and no-projection-update, immediate applied + projection update, delayed applied
link + projection update, event-only applied + `missing_request`, cancellation link + no
projection update, event-only cancellation + `missing_request`, ambiguous
`rotation_correlation_failed`, `invalid_slot_id`, `invalid_consensus_address`, failed-tx
non-projection, `missing_event`, idempotent rerun, individual reset safety, combined order
includes key rotation after params, combined reset includes key rotation, and preservation of
metadata/payout/lifecycle fields on `CoreSlotProjection`.

`coreslot-semantic-rebuild.test.js` was extended so combined ordering, cursor advance, and
combined reset assertions include key rotation.

Result of `npm --prefix apps/indexer test`:

- 96 tests, 95 passed, 1 skipped (opt-in Postgres integration), 0 failed.

## 11. Optional Local Smoke

Local Postgres available; migration applied via `npm run db:deploy`.

Key rotation projection over 119..121 (`RESET_PROJECTION=true`):

- `CoreSlotConsensusKeyRotation = 0`
- key rotation `ProjectionFailure = 0`
- cursor idle at 121

Combined semantic rebuild over 119..121 (`RESET_PROJECTION=true`):

- `CoreSlotProjection = 1`
- `CoreSlotMetadataChange = 1`
- `CoreSlotLifecycleEvent = 0`
- `CoreSlotPayoutChange = 0`
- `CoreSlotParameterChange = 0`
- `CoreSlotConsensusKeyRotation = 0`
- all five CoreSlot projection cursors idle at 121
- generic rows preserved (Block = 3, Tx = 1, Message = 1, Event = 5)

The known smoke range is metadata-only, so zero rotation rows is expected and correct.

## 12. Known Limitations

- Temporal consensus map / validator-set timeline not implemented yet (Phase 6b-2).
- `coreslot_validator_update_emitted` is not projected into validator-set windows yet.
- Block signature / liveness ingestion not implemented.
- A live localnet delayed-rotation / cancellation fixture is still pending; correlation paths
  are covered by synthetic unit fixtures only.
- Rewards, API, and web are not implemented.

## 13. Explicit Non-Goals

- No temporal consensus map / ValidatorSetTimeline.
- No proposer-to-slot enrichment.
- No block signature / liveness windows.
- No rewards projection.
- No API routes or web pages.
- No generated gRPC clients, buf migration, or chain repo changes.
- No bech32 consensus-address decoding (hex-only).
- No staking/gov/mint/distribution compatibility.

## 14. Next Recommended Step

Phase 6b-2: temporal consensus map / ValidatorSetTimeline, building
`consensusAddress -> slotId/operator` windows from lifecycle and key-rotation history, which
then unlocks proposer-to-slot joins and liveness projection.
