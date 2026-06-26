# Phase 10a — Web Foundation — Implementation Report

**Status: COMPLETE** (implemented, typechecked, linted, tested, built). Date: 2026-06-27.
Branch: `feat/10a-web-foundation`.

The frontend foundation: a new `apps/web` (Next.js 14 app-router + Tailwind) that consumes the frozen
Phase 9 API through a typed, generated client, extracts the reference `auction` theme, and ships the
Overview page, a search shell, the freshness model, the standard states, and tests. Per the locked
plan, no full generic/CoreSlot/rewards pages were built — those routes are clear phase-tagged
placeholders.

## 1. Files changed

New workspace `apps/web` — 69 files. Root `package-lock.json` updated by `npm install` (adds the
web toolchain). No existing files in `apps/api`/`apps/indexer`/`packages/*` were modified.

Key files:
- Config: `package.json`, `tsconfig.json` (Next-style: `bundler` resolution, `jsx: preserve`,
  `noEmit`, mirroring `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`),
  `next.config.js` (minimal safe headers), `tailwind.config.js`, `postcss.config.js`,
  `vitest.config.ts`, `.eslintrc.json`, `.env.example`, `.gitignore`, `scripts/check-openapi-drift.mjs`.
- API layer: `src/lib/api/{client.ts, queries.ts, pagination.ts, generated/schema.d.ts}`, `src/lib/env.ts`.
- Formatting/model: `src/lib/format/{height,amount,address,time,bps,status}.ts`, `src/lib/freshness.ts`,
  `src/lib/search.ts`.
- Shell/UI: `src/app/{layout,globals.css,providers,page,not-found,error}.tsx`, `src/components/`
  (`Header`, `Footer`, `SearchBar`, `SearchResults`, `SearchResultsPicker`, `PlaceholderPage`,
  `QueryBoundary`, `ui/*`, `states/States`, `freshness/Freshness`, `overview/*Panels`).
- Tests: 11 `*.test.ts(x)` files (40 tests, including the §11 Codex-patch and §12 Copilot-fix additions).

## 2. Packages added

Dependencies: `next@^14.2`, `react@^18.3`, `react-dom@^18.3`, `@tanstack/react-query@^5`, `clsx`,
`date-fns@^3`, `lucide-react`.
Dev: `typescript@^5.5`, `@types/{node,react,react-dom}`, `tailwindcss@^3.4`, `postcss`, `autoprefixer`,
`eslint@^8` + `eslint-config-next@^14.2`, `openapi-typescript@^7`, `vitest@^2`,
`@testing-library/{react,jest-dom,user-event}`, `jsdom`, `@vitejs/plugin-react`.

`recharts` was deliberately **not** carried over (charts deferred).

## 3. Copied/adapted reference files (visual only)

From `reference/twilight-explorer/packages/web` — visual/shell layer only, re-typed/reshaped:
- `tailwind.config.js` theme tokens → adapted (content globs repointed to `apps/web/src`).
- `globals.css` CSS-variable theme bridge (`auction` default + `legacy`) → copied.
- `next/font` setup (Inter / Instrument Serif / Roboto Mono) and 1432px shell → adapted into `layout.tsx`.
- `postcss.config.js` → copied.
- Card/table/loading/badge primitives → re-implemented around Phase 9 types (not copied verbatim).

**Not copied** (prior bridge/ZkOS domain): `src/lib/api.ts` (offset pagination + numeric heights —
contradicts our keyset + string rules), the Header `navGroups` (Deposits/Withdrawals/Fragments/
Validators), `ZkosTransactionViewer`, `recharts`, all mock data and bridge/wallet logic. The nav was
re-authored to the Twilight IA.

## 4. API client generation details

- Generator: `openapi-typescript@7.13` (OpenAPI 3.1-native). Input: `docs/reference/openapi.json`.
- Output (committed): `apps/web/src/lib/api/generated/schema.d.ts` (2,501 lines, types-only).
- Commands: `npm run openapi:gen` (regenerate), `npm run openapi:check` (regenerate-to-temp + diff,
  non-zero on drift). Drift check **passes**.
