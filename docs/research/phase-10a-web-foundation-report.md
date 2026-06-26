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
- Tests: 8 `*.test.ts(x)` files (35 tests).

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

`apps/web` Vitest: **35 tests / 8 files / all pass** — API client envelopes + `error.code` branching +
`network_unavailable`; formatters preserve strings & int64 precision; `utwlt→TWLT` preserves raw;
freshness states (BigInt math); `sampled:false` renders "no sample" (never 0); Overview renders mock
data; search ambiguity → picker and single-strong → navigation; generated-client present/covered; the
DB-only boundary guard (no DB/chain/RPC imports; only `client.ts` calls `fetch`).

Full ritual (all green):
- `npm install` — ok (web toolchain added).
- `npm run typecheck` (root, all workspaces) — exit 0.
- `npm run build` (web) — compiled; **13/13 routes prerendered**; first-load JS ~87–116 kB.
- `npm test` (root) — exit 0: `apps/api` 114 pass, `apps/web` 35 pass, indexer/proto/etc pass.
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

**Phase 10a Web Foundation: COMPLETE — ready for Codex review.**
