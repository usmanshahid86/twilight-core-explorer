# Phase 13c-1 — Workspace Linter + Static Guards — Report

Date: 2026-06-28
Branch: `feat/13c-1-linter-static-guards`
Plan: `phase-13-explorer-hardening-plan.md` §6 (13c-1) · Audit: `phase-13a-explorer-hardening-audit.md` (M-016)
Status: **PASS** (implemented, full ritual green; pending independent review).

## Scope

The first 13c slice: close the **"lint is a no-op"** debt (audit M-016) and make the **manual static
guards durable**. Two parts, with the two failure policies the plan locked (warn-only baseline vs.
hard-fail invariants). No runtime/app behavior change; no API/OpenAPI/schema change.

## Part A — workspace linter (warn-only baseline)

Before: only `apps/web` linted (`next lint`); `apps/api`, `apps/indexer`, and every `packages/*` had **no
`lint` script**, so root `npm run lint` (`--workspaces --if-present`) silently skipped them — green but
vacuous (M-016).

- Installed `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` `7.18.0` (ESLint-8.57
  compatible) + declared `eslint` at the root.
- Added a shared root **`.eslintrc.cjs`** for the non-Next TS workspaces (`root:true`, parser + plugin,
  `eslint:recommended` + `@typescript-eslint/recommended` *non-type-checked* — fast, low-noise), ignoring
  `dist`/`generated`/`node_modules`/`packages/proto`/`apps/web`. Set `apps/web/.eslintrc.json` `root:true`
  so it stays isolated on `next lint`.
- Added a `lint` script (`eslint src --ext .ts`) to `apps/api`, `apps/indexer`, `packages/{chain-client,
  config,db,decoder}`.
- **Warn-only**: every rule that fires today is a *warning*, so `npm run lint` exits 0 and the baseline is
  visible without blocking. The codebase is clean — only **4 warnings** across ~136 TS files (a
  non-null-assertion, two empty/namespace, an empty-interface); the one error (`no-namespace` in
  `packages/config`) was downgraded to warn rather than refactored (out of scope for a warn-only pass).
  Promotion of selected rules to `error` is a later pass.

Result: **`npm run lint` now genuinely exercises all 8 workspaces** and exits 0.

## Part B — automated repo invariant guards (HARD-FAIL)

The CLAUDE.md validation ritual required a human to run + eyeball static greps for unsupported-route
implementations and stale gate references. 13c-1 makes them **hard-fail tests** in the standard `npm
test` path.

- New `scripts/guards/repo-invariants.test.js` (ESM `node --test`) scans hand-written runtime source
  (`apps/*/src`, `packages/*/src`, `prisma/schema.prisma`; excludes docs/generated/dist/tests/`.d.ts`)
  and asserts **zero** occurrences — on non-comment lines — of:
  - `/twilight/coreslot/v1/slots/active` (the stale active-slots route),
  - `/cosmos/{staking,gov,mint,distribution}` (unsupported standard modules),
  - `gated_by_phase_7_2` (retired; the read-only posture is `read_only_no_claim_action`).
- Comment lines are ignored (a URL-safe line heuristic, not regex comment-stripping which mis-handles
  `https://`) so the one historical reference — a `//` correction note in `apps/api/src/dto/rewards.ts`
  — does not trip the guard. A `scans >100 files` assertion prevents a vacuous pass.
- Wired via root `"test:guards"` + `"test": "npm run test:guards && npm run test --workspaces …"` →
  it runs first in every `npm test`.

The other Convert-to-Guard invariants are **already hard-fail tests** and were left as-is (no
duplication): `apps/web/src/lib/boundary.test.ts` (web DB/RPC/fetch boundary, incl. `/cosmos/` in web
source), `apps/web/src/lib/api/coverage.test.ts` (every OpenAPI path consumed), and `openapi:check`
(api + web contract drift). Two pre-existing guards already cover `/cosmos/*`: an **indexer-scoped** one
(`apps/indexer/test/ingest-height.test.js`) and a **repo-wide** one
(`packages/chain-client/test/route-contract.test.js` → `walkFiles(repoRoot)`, `/cosmos/<module>/`). The
new guard *consolidates + extends* them — it adds the two checks neither covered (`slots/active`,
`gated_by_phase_7_2`); the `/cosmos` overlap is harmless defense-in-depth, both left in place.
**Cross-guard note:** because the chain-client guard scans every file for a literal `/cosmos/<module>/`,
this guard's **self-test fixtures assemble those paths at runtime** (the literal never appears in the
file) — the same self-non-matching technique the chain-client test uses for its own regex literals.
Caught by running the FULL `npm test` (not just `test:guards`), which exercises the chain-client
repo-wide scan over the new file.

## Validation (all green)

root `typecheck` · **`lint` (now all 8 workspaces, warn-only, exit 0, 4 warnings)** · **`test` (runs
`test:guards` 4/4 first, then all workspaces)** · `apps/web test` · `openapi:check` api + web up to date ·
web `build` ✓ · `git diff --check` clean.

## Notes / scope boundary

- Warn-only is the *general* baseline; the load-bearing project invariants are the hard-fail tests above
  (plan guardrail #4 — never weakened by warn-only).
- Test files (`*.test.{ts,tsx,js}`) are not yet linted (first pass targets `src`); type-checked ESLint
  and `error`-promotion are deferred to a later tightening pass.
- The manual CLAUDE.md greps remain documented as a quick check, now backed by the automated guard.

## Review

**Adversarial-reviewer subagent: PASS** (0 blockers/majors). It actively disproved both failure modes:
the lint genuinely processes **51 api + 73 indexer + 12 package** files (21 active `@typescript-eslint`
rules via `--print-config`), and the guard **flags a planted `/cosmos/staking` violation** while skipping
the legit comment (scans 232 files). Folded in:
- **N1** (guard robustness) — a forbidden route on a line *starting* with an inline block comment
  (`/* x */ apiGet(...)`) evaded the coarse heuristic. Fixed: strip a leading inline block comment before
  classifying, and added **self-tests** (`lineViolates`) proving the guard catches a planted violation,
  fixes N1, stays URL-safe (`https://…/cosmos/…` is flagged, not over-stripped), and ignores full-line
  comments. (The self-test caught a bug in my first attempt — `isComment` short-circuited before the
  strip — now reordered.) Guard now 8/8.

Deferred per the locked contract (lint-tightening follow-up): **N2** — a *trailing* comment mention of a
banned route is still flagged (errs strict; documented in-code that such mentions must be full-line
comments); **N3** — guard scans `src` + `schema.prisma` only (runtime-code threat model; the web
boundary + indexer guards cover their areas); **N4** — warn-only downgrades only the rules that fire
today, so a *future* new violation of an un-downgraded recommended-error rule can block (consistent with
the plan's "a large initial count can't stall 13c", and arguably desirable). **External (Codex) review:
pending** (user-run).

## Files touched

`.eslintrc.cjs` (new), `apps/web/.eslintrc.json` (`root:true`), `package.json` (root: deps +
`test:guards` + `test` wiring), `apps/{api,indexer}/package.json` + `packages/{chain-client,config,db,
decoder}/package.json` (`lint` script), `scripts/guards/repo-invariants.test.js` (new), this report,
`package-lock.json`. No `src` runtime change.
