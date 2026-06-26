# Phase 9a — API Foundation (status + blocks) — Implementation Report

**Status: COMPLETE** (implemented, fully tested, live-validated against the fixture DB)

Date: 2026-06-26

Implements the first slice of the Phase 9 design (`phase-9-api-foundation-design.md`) per the locked
9a contract (`phase-9a-api-contract-and-plan.md`): a strictly DB-only Fastify + TypeBox API exposing
health, indexer/projection status, and the blocks surface. Establishes the cross-cutting patterns
(envelopes, BigInt-safe serialization, keyset pagination, TypeBox→OpenAPI + drift test, a
no-chain/no-outbound-network guard) that 9b/9c/9d will inherit.

## 1. Summary

`apps/api` is a new npm workspace (`@twilight-explorer/api`) that reads Postgres and nothing else. It
reuses `packages/db` `createPrismaClient()`, owns its own DB-oriented config, omits
`@twilight-explorer/chain-client` entirely, and is guarded against any outbound network call. Status
and head-lag come straight from `IndexerCursor` (no indexer change). Block proposer enrichment is a
left-join onto the materialized `BlockProposerAttribution` and never triggers a projection.

Endpoints shipped:

| Method + path | Purpose |
|---|---|
| `GET /health/live` | Liveness (no DB) |
| `GET /health/ready` | Readiness: `SELECT 1` + clean Prisma migration ledger |
| `GET /api/v1/status` | Indexer height/tip/lag/freshness + projection cursors + unresolved-failure counts |
| `GET /api/v1/blocks` | Keyset list, newest-first, attributed proposer |
| `GET /api/v1/blocks/:height` | Block detail; `?include=raw` adds the raw payload |
| `GET /docs` | Swagger UI (non-prod only) |

## 2. Files

New workspace `apps/api/` (1,399 lines across src + test):

```
apps/api/
  package.json                       workspace manifest (no chain deps); build/test/openapi scripts
  tsconfig.json                      extends tsconfig.base.json
  src/
    index.ts                         entrypoint: load config, listen, graceful shutdown
    server.ts                        buildServer() app factory (testable via inject(); no listen)
    config.ts                        loadApiConfig() — API_DATABASE_URL, no chain URLs
    plugins/
      prisma.ts                      attachPrisma(): root decorator app.prisma + onClose disconnect
      cors.ts                        registerCors()
      openapi.ts                     registerOpenapi(): @fastify/swagger + UI (non-prod)
    lib/
      envelope.ts                    ok() / paginated() — { data } / { data, page }
      errors.ts                      ApiError + central error/not-found handlers -> { error }
      pagination.ts                  keyset cursor encode/decode (base64url height), limit bounds
      serialize.ts                   bigToString / toIso / ageSeconds (BigInt never a JSON number)
    dto/
      common.ts                      Nullable, HeightString, ErrorResponse, PageInfo, BlockProposer
      health.ts                      HealthLive/HealthReady schemas
      status.ts                      ApiStatusResponse + mappers (toIndexerStatus/toProjectionStatus)
      blocks.ts                      Block list/detail schemas, queries, params + mappers
    repositories/
      health-repository.ts           checkDatabase / checkMigrations (read-only)
      status-repository.ts           getIndexerCursor / getProjectionCursors / getUnresolvedFailureCounts
      blocks-repository.ts           listBlocks / getBlock / getProposer(s) (left-join)
    routes/
      health.ts  status.ts  blocks.ts
    scripts/
      generate-openapi.ts            write or --check docs/reference/openapi.json
  test/
    mock-prisma.js                   in-memory PrismaClient mock + test config + block() factory
    health.test.js  status.test.js  blocks.test.js
    openapi-drift.test.js            committed spec == generated spec
    no-chain-guard.test.js           static DB-only / no-outbound-network guard
docs/reference/openapi.json          generated OpenAPI 3.1 contract (5 documented paths)
```

Changed (shared):

- `packages/db/src/index.ts` — `createPrismaClient(databaseUrl?)` now accepts an optional datasource
  URL. **Backward compatible**: no-argument callers (the indexer) are unchanged; the API passes its
  `API_DATABASE_URL` so the read-only role actually takes effect (see §6).
