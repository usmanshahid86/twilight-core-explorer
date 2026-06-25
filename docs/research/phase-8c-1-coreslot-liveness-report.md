# Phase 8c-1 — CoreSlot Liveness Evidence Report

Date: 2026-06-25

Status: **PASS.**

Adds `coreslot_liveness_v1` / `CoreSlotLivenessEvidence`: the atomic per-(committed height, expected
active CoreSlot) liveness projection. One row per expected signer marks `signed` or `missed`, with
the miss cause (`absent` | `nil`). Misses are computed by **set-difference** — the
`phase-8c-0c-liveness-drill-report.md` proved an absent validator is anonymous in the commit, so a
miss can never be read off a flag. Scope is strictly CoreSlots-only; no uptime %, rolling summaries,
current health, proposer enrichment, API, or web (all deferred to 8c-2+).

## Files changed

New:
- `apps/indexer/src/projections/coreslot-liveness.ts` — projector (`projectCoreSlotLivenessRange` /
  `projectCoreSlotLivenessHeight`, `CoreSlotLivenessProjectionPrisma`).
- `apps/indexer/src/projections/coreslot-liveness-cli.ts` — env + advisory lock + cursor.
- `apps/indexer/src/projections/reset-coreslot-liveness.ts` + `reset-coreslot-liveness-cli.ts`.
- `apps/indexer/test/projections/coreslot-liveness.test.js` — 15 mock-Prisma cases.
- `prisma/migrations/20260625002100_coreslot_liveness_projection/migration.sql`.

Edited:
- `prisma/schema.prisma` — `CoreSlotLivenessEvidence` model.
- `apps/indexer/src/projections/types.ts` — `CORESLOT_LIVENESS_PROJECTION`,
  `CORESLOT_LIVENESS_STATUS`, `CORESLOT_LIVENESS_MISS_CAUSE`, 7 new `ProjectionFailureKind`s.
- `apps/indexer/src/projections/coreslot-temporal-map.ts` — export `ConsensusWindowSource` and new
  `findActiveCoreSlotWindowsAtHeight`.
- `apps/indexer/package.json` — `project:coreslot-liveness` (+ `:dev`, `:reset`).

## Migration

`20260625002100_coreslot_liveness_projection` (verified no collision with the prior latest
`20260625002000_operator_signing_evidence`). Creates `CoreSlotLivenessEvidence` with `evidenceKey`
unique and indexes on `committedBlockHeight`, `slotId`, `operatorAddress`, `consensusAddress`,
`status`, `missCause`. `updatedAtDb` follows the existing schema convention.

## Projection design

- **Input:** materialized `OperatorSigningEvidence` + `CoreSlotConsensusWindow` only. No live RPC,
  genesis, or validator-set reads (rebuildable from generic rows → 8a → 8b → 8c-1).
- **Height axis:** cursor/range on `sourceBlockHeight` (matches 8a/8b). Committed heights to evaluate
  are **read from `OperatorSigningEvidence.committedBlockHeight`**, never derived as `source − 1`.
- **Per committed height H, compute → validate → write:**
  - expected = `findActiveCoreSlotWindowsAtHeight(H)` (one window per slotId).
  - signed = attributed + `signed=true` + flag 2; nil = attributed + `signed=false` + flag 3;
    anonymousAbsentCount = `absent_no_validator` + flag 1.
  - For each expected slot: signed → `signed`; nil → `missed/nil`; else → `missed/absent` (assigned
    only after the absent-count guard passes).
  - **Write = per-height delete + replace** (clears orphans on expected-set shrinkage; idempotent).
- **Both ABSENT and NIL are `missed`**; the cause is retained, never split out. Missed rows carry
  `sourceBlockHeight = null`; signed rows carry the observed source block. NIL rows preserve observed
  provenance (`observedSignatureKey`/flag/signed/attributionStatus); anonymous-absent rows do not
  link to any observed signature.

## Helper export

`findActiveCoreSlotWindowsAtHeight(prisma, committedHeight)` added to the temporal-map module (its
owner of window-boundary semantics). Pure coverage read
(`effectiveFromHeight ≤ H AND (effectiveToHeight IS NULL OR effectiveToHeight > H)`): no current
`CoreSlotProjection.status`, no extra `+2` (already materialized at window-open), never returns
closed/inactive windows. Mirrors `findConsensusWindowAtHeight`.

## Failure guards (hard, height-level)

`duplicate_expected_slot_at_height`, `duplicate_observed_signed_slot_at_height`,
`nil_and_signed_same_slot_height`, `observed_attributed_slot_not_expected`,
`liveness_absent_count_mismatch`, plus `unknown_liveness_shape` / `malformed_liveness_input`.
Empty expected set with no observations is **not** a failure (no rows).

**Failure policy (final):** a hard failure *invalidates the committed height* — the projector
records a deterministic `ProjectionFailure`, **deletes any existing `CoreSlotLivenessEvidence` rows
for that committed height**, writes no new rows, and continues to other heights. This prevents stale
rows from a prior successful run persisting after H later becomes invalid (e.g. upstream temporal/
signing evidence changes). The clean path is unchanged.

## Tests

15 mock-Prisma cases (full pass, 209 indexer tests / 0 fail): full-signed; anonymous-absent;
nil; absent-count mismatch; each of the 4 structural guards; unmapped ignored; empty-expected;
committed≠source grain; idempotent rerun + upstream-change refresh; cursor advance; scoped reset
safety; no-scope-leak source scan.

## Local live smoke (clean 4-CoreSlot drill, heights 1..361)

`RESET_PROJECTION=true npm --prefix apps/indexer run project:coreslot-liveness`:

| metric | result |
|--------|--------|
| total evidence rows | **1440** (360 committed × 4 slots) |
| signed | **1399** |
| missed | **41** — all slot 4 |
| missCause absent | **39** |
| missCause nil | **2** |
| missed for slots 1/2/3 | **0** |
| unresolved `coreslot_liveness_v1` failures | **0** |

The projection's set-difference independently reproduced the manual drill analysis exactly.

## Validation commands

```sh
npm run db:generate
npm run db:deploy            # applies 20260625002100
npm run typecheck            # clean
npm test                     # root: 2 pass
npm --prefix apps/indexer test   # 209 pass / 0 fail / 2 skipped
npm --prefix packages/chain-client test   # 16 pass
npm run lint                 # clean
# live: RESET_PROJECTION=true npm --prefix apps/indexer run project:coreslot-liveness
```

Run order (standalone CLI, after the signature chain):
`coreslot-semantic (incl. genesis-seeded temporal_map) → block_signatures →
operator_signing_evidence → coreslot_liveness`.

## Known limitations

- **Uptime %, rolling summaries, current health are out of scope** (8c-2). 8c-1 is per-height
  evidence only.
- **Mixed-validator chains:** the absent-count guard assumes every anonymous flag-1 absent is a
  CoreSlot. On a chain with non-CoreSlot validators an anonymous absent could be non-CoreSlot, which
  would (correctly, per "ambiguous → ProjectionFailure") trip `liveness_absent_count_mismatch`. The
  target localnet is all-CoreSlot, so it does not arise here; a mixed chain would need an explicit
  expected-vs-observed reconciliation rule.
- **`observed_attributed_slot_not_expected` is a hard failure** and may fire during future
  lifecycle/rotation drills on a `+2` boundary race; that surfaces a temporal-map boundary issue by
  design rather than miscounting.
- Live evidence is from one bounded single-node outage on a 4-operator fixture; broader scenarios
  (multi-node, key rotation mid-outage) remain future fixtures.
