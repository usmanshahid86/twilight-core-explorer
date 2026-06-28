# Phase 13c — Server Hardening (combined 13c-2 + 13c-3 + 13c-4) — Report

Date: 2026-06-28
Branch: `feat/13c-server-hardening`
Plan: `phase-13-explorer-hardening-plan.md` §6 (13c-2/3/4, consolidated)
Status: implemented; pending multi-lens review + Codex.

## Scope & consolidation

The plan split 13c into four slices; 13c-1 (linter + guards) shipped separately. **13c-2/3/4 are one
subsystem** — Fastify transport hardening — so they are built as a **single slice** (the plan explicitly
permits a combined `phase-13c-*` report). All work is `apps/api` transport + the regenerated OpenAPI/web
client; **no response envelope, route semantics, or chain access changed.** 13d (RC gate) stays separate.

Three locked decisions (chosen with the user): version → **extend `/api/v1/status`** (not a new route);
CORS → **review + document** (real allow-list is a Phase-14 deploy concern); logging → **pino on in prod,
off in dev/test**.

## What shipped (by track)

### A — HTTP hardening
- **A1 Security headers** — `@fastify/helmet` (`plugins/security-headers.ts`), API-tuned: **CSP off in
  non-prod** (the dev-only `/docs` swagger-ui needs inline scripts) and a **strict CSP in production**
  (`default-src 'none'`, no HTML surface there) as defense-in-depth; **`X-Frame-Options: DENY`**
  (frameguard); **CORP `cross-origin`** (public read-only API). Keeps helmet's `nosniff`,
  `Referrer-Policy`, HSTS (ignored over plain HTTP, harmless locally).
- **A2 CORS** — reviewed, not rebuilt; config-driven: reflect-any in non-prod, **deny cross-origin in
  production** unless `CORS_ORIGINS` is set. **Important caveat (multi-lens review):** this posture is
  *contingent on `API_ENV`/`NODE_ENV` resolving to `production`* — an unknown/unset value falls back to
  `development` (permissive). The fail-open default is unchanged (local dev relies on it), but it is now
  made **loud at boot** (a startup `console.warn` in non-prod posture), and a deploy MUST set
  `API_ENV=production`. A stray `*` mixed into a `CORS_ORIGINS` list is now dropped (was silently
  allow-all). Hardening the env resolution to fail-closed at the deploy boundary is a Phase-14 item.
- **A3 ETag + Cache-Control** (`plugins/cache-control.ts`) — **the riskiest part, made strictly safe.**
  ETag added globally (header-only; envelopes untouched). Cache-Control is **fail-safe `no-store` by
  default**; routes opt into **`no-cache` (always-revalidate)** via `config: { cacheControl: 'revalidate' }`
  — applied to the 8 cacheable list+detail routes (blocks/txs/coreslots/accounts). **No `max-age`
  anywhere**, even on "immutable" detail: those responses carry rebuildable semantic-projection fields
  (proposer attribution, decoded messages, and — most pointedly — an **embedded per-CoreSlot health
  snapshot** on `/coreslots/:id`), so revalidation — not a TTL — is the only safe optimization. Net: **no
  response is ever served without
  the server confirming it is current** → cached explorer data can't go stale.

### B — Rate limiting
- `@fastify/rate-limit` (`plugins/rate-limit.ts`), in-process per-IP, behind the plugin so a shared store
  (Redis, Phase 14) can replace it without touching call sites. **Disabled outside production by default**
  (`config.rateLimit`, env-overridable) so dev + the test suite are never throttled. The over-limit
  **429 is shaped into the standard `{ error: { code: 'rate_limited' } }` envelope by the central error
  handler** — not a per-plugin `errorResponseBuilder` (which mis-set the status and bypassed the envelope).

### C — Version + observability
- **C1 Version** — `plugins/build-info.ts` decorates `app.buildInfo` and `/api/v1/status` now returns
  `data.build` = `{ version, gitSha|null, builtAt|null, environment }`. **Build/env values ONLY — no
  chain/RPC** (gitSha/builtAt injected by the build/deploy, null locally). OpenAPI + web client
  regenerated; both `openapi:check` green.
- **C2 Logging** — pino enabled in production (`index.ts` `logger: config.isProduction`), off in
  dev/test. The error handler already logs 500s via `request.log.error` with request context.
- **C3 Observability** — **audited: already sufficient, no new display.** `/status` surfaces
  `projectionFailures` (unresolvedCount + byProjection) and indexer lag (`lagBlocks`/`freshnessSeconds`);
  dedicated `/projections` + `/decode-failures` endpoints exist; the web `/api` page renders all of them.

## Guardrails (held)
- **DB-only API stays DB-only** — version is build/env, never a chain read (enforced by the existing
  `no-chain-guard` test).
- **Envelopes unchanged** — all 114 pre-existing API tests pass untouched; hardening is additive
  (headers + one `data.build` field).
- **No contract drift** — the one schema change (`data.build`) regenerated the spec + web client;
  both `openapi:check` up to date.
- **Caching never serves stale** — `no-store` or revalidating `no-cache` only; no `max-age`.
- **Rate limiter off in dev/test** — the suite is never throttled.

## Tests (`test/hardening.test.js`, 7 new; 121 API total)
Security headers (nosniff + CORP) · `no-store` on `/status` · `no-cache` on `/blocks` · ETag → `304` on
`If-None-Match` · `/status` build fields (no chain) · rate-limit `429` in `{error}` envelope when enabled
· no throttle when disabled.

## Validation (all green)
API typecheck + **121 tests** · web typecheck + **173 tests** · both `openapi:check` up to date ·
lint 0 errors (2 pre-existing warn-only baseline) · build.

## Deferred (documented → Phase 14)
- Shared rate-limit store (Redis) behind the existing plugin interface; the concrete production CORS
  allow-list; injecting real `APP_VERSION`/`GIT_SHA`/`BUILT_AT` at build/deploy time. (A `CHANGELOG.md`
  is seeded at the repo root.)
- **Rate-limit proxy keying (multi-lens review):** the limiter keys on `request.ip`. Behind a reverse
  proxy/CDN without `trustProxy`, all traffic collapses to the proxy IP (one shared bucket). Set
  `trustProxy` + an XFF-aware `keyGenerator` (or limit at the edge) when the deploy topology is known.
- **Fail-closed env resolution** at the deploy boundary (require an explicit `API_ENV=production`), so
  the production security posture can't be silently disabled by a typo'd/forgotten env var.

## Recommendation
Ready for review. Transport hardening is additive and proven non-disruptive (114 existing API tests
unchanged), the riskiest surface (caching) is strictly revalidate-only, and the one contract change is
regenerated + checked.