- `package-lock.json` — Fastify + TypeBox dependency tree (81 packages added).

## 3. Architecture decisions (locks honored)

- **DB-only / no outbound network** — `apps/api` does not depend on `chain-client`; a static guard
  test fails on `chain-client`/`config` imports, `node-fetch`/`undici`/http(s) clients, global
  `fetch(`, gRPC, and RPC/REST route/port markers, plus a `package.json` dependency scan.
- **TypeBox** route schemas drive validation, TS types, and the OpenAPI export from one definition.
- **`/status` DB-only** — `lastIndexedHeight`, `latestChainHeight` (last tip the indexer observed),
  `lagBlocks = tip − indexed`, `freshnessSeconds = now − updatedAt`. No indexer change in 9a.
- **Envelopes standardized** — list `{ data, page }`, detail `{ data }`, error `{ error }`.
- **BigInt → string** at the mapper boundary; response schemas declare `HeightString`; a test asserts
  no numeric heights leak.
- **Keyset pagination** — opaque base64url cursor of the last height; newest-first; `limit` default
  50 / max 100.
- **Proposer is optional** — left-join `BlockProposerAttribution`; absent ⇒ raw block address +
  `attributionStatus: null`. The API never runs the projection.
- **`include=raw` is detail-only** — list query is `additionalProperties: false`, so `?include=raw`
  on the list returns `400 invalid_query`; detail honors it.
- **Error codes** — `invalid_query`, `invalid_cursor`, `invalid_height`, `not_found`, `not_ready`,
  `internal`; details on validation + `not_ready` only (omitted for 500).
- **CORS** enabled (rate-limit deferred to hardening). **Swagger UI** non-prod only.
- **No** raw signature/liveness evidence, no `/supply`, no web UI, no 9b/9c/9d (out of scope).

## 4. Endpoint examples (live, against the 4-CoreSlot fixture DB, height 3196)

`GET /health/ready`
```json
{"data":{"status":"ready","checks":{"database":"ok","migrations":"ok"}}}
```

`GET /api/v1/status` (projections array abbreviated)
```json
{ "data": {
  "chainId": "twilight-localnet-1",
  "indexer": {
    "lastIndexedHeight": "3196", "latestChainHeight": "3196", "lagBlocks": "0",
    "status": "idle",
    "lastIndexedHash": "E3D7317F8E3F89CEFC7DBD13DF0E9CCE0845A228E8F02663CF2AF58C5DEA4E1B",
    "updatedAt": "2026-06-25T22:40:11.250Z", "freshnessSeconds": 13211, "error": null
  },
  "projections": [ /* 12 cursors incl. proposer_attribution_v1, coreslot_health_v1, ... */ ],
  "projectionFailures": { "unresolvedCount": 0, "byProjection": [] }
}}
```

`GET /api/v1/blocks?limit=2`
```json
{ "data": [
  { "height": "3196",
    "hash": "E3D7317F...4E1B", "time": "2026-06-25T22:40:02.053Z",
    "txCount": 0, "chainId": "twilight-localnet-1",
    "proposer": { "rawAddress": "371546BFEEB646BB982E05E5B738AE8D52243067",
      "address": "371546bfeeb646bb982e05e5b738ae8d52243067", "slotId": "2",
      "operatorAddress": "twilight1cp3frfuktc9vlqcw7pff8v7y3etn8uzc3whms3",
      "attributionStatus": "attributed" } },
  { "height": "3195", "proposer": { "slotId": "4",
      "operatorAddress": "twilight1arvvjf2v3h2snpsa7r2yrj700mu54pjmhusp5u",
      "attributionStatus": "attributed" /* ... */ } }
],
  "page": { "limit": 2, "nextCursor": "MzE5NQ" } }
```

`GET /api/v1/blocks/3196` returns the detail object with `appHash`, `validatorsHash`,
`nextValidatorsHash`, `lastBlockHash`, `createdAt`, and the same attributed proposer; `?include=raw`
adds the `raw` payload.

Negative paths (live): `GET /api/v1/blocks/99999999` → `404`; `GET /api/v1/blocks?include=raw` →
`400`; `GET /api/v1/blocks/abc` → `400 invalid_height`.