- Runtime: a thin typed `apiGet()` wrapper (`client.ts`) — GET-only, response types derived from the
  generated `paths`, base URL from `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:8080`). It
  unwraps `{ data }` / `{ data, page }` and throws `ApiError` (carrying `error.code`) on `{ error }`
  or transport failure (synthetic `network_unavailable`). UI branches on `error.code`, never message
  text. Cursors are opaque; `nextCursor: null` = end; never synthesized.

## 5. Route list (13 routes, all build as static shells)

`/` (Overview, real data) · `/search` (resolves via `/api/v1/search`) · `/api` (diagnostics, real
data) · placeholders: `/blocks` `/txs` `/accounts` (Phase 10b), `/coreslots` `/liveness` (Phase 11),
`/rewards` `/supply` (Phase 12) · root `not-found` + `error`.

## 6. Overview endpoint coverage

All nine locked endpoints are consumed via TanStack Query: `/status`, `/projections`, `/blocks`,
`/txs`, `/coreslots`, `/network/validator-set`, `/network/proposers`, `/network/liveness-risk`,
`/supply`. Panels: Chain status, Indexer & projection freshness, Latest blocks, Recent transactions,
CoreSlot active set, Network liveness risk, Supply (with sampled-at-height + age). Operational summary,
not every field.

## 7. Tests and validation output

`apps/web` Vitest: **40 tests / 11 files / all pass** (incl. §11 Codex-patch + §12 Copilot-fix tests) — API client envelopes + `error.code` branching +
`network_unavailable`; formatters preserve strings & int64 precision; `utwlt→TWLT` preserves raw;
freshness states (BigInt math); `sampled:false` renders "no sample" (never 0); Overview renders mock
data; search ambiguity → picker and single-strong → navigation; generated-client present/covered; the
DB-only boundary guard (no DB/chain/RPC imports; only `client.ts` calls `fetch`).

Full ritual (all green):
- `npm install` — ok (web toolchain added).
- `npm run typecheck` (root, all workspaces) — exit 0.
- `npm run build` (web) — compiled; **13/13 routes prerendered**; first-load JS ~87–116 kB.
- `npm test` (root) — exit 0: `apps/api` 114 pass, `apps/web` 40 pass, indexer/proto/etc pass.
- `npm --prefix apps/web run openapi:check` — "up to date".
- `npm --prefix apps/web run lint` — no warnings/errors.
- `git diff --check` — clean. `git status` — only `package-lock.json` modified + `apps/web/` new; no
  `.next`/`dist`/`node_modules` tracked (nested `.gitignore`).

## 8. Known limitations

- Overview/search were validated against **mock fixtures + the build prerender**, not a live API in
  this environment. Running pages need `NEXT_PUBLIC_API_BASE_URL` pointed at a running Phase 9 API.
- Placeholder routes are intentional stubs (no list/detail yet).
- "API unavailable" is surfaced per-panel via `ErrorState`; a single global top-of-page banner is
  deferred (per-panel coverage is sufficient for 10a).
- `npm audit` reports transitive advisories from the Next 14 / eslint 8 toolchain — triage in Phase 13.

## 9. Local visual notes (no screenshots in this environment)

The build prerendered all routes; the shell applies the `auction` theme (gold `#E89E28` on `#050505`,
Inter/Instrument Serif/Roboto Mono), a fixed header with the global search + Twilight IA nav, the
1432px content column, and the footer. Panels render skeleton loaders until their query resolves
(client-leaning), then cards/tables/badges. To view locally: `npm --prefix apps/web run dev` with the
API running.

## 10. Explicit deferrals

- Charts (no `recharts`) — deferred; cards/tables/badges/placeholders only.
- Full generic pages (blocks/txs/accounts) → Phase 10b; CoreSlot/liveness → Phase 11; rewards/supply
  → Phase 12; Operator page → Phase 11.
