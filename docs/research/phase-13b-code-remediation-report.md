# Phase 13b-code — Correctness Remediation — Report

Date: 2026-06-28
Branch: `feat/13b-code-remediation`
Plan: `phase-13-explorer-hardening-plan.md` §5.1 · Audit: `phase-13a-explorer-hardening-audit.md`
Status: **PASS** (implemented, typechecked, full ritual green; pending independent review).

## Scope

The correctness half of Phase 13b — the code-correctness findings from the 13a audit + the one
pulled-in follow-up (FU-1), each shipped with a durable guard or a failing-before test (plan
guardrails #4/#5). UX/a11y (13b-ux) and the status-filter feature (13b-filters) are separate slices.
**No API/contract change** (web + indexer only; `openapi:check` stays green).

## Fixes

### M-003 — `deriveSampleAge` no longer overstates "sample current" (correctness/trust)
`apps/web/src/lib/freshness.ts` + `components/freshness/Freshness.tsx`. When a sample height is present
but the latest indexed height is unavailable (status pending/errored), `deriveSampleAge` returned
`{kind:'fresh', deltaBlocks:'0'}` → a green "sample current" badge asserting freshness it could not
verify. Added a `{kind:'unknown'}` branch; `SampleAgeLabel` renders it as a neutral "sample age
unknown". The sampled height is still shown truthfully (this was never a fabricated-zero).
**Guard:** `freshness.test.ts` (`deriveSampleAge('100', null)` / `('100','abc')` → `unknown`) +
`Freshness.test.tsx` (label is "sample age unknown", never "sample current").

### J-001 — decode-failures surfaced on `/api` diagnostics (coverage gap → resolved)
`apps/web/src/lib/api/queries.ts` (new `useDecodeFailures` hook, bounded "latest unresolved", newest
first) + `app/api/page.tsx` (a "Decode failures" card beside Projections; healthy chain → "No
unresolved decode failures."). The endpoint was specified + indexed but had no UI consumer — a monitor
could not see unresolved decode failures. **Guard (durable):** new `apps/web/src/lib/api/coverage.test.ts`
— loads `openapi.json` and asserts **every** path is consumed by a typed-client source (`queries.ts` /
`operator-resolver.ts`) or explicitly allowlisted as internal (`/health/live`, `/health/ready`).
Fails CI the next time an endpoint ships without a consumer. (33/33: 32 paths + breadth.)

### M-001 — deleted dead `PlaceholderPage.tsx`
`git rm apps/web/src/components/PlaceholderPage.tsx` — unused by any route (all 18 are real). Removed
stale "arrives in Phase X" messaging. **Guard:** a knip/unused-export check belongs to 13c-1; for now
the deletion is covered by build + the coverage test's "all routes real" reality.

### M-002 — content-based React keys in `TxDetail`
`apps/web/src/components/txs/TxDetail.tsx` — signers keyed `${a}-${i}`, events `${e.phase}-${e.type}-${i}`
(was bare `key={i}`). No live bug (these lists don't reorder) but it's the anti-pattern. **Guard:** moving
off *bare* index keys reduces collision risk now; note the `react/no-array-index-key` rule (wired in 13c-1)
also flags index identifiers embedded in template literals, so this fix does not by itself make the rule
clean — 13c-1 decides whether to allow the justified content+index keys (these lists have no stable unique
id) or add a scoped disable.

### FU-1 — temporal-map genesis `ProjectionFailure` durability (pulled in per plan §5.1)
`apps/indexer/src/projections/coreslot-temporal-map.ts`. The genesis seed stamped its failures
(`genesis_unavailable` / `genesis_coreslot_malformed` / `invalid_consensus_address` /
`temporal_window_conflict`) at `sourceHeight: 1n`, but `projectCoreSlotTemporalMapHeight` deletes
failures by `sourceHeight = height` **unscoped by failureKind**; on a full rebuild it runs at height 1
and silently wiped genesis failures — so a malformed/ambiguous genesis was *not* durably surfaced
(violating the "ambiguous history → ProjectionFailure" invariant). Fix: a `GENESIS_SEED_FAILURE_SOURCE_HEIGHT
= 0n` sentinel (below any real block height; nothing else uses 0) for all genesis-seed failures and the
re-seed cleanup (now unscoped, since the whole sentinel is the genesis-failure namespace → idempotent
across every kind). Mirrors the `coreslot-genesis-identity` 0n fix. The window record is unaffected
(`effectiveFromHeight` stays 1n; the window does not store `sourceHeight`). **Guard:** a failing-before
test in `coreslot-temporal-map.test.js` — a genesis failure is stamped at `0n` and **survives** a
height-1 `projectCoreSlotTemporalMapHeight` cleanup (pre-fix it was deleted).

## J-002 — deferred rewards-side filters (documented per plan §5.1)

The status filters (`coreslots?status=`, `txs?status=`) ship in the separate **13b-filters** slice. The
remaining unused filter params are **deliberately deferred** to a later "rewards filters" follow-up (they
operate on already-narrow datasets and each carries its own input-control design): claims `txHash` /
`fromHeight` / `toHeight`; balances `sampleKind` / `denom` / `height`; rewards-params `changeType`. The
API already serves them (no contract change when surfaced later). The existing `?slotId=` cross-link
(12c) is unchanged.

## New tests / guards

- `apps/web/src/lib/api/coverage.test.ts` (NEW) — OpenAPI-path→consumer coverage guard (J-001).
- `apps/web/src/lib/freshness.test.ts` — `unknown` cases (M-003).
- `apps/web/src/components/freshness/Freshness.test.tsx` — `SampleAgeLabel`/`SampledAtNote` unknown (M-003).
- `apps/indexer/test/projections/coreslot-temporal-map.test.js` — genesis-failure durability (FU-1).

## Validation (all green)

root `typecheck` · `lint` · `test` · `apps/api test` **114** · `apps/indexer test` **275 pass** (+1
FU-1 durability test) · `chain-client test` · `apps/web test` **33 files** (+1 `coverage.test.ts`;
coverage guard 33/33) · `api openapi:check` + `web openapi:check` **up to date** (no contract change) ·
web `build` ✓ · static route guards clean. Diff: web + indexer only — 9 modified + 1 deleted tracked +
2 new (`lib/api/coverage.test.ts`, this report); no schema/API/OpenAPI change.

## Review

**Adversarial-reviewer subagent: PASS** (0 blockers, 0 majors). Folded in:
- **MIN-1** — the FU-1 re-seed `deleteMany` was unscoped over the `0n` sentinel, which could collaterally
  delete a malformed-rotation failure that also falls back to `0n` (`projectRotation ?? 0n`). Re-scoped to
  the genesis failure kinds (`GENESIS_SEED_FAILURE_KINDS`) so it only ever clears genesis-seed failures.
- **NOTE-1** — strengthened the FU-1 test with a live control failure at `(1n, resolved:false)`: the
  control is deleted by the height-1 cleanup (proving it is live) while the `0n` genesis failure survives,
  so the durability assertion is no longer vacuous under the mock.
- **NOTE-2** — corrected this report's M-002 lint claim.

Residual (tracked, non-blocking): `projectRotation`'s `?? 0n` fallback shares the genesis sentinel
namespace — a future cleanup should move it off `0n`; the `START_HEIGHT=0` edge mirrors the accepted
`genesis-identity` assumption (height 0 never revisited). **External (Codex) review: pending** (user-run).

## Files touched

web: `lib/freshness.ts`, `components/freshness/Freshness.tsx`, `lib/api/queries.ts`, `app/api/page.tsx`,
`components/txs/TxDetail.tsx`, deleted `components/PlaceholderPage.tsx`, + 3 test files.
indexer: `projections/coreslot-temporal-map.ts` + its test.
No schema, no API route, no OpenAPI change.
