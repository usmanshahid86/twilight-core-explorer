# Projection conventions & change checklist

A one-page guide for **creating** a new semantic projection or **modifying** an existing one
in `apps/indexer`. The pattern is uniform across CoreSlot (metadata, lifecycle, payout,
params, key rotation, temporal map) and rewards; follow it so projections stay rebuildable,
idempotent, and resettable. See `CLAUDE.md` for the hard invariants this enforces.

## Core rules (never violate)

- Derive only from generic canonical rows (`ExplorerTransaction`, `Message`, `Event`,
  `Block`). Never mutate or delete generic rows from a projector.
- Rebuildable from generic rows + preserved raw payloads. If a value can only come from a
  live snapshot, it is an **observed sample** (store `sampledAtHeight`), not a projection.
- Failed transactions never create semantic state. Block-level effects come from
  `finalize_block_events` (no `txHash`) — load those by type with no txHash filter, and guard
  tx-bound events against failed txs.
- Ambiguous/inconsistent history → `ProjectionFailure` with a deterministic `failureKey`.
  Never guess a value.
- Use `ProjectionCursor` + `ProjectionFailure`. Never reuse `IndexerCursor`.

## Creating a new projection

1. **Schema** (`prisma/schema.prisma`): add the model(s). Give event-driven rows a nullable
   `@unique` source-id (`sourceEventId`/`sourceMessageId`) for idempotent upserts. Index the
   query/join columns.
2. **Migration**: `prisma/migrations/YYYYMMDDNNNNNN_name/migration.sql`, additive where
   possible. Run `npm run db:generate`.
3. **Constants** (`src/projections/types.ts`): add the projection name (`<area>_v1`), type
   URLs, event-type constants, and any new `ProjectionFailureKind` values.
4. **Projector** (`src/projections/<area>.ts`): export `project<Area>Range` /
   `project<Area>Height` and an `<Area>ProjectionPrisma` interface. Per height, in one
   `$transaction`: clear unresolved failures for the height → load successful txs → load
   messages (for those txs) → load events by type → correlate (txHash + msg_index + domain
   keys) → upsert rows / write deterministic failures → `updateProjectionCursorSuccess`. Wrap
   in try/catch that calls `haltProjectionCursorError` and rethrows.
5. **Reset** (`src/projections/reset-<area>.ts`): a transaction deleting only this
   projection's rows + its `ProjectionFailure`/`ProjectionCursor` (scoped by projection name).
   Plus a `reset-<area>-cli.ts`.
6. **CLI** (`src/projections/<area>-cli.ts`): `DATABASE_URL` required; `CHAIN_ID` default
   `twilight-localnet-1`; optional `START_HEIGHT`/`END_HEIGHT`/`RESET_PROJECTION`; acquire
   `withProjectionAdvisoryLock`; default start = cursor + 1, default end = max block height.
7. **Scripts** (`apps/indexer/package.json`): `project:<area>`, `project:<area>:dev`
   (`npm run build && node …`), `project:<area>:reset`.
8. **Combined rebuild** (only if it shares `CoreSlotProjection` or belongs to the CoreSlot
   domain): add a step to `coreslot-semantic-rebuild.ts` in deterministic order and a delete
   to `reset-semantic.ts`. A separate domain (e.g. rewards) gets its **own** reset/rebuild —
   do not wire it into the CoreSlot combined rebuild.
9. **Tests** (`test/projections/<area>.test.js`): in-memory mock-Prisma, `node --test`, no
   live chain. Cover: happy path, no-projection-on-failed-tx, missing/ambiguous correlation
   failures, idempotent rerun, reset isolation (generic + unrelated semantic rows preserved),
   and any conflict/boundary rules.
10. **Report**: `docs/research/phase-*-report.md`; update the checkpoint status.

## Modifying / extending an existing projection

- **New event/message type**: add the constant, extend the projector + tests; if it changes a
  shared field, check combined-rebuild ordering.
- **Schema change**: additive migration; backfill via reset + replay over the **full** indexed
  range (a partial combined reset drops earlier history). Add new columns nullable.
- **Boundary/semantics change** (e.g. the `+2` membership rule): put the value behind a named
  constant, persist provenance (e.g. `validatorUpdateHeight`), update tests with the live
  numbers, and add a correction note to the relevant report — don't rewrite history.
- **Idempotency check**: after any change, confirm a rerun over the same range produces the
  same rows and no duplicate unresolved failures (the existing tests assert this — keep them).
- **Reset scope**: if you add a table, add it to that projection's reset (and the combined
  reset if in-domain) so a rebuild stays clean.

## Before declaring done

Run the validation ritual and static guards in `CLAUDE.md`. For a boundary/semantics change,
confirm against live `/validators` or a localnet fixture when access is available; otherwise
record live validation as pending in the report.