- Phase 7.2 claim-truth: rewards UI (Phase 12) keeps `gated_by_phase_7_2`/`claimSemantics` visible.
- CORS: the API has `@fastify/cors`; the web origin must be allowed at runtime (deployment config).
- Branding: reused reference logo/marks conceptually; final assets can be swapped later.
- Full CSP / observability / rate limiting → Phase 13 (only `nosniff`/`DENY`/referrer headers now).

## 11. Codex PARTIAL patch (2026-06-27)

Addressed the two merge blockers + one hardening note from Codex's PARTIAL review; scope unchanged
(no 10b pages, no charts).

- **Blocker 1 — validator-set height (contract bug):** the generated schema marks
  `/api/v1/network/validator-set` `query: { height: string }` as **required** (heightless call → 400).
  `useValidatorSet(height)` now takes a required height, is `enabled` only when a non-empty height
  string is present, includes height in the queryKey, and sends it via the typed wrapper. The Overview
  derives the height from `/api/v1/status` (`indexer.lastIndexedHeight`, validated as digits — no
  `Number()`, no hardcode, no synthesis). When status is unavailable or no height can be derived, the
  validator-set metric renders an explicit "awaiting height…/unavailable" state and **issues no call**.
- **Blocker 2 — incorrect "active" count:** the metric no longer equates `removedHeight === null`
  with active. The Overview now shows **"Active validator set"** = the validator set at the latest
  height (the canonical active set), and relabels the `/coreslots` count as **"Registered CoreSlots"**.
  Pending/inactive/non-removed slots are no longer counted as active.
- **Hardening — boundary guard:** `boundary.test.ts` now scans `src/**` **plus** `package.json` and
  `next.config.js`/`tsconfig.json`, and adds forbidden checks for `DATABASE_URL`,
  `@twilight-explorer/config`, `loadConfig`, `node:http`, `node:https`, `@twilight-explorer/db`, and
  direct chain-client/RPC/REST host strings. The `fetch()` allowlist (typed API client only) is kept;
  `fetch` is not banned globally.

Tests added/updated: `src/lib/api/queries.test.tsx` (validator-set requires height; disabled + no call
when absent; called with `{ height }` when present); `src/components/overview/NetworkPanels.test.tsx`
(active = validator-set count not non-removed registry count; registry relabeled; unavailable + no
validator-set call when height missing); expanded `src/lib/boundary.test.ts`.

Validation (all green): `typecheck` (root, exit 0); `apps/web` build 13/13 routes; `apps/web` Vitest
**39/39** (was 35; +4); root `test` exit 0 (api 114, indexer 258, web 39, chain-client 16);
`openapi:check` up to date; `next lint` clean; `git diff --check` clean.

## 12. Copilot PR #17 review fixes (2026-06-27)

Three issues from Copilot's PR review; scope unchanged.

- **Theme-override bug (`src/app/layout.tsx`):** the page wrapper `<div>` hardcoded `bg-[#050505]`,
  pinning the background to the auction palette and preventing the `legacy` theme from switching it.
  Replaced with the `bg-background` token (resolves to `var(--background)`), so each `data-theme`
  controls its own background. Added a regression guard (`src/app/theme-tokens.test.ts`) that fails if
  any component reintroduces a hardcoded `bg-[#…]` background. Web tests: 39 → **40**.
- **Report test-count consistency (this report):** §2 and §7 reported "35 tests / 8 files" (the
  initial-implementation count) while §11 reported 39/39 after the Codex patch. Updated §2/§7 to the
  current totals and added this section so the counts are internally consistent.

Validation (all green): `typecheck` exit 0; `apps/web` build 13/13; `apps/web` Vitest **40/40**;
root `test` exit 0; `openapi:check` up to date; `next lint` clean; `git diff --check` clean.

**Phase 10a Web Foundation: COMPLETE (Codex PASS; Copilot PR fixes applied) — ready to merge.**
