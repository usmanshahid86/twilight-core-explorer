# Phase 13d-1 + 13d-2 — RC Checklist + Release-Readiness doc — Report

Date: 2026-06-28
Branch: `feat/13d-rc-checklist`
Plan: `phase-13-explorer-hardening-plan.md` §7 (Phase 13d — RC pass)
Status: implemented (static + contract tiers green; self-reviewed + Codex-review fixes folded in);
pending re-review.

## Scope

This branch delivers two cohesive sub-slices of the 13d **verification** phase: **13d-1** — the keystone
`scripts/rc-check.mjs` (static + contract-conformance tiers) — and **13d-2** —
`docs/operations/explorer-release-readiness.md` (env-variable contract + known-limitations register).
Goal: turn "is the explorer release-ready?" from a prose checklist into an **executable verdict**. The
live soak tier (real-data smoke + projection-status) is wired in 13d-3 when localnet is up; perf/a11y is
13d-4.

## What shipped

- **`scripts/rc-check.mjs`** — runs each check, prints a `PASS`/`FAIL` line, and **exits 0 (RC-green) /
  1 (any fail)**. `npm run rc-check` (full) · `npm run rc-check:smoke` (contract smoke only, fast loop).
- **Static tier** (no live data — CI-runnable): `typecheck` · `lint` (0 errors) · all-workspace `tests`
  · api + web `openapi:check` · the static repo guards (`test:guards`) · web `build`.
- **API contract smoke** — boots the real server via `buildServer` + the in-memory mock Prisma, reads
  `docs/reference/openapi.json`, and **replays every path**: a path passes if it returns one of its
  *declared* statuses with the right envelope (`{data}`/`{data,page}`/`{error}`; health endpoints have
  their own shape). A 500 or an undeclared status or a non-envelope body fails it. **No live DB needed**
  — this is contract conformance, distinct from the data-edge soak (13d-3).

## Key design choices

- **The verdict is recomputed, not asserted.** A green run of the script *is* the gate; the
  release-readiness doc (13d-2+) describes what it checks and records runs, rather than being the source
  of truth.
- **The smoke targets are derived from `openapi.json`, not a hand-list.** A new route is auto-covered;
  an endpoint that returns a non-conforming envelope fails the loop. The gate tests the contract by
  replaying it, so it can't silently drift from the real routes.
- **Two tiers, cleanly separated.** Static (always runnable, including CI) vs live (soak DB, `RC_LIVE`,
  13d-3). A green static run is meaningful on its own.

## Current result

`npm run rc-check` → **GREEN, 40 checks** (7 static + 32 API paths + a coverage guard). Run on `main` @
the 13c merge.

## Self-review hardening (a gate's failure mode is silence)

A release gate is only trustworthy if it goes RED when it should, so the script was hardened against
four silent-failure modes and each was negative-tested:
- **Non-conformance** — corrupting a path's declared status (via `RC_OPENAPI`) correctly FAILs that path
  and exits 1.
- **Wrong envelope category** (Codex review) — the first envelope check accepted any `{data}`-or-`{error}`
  body, so a 200 the spec declares as `{error}` would pass. The expected category is now derived from the
  declared response schema and a mismatch FAILs (verified: a `200`-declared-`{error}` → RED, exit 1).
  Proven in isolation by `--self-test`. (Also added query-param samples so required-query routes get
  success-path coverage, not just a declared 400.)
- **Vacuous green** — an empty/broken `openapi.json` would replay 0 paths and "pass"; a coverage guard
  (`>= 20 paths`) now FAILs it (verified: empty contract → RED, exit 1).
- **Crash** — the smoke is wrapped so a `buildServer`/import throw records a clean FAIL + verdict rather
  than an unhandled rejection.

## Remaining 13d (next sub-slices)
- **13d-3** — the soak: bring up localnet (tuned for sparse `recent_N` / deep-cursor / large-list edges),
  add the **live tier** to `rc-check.mjs` (real-data smoke + projection-status), run primary (devnet) +
  complementary (localnet) and record both; divergence is a finding.
- **13d-4** — bundle/perf (web bundle, `/liveness` fan-out, API N+1) + a11y (axe + manual keyboard).
- RC gate: checklist all-green + adversarial + Codex PASS → the release-readiness doc + `explorer-phase-13` tag.

## Validation
`npm run rc-check` exits 0 (40 checks green); `node scripts/rc-check.mjs --self-test` proves the
envelope-category gate. The script adds no product code — it orchestrates the existing ritual + a
contract replay. No API/schema/contract change.