## 5. Validation

Test suites (`node --test` against compiled `dist/`):

```
apps/api               # tests 22  # pass 22  # fail 0
  - health (4): live no-DB; ready ok; ready 503 db-down; ready 503 migration-failed
  - status (4): populated lag+freshness; empty DB null; null-tip null-lag; failure aggregation
  - blocks list (5): pagination+cursor; bad limit 400; bad cursor 400; include=raw 400; proposer present/absent
  - block detail (5): by height; 404; include=raw; invalid_height 400; height serialized as string
  - openapi (1): committed openapi.json == generated spec (drift guard)
  - no-chain guard (2): src has no chain/outbound-network usage; package.json has no chain dep
packages/chain-client  # tests 16  # pass 16  # fail 0   (unaffected by the db change)
apps/indexer           # tests 252 # pass 250 # fail 0   (createPrismaClient change is backward compatible)
```

Ritual (all green): `npm run db:generate`, `npm run typecheck` (all workspaces), `npm run build`,
`npm --prefix apps/api run openapi:check` ("OpenAPI spec is up to date."), `npm run lint` (no-op —
no linter configured repo-wide), `git diff --check` (clean). Static route guards: no
`/cosmos/staking|gov|mint|distribution`, no stale active-slots route in `apps/api`.

Live smoke: booted `node apps/api/dist/index.js` with `API_DATABASE_URL` against the fixture DB;
`/health/ready` 200, `/status` showed indexed height 3196 / tip 3196 / lag 0 / 12 projection cursors /
0 unresolved failures, `/blocks` returned attributed proposers (slot 2, slot 4) with a working
`nextCursor`, detail matched the DB row, and the 404/400 paths behaved as specified.

## 6. Notable implementation findings

1. **`API_DATABASE_URL` was initially inert.** `createPrismaClient()` did `new PrismaClient()`, which
   only reads the schema's `env("DATABASE_URL")`. Setting `API_DATABASE_URL` had no effect, so the
   first live smoke failed every DB call (`/health/ready` reported `database: error`). Fix:
   `createPrismaClient(databaseUrl?)` now forwards an explicit `datasourceUrl`; the API passes its
   configured URL. Without this the read-only DB role (lock #5) would silently never apply.
2. **`docs/reference/openapi.json` is gitignored** by a broad `reference/` rule (`.gitignore:55`).
   Like the `*.sql` migrations, the committed contract must be **force-added**:
   `git add -f docs/reference/openapi.json`. The drift test still works locally regardless, but CI
   and reviewers only see the contract if it is force-added.
3. **`buildServer()` factory** is split from `index.ts` so tests construct the app and drive it via
   `app.inject()` with an injected mock Prisma — no socket, no DB. This is what makes the route +
   drift + guard tests run under plain `node --test`.

## 7. Known limitations & deferrals

- **9a scope only.** No transactions, accounts, search, CoreSlot/liveness/health, or rewards
  endpoints — those are 9b/9c/9d.
- **`/status` freshness** is "indexed vs last-observed tip" with an `updatedAt` age; it is not a live
  chain probe (by design — DB-only).
- **No account balances / `/supply`** — deferred to the pre-9d `AccountBalance`/`SupplySnapshot`
  indexer samples (see checkpoint §6).
- **No raw signature / liveness evidence** exposed (locked out of v1).
- **No real linter** exists repo-wide; `npm run lint` is a no-op. ESLint is tracked as a separate
  tooling/hardening item (lock #1), not added here.
- **No rate-limiting / security headers (helmet) / cache-control** — deferred to hardening.
- **Single-chain assumption** — `/status` reads the one `IndexerCursor` row; multi-chain is out of
  scope.
- **`HOST` defaults to `0.0.0.0`** for container friendliness; override for local-only binding.

## 8. Next steps

- Force-add `docs/reference/openapi.json` and commit `apps/api` + the `packages/db` change.
- 9b (generic explorer: txs, accounts, search, diagnostics) builds on these patterns; 9c adds the
  CoreSlot/validator/liveness/health surface; 9d adds rewards. `/supply` + account balances wait on
  the pre-9d snapshot indexer phase.

**Phase 9a API Foundation: COMPLETE**
