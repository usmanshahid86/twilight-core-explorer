# Phase 9a — API Contract + Implementation Plan

**Phase 9a Contract + Implementation Plan: READY**

Date: 2026-06-26

Scope: contract + plan only. No code, no branch, no issues. Implements the first slice of the accepted
Phase 9 design (`docs/research/phase-9-api-foundation-design.md`): *"API foundation: Fastify app +
status + blocks slice."* Contract is fully specified; the open questions carry recommended defaults
and are non-blocking.

---

## 1. Executive summary

9a scaffolds `apps/api` as a **strictly DB-only** Fastify + TypeBox service exposing `/health/live`,
`/health/ready`, `/api/v1/status`, `/api/v1/blocks`, `/api/v1/blocks/:height`. It reuses
`packages/db`'s `createPrismaClient()`, has its own config (no chain URLs), omits `chain-client`
entirely, and establishes the cross-cutting patterns — `{ data }` envelopes, BigInt→string
serialization, keyset pagination, TypeBox→OpenAPI with a drift test, and a no-chain guard — that
every later sub-phase inherits. Status/lag come from `IndexerCursor` with **zero indexer changes**.
Proposer enrichment on blocks reads only the materialized `BlockProposerAttribution` (raw + null if
absent), never triggering a projection.

## 2. Confirmed repo facts relevant to 9a

- `apps/api` does not exist. Workspaces `apps/*`, `packages/*`. ESM / `module: NodeNext`, target
  ES2022, `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`; `.js` import
  specifiers required.
- `packages/db` exports `createPrismaClient()` + `PrismaClient`; `type: module`, has an `exports` map.
- Build = `tsc -p tsconfig.json` → `dist`; package `prebuild` builds dependency packages + `db:generate`.
  Tests = `node --test` (with `pretest` building first); files are hand-written `test/*.test.js`
  importing from `../dist/`.
- **No linter is configured** — root `lint` = `npm run lint --workspaces --if-present`, and no
  workspace defines a `lint` script and there is no eslint config; `npm run lint` is effectively a
  no-op today (see Open Q1).
- `*.json` is NOT gitignored (only `*.sql` is) → `docs/reference/openapi.json` commits cleanly, no
  force-add.
- `IndexerCursor`: `chainId @id`, `lastIndexedHeight`, `lastIndexedHash?`, `latestChainHeight?`,
  `status`, `updatedAt`, `error?` — **`latestChainHeight` is populated** by the indexer (no indexer
  change needed for `/status`).
- `ProjectionCursor`: `(projectionName, chainId)`, `lastProjectedHeight`, `status`, `updatedAt`, `error?`.
- `ProjectionFailure`: has `projectionName`, `resolved`, `committedHeight?`, etc. → unresolved counts.
- `Block`: `height @id`, `hash?`, `time?`, `chainId?`, `proposerAddress?` (indexed, uppercase hex),
  `appHash?`, `validatorsHash?`, `nextValidatorsHash?`, `lastBlockHash?`, `txCount`, `rawJson`,
  `createdAt`.
- `BlockProposerAttribution`: `height` (indexed), `proposerAddress?`, `rawProposerAddress?`, `slotId?`,
  `operatorAddress?`, `consensusWindowId?`, `attributionStatus`.

## 3. API contract

### `GET /health/live`
- **Purpose:** process liveness. **No DB.**
- **200** always (if the event loop responds): `{ "data": { "status": "live" } }`.

### `GET /health/ready`
- **Purpose:** readiness to serve (DB reachable + schema sane). Read-only-role-safe.
- **Checks:** (a) `SELECT 1`; (b) `_prisma_migrations` readable; (c) no failed/rolled-back migrations —
  `count(*) where rolled_back_at is not null` = 0 **and** `count(*) where finished_at is null and
  rolled_back_at is null` = 0.
