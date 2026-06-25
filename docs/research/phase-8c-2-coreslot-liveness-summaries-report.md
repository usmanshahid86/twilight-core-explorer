# Phase 8c-2 — CoreSlot Liveness Summaries Report

Date: 2026-06-26

Status: **PASS.**

Adds `coreslot_liveness_summary_v1` / `CoreSlotLivenessSummary`: rebuildable aggregate summaries over
accepted `CoreSlotLivenessEvidence`, one row per `(slotId, windowKind)` for windows
`{lifetime, recent_100, recent_500, recent_1000}`. Numeric only — no health labels (8c-3), no
proposer/API/web, no live RPC/genesis/validator-set reads, no re-reading 8a/8b to recompute misses.
Includes a small 8c-1 prerequisite (exact failure→height stamping).

## Prerequisite (8c-1 follow-up)

`ProjectionFailure` gained a nullable, reusable `committedHeight BigInt?` column (migration
`20260626000100_projection_failure_committed_height`). `coreslot_liveness_v1`'s height-level failure
branch now stamps the exact committed height. This lets 8c-2 map an invalidated height precisely
(never `sourceHeight − 1`). No output change on the clean fixture (0 liveness failures); a regression
test asserts the stamp using a committed≠source case.

## Files changed

New: `apps/indexer/src/projections/coreslot-liveness-summary.ts` (projector),
`coreslot-liveness-summary-cli.ts`, `reset-coreslot-liveness-summary.ts` (+ `-cli.ts`),
`apps/indexer/test/projections/coreslot-liveness-summary.test.js`, migrations
`20260626000100_projection_failure_committed_height` + `20260626000200_coreslot_liveness_summary`.
Edited: `prisma/schema.prisma` (`ProjectionFailure.committedHeight`, `CoreSlotLivenessSummary`),
`apps/indexer/src/projections/types.ts` (summary projection name, window-kind/status consts,
`ProjectionFailureInput.committedHeight`, `liveness_summary_invariant_violation`),
`coreslot-liveness.ts` (stamp committedHeight) + its test, `apps/indexer/package.json` (scripts),
checkpoint + runbook.

## Model / grain

`CoreSlotLivenessSummary`, grain `(slotId, windowKind)`, `summaryKey` =
`coreslot_liveness_summary_v1:{slotId}:{windowKind}`. Slot-level (latest operator/consensus stored as
descriptive fields, not grouping keys). Coverage fields `firstCommittedHeight`/`lastCommittedHeight`/
`spanHeightCount`/`evidenceHeightCount`; counts `expected`/`signed`/`missed`/`absentMissed`/`nilMissed`;
derived `uptimeBps`/`currentSignedStreak`/`currentMissedStreak`/`latestMissedHeight`; quality
`invalidHeightCount`/`summaryStatus`. (No `latestCommittedHeight` — `lastCommittedHeight` is it.)

## Algorithm

Full recompute in one transaction: distinct slots from evidence → per slot load rows ordered by
committed height → derive the four windows from one in-memory list (`recent_N` = trailing N present
rows) → compute counts/streaks/uptime/coverage → delete-all + `createMany`. Cursor records max
committed height (observability only). `uptimeBps = floor(signedCount * 10000 / expectedCount)` via
BigInt (null when expected = 0).

## Failure / incomplete policy (exact)

`invalidHeightCount` = distinct exact `ProjectionFailure.committedHeight` (unresolved,
`coreslot_liveness_v1`) inside `[firstCommittedHeight, lastCommittedHeight]`; `summaryStatus =
incomplete` iff `> 0`. Coverage flag only — it never changes the counts (an invalidated height has no
evidence row, so it is invisible to counts; this is the only signal it is missing). recent_N is
*selected* by trailing N evidence rows but `invalidHeightCount` is *counted* over the numeric span.
Per-slot evidence-shape invariant violation → `liveness_summary_invariant_violation`, slot skipped.

## Tests

14 mock-Prisma cases (all-signed; absent/nil; uptime floor 8861 + recent_100 5900; empty; sparse
span/gap; failure-in-span → incomplete; failure-outside → complete; latest-operator-wins; recent_N
truncation; invariant violation → skip; idempotent rerun; reset isolation; no-scope-leak) + the 8c-1
stamp test. Indexer suite: **224 tests, 222 pass / 0 fail / 2 skipped**.

## Local live smoke (accepted 4-CoreSlot drill, 1440 evidence rows)

`RESET_PROJECTION=true npm --prefix apps/indexer run project:coreslot-liveness-summary` → 16 rows.

| windowKind | slot | expected | signed | missed | uptimeBps | status |
|-----------|------|----------|--------|--------|-----------|--------|
| lifetime | 1/2/3 | 360 | 360 | 0 | 10000 | complete |
| lifetime | 4 | 360 | 319 | 41 (39 abs + 2 nil) | **8861** | complete |
| recent_100 | 4 | 100 | 59 | 41 | **5900** | complete |
| recent_500 | 4 | 360 | 319 | 41 | 8861 | complete |
| recent_1000 | 4 | 360 | 319 | 41 | 8861 | complete |

recent_100 = 5900 verified from DB (all 41 misses, committed heights 296–348, fall in the trailing
100 heights 261–360). recent_500/1000 collapse to lifetime (only 360 heights exist). 0 incomplete
rows, 0 unresolved `coreslot_liveness_summary_v1` failures.

## Validation commands

```sh
npm run db:generate
npm run db:deploy          # applies 20260626000100 + 20260626000200
npm run typecheck          # clean
npm run build              # clean
npm --prefix apps/indexer test          # 224 / 222 pass / 2 skip
npm --prefix packages/chain-client test # pass
npm run lint               # clean
git diff --check           # clean
# live: RESET_PROJECTION=true npm --prefix apps/indexer run project:coreslot-liveness-summary
```

Run order (standalone, after the signature/liveness chain): `… operator_signing_evidence →
coreslot_liveness → coreslot_liveness_summary`.

## Known limitations

- Numeric only; health labels/thresholds (`healthy`/`degraded`/`down`) deferred to **8c-3**.
- Slot-level grain; per-`(slotId, operatorAddress)` breakdown deferred (evidence retains history, so
  addable later without re-ingest).
- Full recompute loads evidence per slot; fine at fixture scale, revisit for very large histories.
- Streaks count consecutive PRESENT evidence observations (not contiguous block heights) — exact on
  the contiguous fixture; on a sparse range they count observations across gaps (documented).
- `gapCount` not enumerated; `spanHeightCount − evidenceHeightCount` exposes it.