- **200:** `{ "data": { "status": "ready", "checks": { "database": "ok", "migrations": "ok" } } }`.
- **503** on any failed check: `{ "error": { "code": "not_ready", "message": "service not ready",
  "details": { "database": "ok|error", "migrations": "ok|error|failed" } } }`. The API **never applies
  migrations**; it only reads. DB error messages are logged, not leaked into the body.

### `GET /api/v1/status`
DB-only. Reads the single `IndexerCursor` row (one per chain; `chainId` comes from the row, not config).

```
{ "data": {
  "chainId": "twilight-localnet-1",
  "indexer": {
    "lastIndexedHeight": "3196", "latestChainHeight": "3200",
    "lagBlocks": "4", "status": "idle",
    "lastIndexedHash": "…", "updatedAt": "2026-06-26T…Z",
    "freshnessSeconds": 12, "error": null
  },
  "projections": [
    { "projectionName": "coreslot_temporal_map_v1", "lastProjectedHeight": "3196",
      "status": "idle", "updatedAt": "…Z", "error": null }
  ],
  "projectionFailures": { "unresolvedCount": 0, "byProjection": [] }
}}
```

- **lag/freshness:** `lagBlocks = latestChainHeight − lastIndexedHeight` (string; `null` if
  `latestChainHeight` null); `freshnessSeconds = now − updatedAt` (number, server clock).
- **Empty DB:** no `IndexerCursor` row → `"indexer": null`, `"lagBlocks": null`, `"projections": []`,
  `"projectionFailures": { "unresolvedCount": 0, "byProjection": [] }`, `chainId` from optional
  `API_CHAIN_ID` else `null`. Always **200**.

### `GET /api/v1/blocks`
- **Query:** `limit` (int, default 50, **max 100**), `cursor` (opaque base64url, optional). `include`
  ignored here (raw is detail-only).
- **Ordering:** `height DESC` (newest first).
- **Cursor:** opaque base64url of the last height returned; next page = `height < decode(cursor)`.
  `nextCursor = base64url(minHeightInPage)` when a full page returned, else `null`.
- **Response:** `{ "data": BlockListItem[], "page": { "limit": 50, "nextCursor": "…"|null } }`.
- **BlockListItem:** `height`(str), `hash`(str|null), `time`(ISO|null), `txCount`(num),
  `chainId`(str|null), `proposer`: BlockProposerDto. **No `rawJson`.**
- **Validation:** `limit` ∉ [1,100] → **400** `invalid_query`; `cursor` undecodable/non-numeric →
  **400** `invalid_cursor`.

### `GET /api/v1/blocks/:height`
- **Path:** `height` must be digits parseable to a non-negative BigInt → else **400** `invalid_height`.
- **404** if no block: `{ "error": { "code": "not_found", "message": "block not found" } }`.
- **Response:** `{ "data": BlockDetail }`. **BlockDetail** = BlockListItem + `appHash`,
  `validatorsHash`, `nextValidatorsHash`, `lastBlockHash`, `createdAt`(ISO).
- **`?include=raw`** (detail only): adds `"raw": <Block.rawJson>`. Default omits it.
- **Related tx data deferred to 9b** (blocks/:height links to txs by height in 9b).

## 4. DTO / schema contract (TypeBox)

| DTO | Shape (conceptual) |
|---|---|
| `HealthLiveResponse` | `{ data: { status: 'live' } }` |
| `HealthReadyResponse` | `{ data: { status: 'ready', checks: { database: string, migrations: string } } }` |
| `ApiStatusResponse` | `{ data: { chainId: string\|null, indexer: IndexerStatus\|null, projections: ProjectionStatusSummary[], projectionFailures: { unresolvedCount: number, byProjection: ProjectionFailureSummary[] } } }` |
| `IndexerStatus` | `{ lastIndexedHeight: string, latestChainHeight: string\|null, lagBlocks: string\|null, status: string, lastIndexedHash: string\|null, updatedAt: string, freshnessSeconds: number, error: string\|null }` |
| `ProjectionStatusSummary` | `{ projectionName: string, lastProjectedHeight: string, status: string, updatedAt: string, error: string\|null }` |
| `ProjectionFailureSummary` | `{ projectionName: string, count: number }` |
| `BlockProposerDto` | `{ rawAddress: string\|null, address: string\|null, slotId: string\|null, operatorAddress: string\|null, attributionStatus: string\|null }` |
| `BlockListItem` | `{ height: string, hash: string\|null, time: string\|null, txCount: number, chainId: string\|null, proposer: BlockProposerDto }` |
| `BlockDetail` | `BlockListItem & { appHash, validatorsHash, nextValidatorsHash, lastBlockHash: string\|null, createdAt: string, raw?: unknown }` |
| `PageInfo` | `{ limit: number, nextCursor: string\|null }` |
| `ErrorResponse` | `{ error: { code: string, message: string, details?: Record<string,unknown> } }` |

**Serialization rules:** heights & hashes → strings; timestamps → ISO; bps → numbers (none in 9a);
**BigInt never emitted as a JSON number** (mapper converts to string, schema declares string, a test
asserts no BigInt leaks); `rawJson` excluded from lists, detail-only with `include=raw`.

## 5. Pagination contract

Keyset by `height DESC`. `cursor` = `base64url(String(height))`, opaque. Request `?limit&cursor`; query
`where height < decoded ORDER BY height DESC LIMIT limit + 1`. The extra row is a lookahead: trim the
response to `limit` and emit `nextCursor` = base64url of the lowest height in the trimmed page **only
when that extra row existed**, else `null`. (This avoids dangling a cursor to an empty page when the
final page is exactly `limit` rows.) No offset pagination. Invalid cursor (bad base64
/ non-numeric) → 400 `invalid_cursor`. Keyset is stable under new ingestion (newest-first → new blocks
appear on page 1, never shift the cursor window).

## 6. Error contract

Single shape `{ error: { code, message, details? } }`. Central Fastify error handler +
`setNotFoundHandler` map everything into it. Codes (9a): `invalid_query`, `invalid_cursor`,
`invalid_height`, `not_found`, `not_ready`, `internal`. HTTP: 400 validation, 404 not-found, 503
not-ready, 500 internal. TypeBox schema-validation failures are caught and re-shaped to
`invalid_query`. 500s log the cause; body carries a generic message (no internal leakage).

## 7. OpenAPI contract

`@fastify/swagger` + `@fastify/type-provider-typebox`: every route declares TypeBox `schema`
(params/query/response) → the spec is assembled from them. **`/docs`** (Swagger UI) mounted **only when
`API_ENV !== 'production'`**. Two scripts:
- `openapi:generate` — boots the app factory, `await app.ready()`, writes `app.swagger()` JSON to
  `docs/reference/openapi.json`, `app.close()`.
- `openapi:check` — regenerates to a temp buffer and **diffs** against the committed file; non-zero on
  drift. Runs inside `apps/api` tests.

## 8. DB-only / no-chain enforcement

- `apps/api/package.json` deps: **no `@twilight-explorer/chain-client`**, no http clients. Only
  `@twilight-explorer/db`, fastify + plugins, typebox.
- **Guard as a `node --test`** (mirrors the indexer's existing static-route-guard test):
  `apps/api/test/no-chain-guard.test.js` reads every `apps/api/src/**/*.ts` and `apps/api/package.json`,
  failing on: `chain-client`, `loadConfig`, `node-fetch`, `undici`, `from 'http'`/`'https'`,
  **`fetch(`**, and RPC/REST markers (`26657`, `1317`, `/cosmos/`, `/twilight/`, `/block_results`).
  Allowlist is an explicit constant (empty for 9a).
- Config is API-specific (`apps/api/src/config.ts`) — no chain URLs; importing `@twilight-explorer/config`
  is itself a guard failure.

## 9. File-by-file implementation plan

| File | Purpose | Key exports | Invariants |
|---|---|---|---|
| `apps/api/package.json` | workspace manifest | scripts: build, typecheck, test, dev, start, `openapi:generate`, `openapi:check` | no chain deps; `type: module` |
| `apps/api/tsconfig.json` | extends base | — | `rootDir: src`, `outDir: dist` |
| `apps/api/src/server.ts` | **app factory** `buildServer(opts)` (no listen) | `buildServer` | testable via `inject()`; registers all plugins+routes; no side effects |
| `apps/api/src/index.ts` | entrypoint | — | reads config, `buildServer().listen()`, graceful shutdown (SIGTERM→close→prisma disconnect) |
| `apps/api/src/config.ts` | API config loader | `loadApiConfig()` → `{ databaseUrl, port, host, env, corsOrigins, chainId? }` | uses `API_DATABASE_URL` (fallback `DATABASE_URL` only when `API_ENV!=='production'`, documented); **never chain URLs** |
| `apps/api/src/plugins/prisma.ts` | Prisma lifecycle | fastify plugin → `app.prisma` | one `createPrismaClient()`; `onClose` disconnect; read-only usage |
| `apps/api/src/plugins/openapi.ts` | swagger + UI | plugin | UI only non-prod; spec from TypeBox schemas |
| `apps/api/src/plugins/cors.ts` | CORS | plugin | origins from config |
| `apps/api/src/lib/envelope.ts` | response envelopes | `ok(data)`, `page(data, pageInfo)` | always `{ data }` / `{ data, page }` |
| `apps/api/src/lib/errors.ts` | error model | `ApiError`, `errorHandler`, `notFoundHandler` | one `{ error }` shape; no internal leakage |
| `apps/api/src/lib/pagination.ts` | keyset cursor | `encodeCursor/decodeCursor`, `parseLimit` | opaque base64url height; bounds 1..100 |
| `apps/api/src/lib/serialize.ts` | BigInt safety | `bigToString`, `toIso` | BigInt→string; never number |
| `apps/api/src/dto/common.ts` | shared schemas | `PageInfo`, `ErrorResponse`, `BlockProposerDto` | TypeBox |
| `apps/api/src/dto/{health,status,blocks}.ts` | per-domain schemas | the DTOs above | response schemas declare heights as strings |
| `apps/api/src/repositories/status-repository.ts` | DB reads | `getIndexerStatus`, `getProjectionStatuses`, `getUnresolvedFailureCounts` | read-only; returns plain rows |
| `apps/api/src/repositories/blocks-repository.ts` | DB reads | `listBlocks(cursor,limit)`, `getBlock(height)` (left-join proposer) | read-only; keyset query; index-backed |
| `apps/api/src/routes/{health,status,blocks}.ts` | route plugins | register handlers + schemas | thin: repo → mapper → envelope |
| `apps/api/test/*.test.js` | tests | — | `inject()`, mock/real DB, drift, guard |
| `docs/reference/openapi.json` | committed contract | — | regenerated + drift-checked |
| *(not now)* `docs/research/phase-9a-api-foundation-report.md` | post-impl report | — | written after implementation |

## 10. Test plan (`apps/api/test/*.test.js`, `node --test`)

Server boots (factory); `/health/live` returns 200 with no DB (inject with prisma stubbed to throw →
still 200); `/health/ready` success; `/health/ready` DB-down → 503; `/health/ready` failed-migration via
mock prisma returning a rolled-back row → 503 / `migrations:failed`; `/status` with populated
IndexerCursor (lag + freshness computed); `/status` empty DB → `indexer:null`; `/blocks` pagination
(cursor round-trip, nextCursor null on last page); `/blocks` invalid limit & invalid cursor → 400;
`/blocks/:height` success; `/blocks/:height` 404; `/blocks/:height?include=raw` adds raw, list never
does; BigInt serialization (no numeric heights); proposer present when attribution materialized +
null/unknown when absent; OpenAPI generated and **drift-checked**; **no-chain guard** catches
chain-client / loadConfig / `fetch(` / node-fetch / undici / http(s) / RPC-REST strings. Repository unit
tests use mock-Prisma; a few integration tests run against the live fixture DB behind
`RUN_INTEGRATION_TESTS`.

## 11. Validation commands

```
npm run db:generate
npm run typecheck
npm run build
npm test
npm --prefix apps/api test          # route + repo + drift + guard tests
npm --prefix apps/indexer test
npm --prefix packages/chain-client test
npm run lint                         # (currently a no-op; see Open Q1)
git diff --check
# new (apps/api):
npm --prefix apps/api run openapi:generate   # writes docs/reference/openapi.json
npm --prefix apps/api run openapi:check      # drift guard (also a test)
```

## 12. Smoke plan against the live fixture DB

Boot `API_DATABASE_URL=…twilight_explorer API_ENV=development npm --prefix apps/api start`; then:
`/health/live`→200; `/health/ready`→200; `/api/v1/status` shows `lastIndexedHeight ≈ 3196`,
`latestChainHeight`, `lagBlocks`, `freshnessSeconds`, projections incl. `proposer_attribution_v1`,
`unresolvedCount: 0`; `/api/v1/blocks?limit=5` returns the 5 newest with attributed `proposer`
(operator + slotId), valid `nextCursor`; follow `nextCursor` → next 5; `/api/v1/blocks/3196` matches
the DB row; `/blocks/3196?include=raw` includes `raw`; `/blocks/99999999`→404; `/docs` serves in dev
and 404s when `API_ENV=production`.

## 13. Risks & mitigations

- **BigInt leak** → mapper-to-string + schema-string + explicit test.
- **Cursor stability** → keyset desc (new blocks don't shift the window).
- **`_prisma_migrations` under read-only role** → SELECT only; grant read on the table (document).
- **OpenAPI drift** → generate + commit + diff test.
- **Proposer left-join cost** → `BlockProposerAttribution.height` is indexed.
- **Chain leak** → guard test incl. `fetch(` + package.json dep scan.
- **404 vs malformed height** → distinct codes (`invalid_height` 400 vs `not_found` 404).

## 14. Open questions (recommended defaults in **bold**)

1. **Linting:** there is no eslint today (`lint` is a no-op). For 9a, **match the convention (no lint
   script)** and treat real ESLint as a separate later decision — or add ESLint now for the new TS
   service?
2. **`/status` chainId:** read the **single `IndexerCursor` row** (no config chainId); multi-chain out
   of scope. Confirm.
3. **`limit` max:** **100**. OK?
4. **Dev runner:** **match the indexer** (`dev = build && node dist/index.js`, no `tsx`) to avoid a new
   devDep — or add `tsx` for watch ergonomics?
5. **`include=raw` on list:** **silently ignored** (raw is detail-only) vs 400.
6. **`details` in error envelope:** include for validation (field errors) and `not_ready` (which check
   failed); **omit for 500** (no internal leakage). Confirm.
7. **chainId when DB empty:** optional `API_CHAIN_ID` config for display, else `null`. Add the env, or
   just return `null`?

## 15. Additions beyond the source prompt (flagged for a later decision)

- **`buildServer()` app-factory split** from `index.ts` — essential for `inject()` tests; baked in.
- **Graceful shutdown** (SIGTERM → `app.close()` → prisma disconnect).
- **`setNotFoundHandler` + error-handler** pair mapping 404/500/validation into the `{ error }` envelope.
- **Guard also scans `package.json` deps** (not just `src`), so a chain dep can't slip in.
- **Security headers (helmet) and cache-control/ETag deferred to hardening** — noted, not in 9a.

## 16. Final recommendation

Proceed to implement 9a from this contract. Settle the 7 open questions (all have safe defaults); the
next concrete step is writing `apps/api` + `docs/reference/openapi.json`. The post-implementation
write-up lands later in `docs/research/phase-9a-api-foundation-report.md`.

**Phase 9a Contract + Implementation Plan: READY**
