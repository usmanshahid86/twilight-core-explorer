# Phase 9 API Foundation Design

**Phase 9 API Foundation Design: READY**

Date: 2026-06-26

This document is the audited, decision-locked design for the Twilight Core Explorer public API
(Phase 9). It is based on the actual repository state, not assumptions. Implementation is gated on
this document; contracts are defined per sub-phase before code (lock #6).

---

## Executive summary

`apps/api` does not exist — Phase 9 is a greenfield workspace in an established npm-workspaces
monorepo. The data layer is exceptionally ready: ~29 materialized Prisma models cover generic chain
data, the full CoreSlot semantic layer, the liveness/health stack, proposer attribution, and rewards.
The API is a **strictly read-only projection of Postgres**: it reuses `packages/db`'s
`createPrismaClient()`, has its own DB-oriented config (deliberately not `packages/config`, which
loads chain URLs), and **never depends on `packages/chain-client`** (enforced structurally + by a
static guard). Stack: **Fastify + TypeScript + Prisma + TypeBox**, REST with a generated-then-checked-in
OpenAPI contract. `/status` and head-lag are available today from `IndexerCursor` with **zero indexer
changes**. Build order: 9a foundation+status+blocks (one issue) → 9b generic → 9c CoreSlot/validator/
liveness/health → 9d rewards (supply deferred until a real snapshot exists).

## Repo audit findings

| Question | Finding |
|---|---|
| `apps/api` exists? | **No** — clean slate. `workspaces: ["apps/*","packages/*"]`. |
| Test framework | `node --test` against compiled `dist/` (`"npm run build && node --test"`); root `test` = `--workspaces --if-present`; integration behind `test:integration` / `RUN_INTEGRATION_TESTS`. |
| Prisma import | `packages/db` exports `createPrismaClient()` + `PrismaClient`. API reuses directly. |
| Shared config | `packages/config` `loadConfig()` → `{chainId, cometRpcUrl, restUrl, requestTimeoutMs}` — **chain-oriented; the API must not use it**. API needs its own DB-oriented config. |
| HTTP conventions | **None exist** — Phase 9 establishes envelope/errors/pagination/serialization. |
| Indexer status persistence | `IndexerCursor` has `lastIndexedHeight`, **`latestChainHeight`** (populated: `index.ts:29` reads chain tip from `/status`, stores via `updateCursorSuccess`), `status`, `updatedAt`, `error`. `ProjectionCursor` has `lastProjectedHeight`/`status`/`error` per projection. **`/status` + lag need no indexer change.** |
| Prior architecture docs | `explorer-architecture-proposal.md` already endorsed Fastify; defer-Redis; Postgres-indexes + short cache headers first — consistent. `explorer-api-surface-refresh.md` is about **chain ingestion sources**, not our public API — not conflated here. |
| Migrations | tracked via force-add (`.gitignore` has a `*.sql` rule); relevant only to future API migrations (9a needs none). |

## Available data surfaces (materialized in Postgres)

- **Generic:** `Block` (incl. `proposerAddress`, `validatorsHash`/`nextValidatorsHash`), `ExplorerTransaction`, `Message`, `Event`, `Account`, `DecodeFailure`.
- **Indexer/projection ops:** `IndexerCursor`, `ProjectionCursor`, `ProjectionFailure`.
- **CoreSlot semantic:** `CoreSlotProjection` (incl. `consensusAddress`/`consensusPubkeyJson`/`consensusPower`/`operatorAddress`/`payoutAddress`/`status`/`rewardWeight`), `CoreSlotMetadataChange`, `CoreSlotLifecycleEvent`, `CoreSlotPayoutChange`, `CoreSlotParameterChange`, `CoreSlotConsensusKeyRotation`, `CoreSlotConsensusWindow`.
- **Validator/liveness:** `BlockProposerAttribution`, `BlockSignature`, `OperatorSigningEvidence`, `CoreSlotLivenessEvidence`, `CoreSlotLivenessSummary`, `CoreSlotHealthSnapshot`, `NetworkLivenessRiskSnapshot`.
- **Rewards:** `RewardEpochProjection`, `SlotRewardProjection`, `RewardClaimEvent`, `RewardsParamsChange`, `RewardsTreasuryPayment`, `RewardsBalanceSample`.

## Surface readiness matrix

| Surface | Readiness | Note |
|---|---|---|
| Blocks, Txs, Messages, Events | **READY** | core generic data |
| Account **identity/activity** | **READY** | address, accountKind, first/last seen, txCount, operator/payout relationships if derivable |
| Account **balances** | **DEFER** | bank-module current state, not derivable from event projections; needs a future materialized `AccountBalance`/balance-snapshot (sampled, height-tagged). `/accounts/:address` must NOT promise balances yet |
| IndexerCursor/status, ProjectionCursor, ProjectionFailure, DecodeFailure | **READY** | status + diagnostics, no chain read |
| CoreSlotProjection + lifecycle/metadata/payout/params/key-rotation/windows | **READY** | live-behavior validated |
| **BlockProposerAttribution** | **READY** | validator surface (blocks-proposed); 100% attributed on fixture |
| CoreSlotLivenessSummary, CoreSlotHealthSnapshot, NetworkLivenessRiskSnapshot | **READY** | live-validated; operator north-star |
| BlockSignature, OperatorSigningEvidence, CoreSlotLivenessEvidence | **DEFER (not in v1 public API)** | raw/high-volume evidence; later under a diagnostics namespace only (locked) |
| RewardEpochProjection | **READY w/ CAVEAT** | `EpochReward` = aggregate context, **not claim truth** — label it |
| SlotRewardProjection, RewardsBalanceSample | **READY w/ CAVEAT** | **observed samples** tied to `sampledAtHeight` — `source:"sampled"` mandatory |
| RewardClaimEvent | **READY w/ CAVEAT** | claim *history* only; production claim/economics gated by **Phase 7.2** |
| RewardsParamsChange, RewardsTreasuryPayment | **READY** | event history |
| Supply | **DEFER** | **no `Supply` model exists**; do not derive ad hoc — depends on a future `SupplySnapshot`/indexer sample |

## API architecture recommendation

- **New workspace `apps/api`** (`@twilight-explorer/api`), Fastify + TypeScript, depends on
  `@twilight-explorer/db` only — **not** `chain-client` / `config` / `decoder`.
- **Plugin layout:** `config` → `prisma` (decorates `app.prisma`, `onClose` disconnect) → `serializer`
  (BigInt) → `error-handler` → `swagger`/`swagger-ui` (non-prod) → per-domain route plugins. Thin
  routes → **repository/service layer** (read-only queries) → **DTO mappers**.
- **Schemas/validation/types/OpenAPI:** **TypeBox** with Fastify route schemas — one definition gives
  runtime validation + TS types + OpenAPI export (lock #1).
- **Config:** API-specific env — **`API_DATABASE_URL`** (recommended **read-only DB role**), `PORT`,
  `HOST`, `LOG_LEVEL`, `CORS_ORIGINS`, `NODE_ENV`. Falls back to `DATABASE_URL` **only** for local/test
  and only when explicitly documented (lock #5). Does not load chain URLs.
- **Prisma lifecycle:** one `createPrismaClient()` per process, Fastify decorator, disconnect on close.
- **Error handling:** central handler → `{ error: { code, message, details? } }` + conventional HTTP
  status (400 validation, 404 not-found, 500 unexpected). Validation errors come from TypeBox schemas.
- **Health/readiness:** `/health/live` = process up (no DB). `/health/ready` = DB connectivity via
  `SELECT 1` + the Prisma migration table (`_prisma_migrations`) is readable + no failed migrations
  present. The API **does not apply migrations** — it only verifies readiness (feasible under a
  read-only DB role). `/api/v1/status` = indexer + projection status (below).
- **Dev/prod:** `api:dev` (watch/build+run), `api:start` (`node dist`). **CORS in 9a**; **rate-limit
  deferred to hardening** unless trivially droppable in (lock #8).
- **Tests:** `node --test` against `dist/` — repository unit tests (mock-Prisma) + Fastify `inject()`
  route tests + an **OpenAPI drift test**; integration tests against a seeded DB behind
  `RUN_INTEGRATION_TESTS`.

## DB-only API rule (lock #2/#3, enforced)

- **`apps/api` performs NO outbound network calls.** It is a pure read-over-Postgres service.
- `apps/api` **omits `@twilight-explorer/chain-client`** from `dependencies` → cannot import it.
- **Static guard** (mirrors existing route guards): CI greps `apps/api/src` and fails on any import of
  `chain-client`, `node-fetch`/`undici`/`http(s)`, CometBFT/Cosmos/Twilight REST/RPC URLs, gRPC, or
  `loadConfig`, **and additionally fails on direct `fetch(` usage** (Node's global `fetch` lets code
  hit RPC/REST with no import). Any exception must be explicitly allowlisted and justified (e.g. a
  non-network test helper) — **no exception is expected for Phase 9a**.
- No projection logic in handlers. Computed values (lag, simple counts/rollups) are arithmetic over
  stored rows, never projection recomputation.
- **`/status` is DB-only:** `latestChainHeight` = last chain tip observed by the indexer;
  `lag = latestChainHeight − lastIndexedHeight`; `freshness` = `IndexerCursor.updatedAt` (age). No
  indexer heartbeat or migration in 9a (lock #2). Documented caveat: lag is "indexed vs last-observed
  tip"; `updatedAt` age signals how fresh that observation is.

## Response / DTO conventions

- **Heights:** strings (BigInt precision/consistency). **Amounts (`utwlt`):** strings. **bps:** numbers
  (Int ≤ 10000). **Timestamps:** ISO-8601 strings. **Consensus/validator addresses:** lowercase hex.
- **Raw JSON (`raw*Json`):** never on list endpoints; detail only, opt-in via `?include=raw`.
- **Nullable/missing:** explicit `null` for known-absent; documented per field.
- **Health/status strings:** passed through verbatim (`healthStatus`, `summaryStatus`, `haltRiskLevel`,
  reasons, attribution statuses) — never coerced.
- **Observed samples:** rewards-sample DTOs carry `source: "derived" | "sampled"` + `sampledAtHeight`.
- **Envelope — standardized `{ data }` everywhere** (one mental model for the web app):
  - **List:** `{ data: [...], page: { limit, nextCursor | null } }`
  - **Detail:** `{ data: {...} }` (NOT a bare object)
  - **Error:** `{ error: { code, message, details? } }`
- **Proposer on block DTOs reads ONLY the materialized `BlockProposerAttribution` row.** If the row
  is absent (proposer projection not yet run for that height), the DTO returns the raw proposer
  address with `slotId`/`operatorAddress` `null` and `attributionStatus: null` (unknown). `/blocks`
  must not depend on running any projection — it reads what is materialized.
- **Pagination:** keyset/cursor by height (desc default); opaque base64 `cursor`; `?limit=` bounded.

## OpenAPI strategy (lock #6)

**Generated + checked-in.** Generate from Fastify/TypeBox route schemas via `@fastify/swagger`; export
to **`docs/reference/openapi.json`** (committed, reviewable contract). Serve Swagger UI at **`/docs`
only in non-prod**. A test regenerates and **diff-guards** against the checked-in artifact so the
contract cannot silently drift.

## Route groups & endpoint candidates

- **Health/status** (9a): `/health/live`, `/health/ready`, `/api/v1/status`.
- **Blocks** (9a): `/api/v1/blocks`, `/api/v1/blocks/:height` (block DTO includes attributed
  `proposer: { rawAddress, address, slotId?, operatorAddress?, attributionStatus }`).
- **Transactions** (9b): `/api/v1/txs`, `/api/v1/txs/:hash` (messages + events on detail).
- **Accounts** (9b): `/api/v1/accounts`, `/api/v1/accounts/:address` — identity/activity only
  (`address`, `accountKind`, `firstSeenHeight`, `lastSeenHeight`, `txCount`, operator/payout
  relationships if derivable). **No balances** until a materialized balance snapshot exists.
- **Search** (9b): `/api/v1/search?q=` — height | block hash | tx hash | account/operator address |
  slotId | consensus hex address; **`twilightvalcons…` bech32 normalized in the API/search layer**
  (lock #7).
- **Diagnostics** (9b): `/api/v1/decode-failures`, `/api/v1/projections` (cursors + unresolved
  failures). (Raw signature/liveness evidence is NOT exposed in v1.)
- **CoreSlot / validator** (9c): `/api/v1/coreslots`, `/coreslots/:slotId` (identity +
  `consensusAddress`/`consensusPubkey`/`consensusPower`/`status` + `blocksProposed`),
  `/coreslots/:slotId/events`, `/coreslots/:slotId/windows`, `/coreslots/:slotId/key-rotations`,
  `/coreslots/:slotId/proposed-blocks`, `/api/v1/network/proposers` (leaderboard),
  `/api/v1/network/validator-set?height=` (active CoreSlot set at H from windows).
- **Liveness/health** (9c): `/coreslots/:slotId/liveness` (summaries), `/coreslots/:slotId/health`,
  `/api/v1/network/liveness-risk`.
- **Rewards** (9d): `/api/v1/rewards/epochs`, `/epochs/:n`, `/coreslots/:slotId/rewards`,
  `/rewards/claims`, `/rewards/balances` (sampled). `/api/v1/supply` — **deferred**.
  - **`/rewards/claims` exposes indexed claim-history events ONLY.** It must NOT present claimable
    balances or production-ready operator economics until **Phase 7.2 live claim validation passes**.

## Phase 9 sub-phase breakdown

- **9a — Foundation + status + blocks.** Workspace scaffold, plugins, API config + read-only DB role,
  read-only Prisma, envelope/error/serializer/pagination, TypeBox, OpenAPI gen+export+drift test,
  CORS, `/health/*`, `/api/v1/status` (free from `IndexerCursor`), `/api/v1/blocks` + `/blocks/:height`
  (with attributed proposer), the static no-chain guard, tests. **Establishes the API pattern.**
- **9b — Generic explorer.** txs + detail, accounts + detail, search (+ bech32), decode-failures,
  projection diagnostics.
- **9c — CoreSlot / validator / liveness / health.** CoreSlot list/detail (consensus key + power +
  blocks-proposed), event histories, windows, key-rotations, proposed-blocks, proposer leaderboard,
  validator-set-at-height, liveness summaries, health, network halt-risk. The operator north-star.
- **9d — Rewards.** epochs, slot rewards, claim history (7.2 gate), balances (sampled). Supply deferred.

## Proposed GitHub issues (revised)

> Do not create yet. One 9a issue now; 9b/9c/9d held until 9a establishes the pattern.

- **Issue 9a — "API foundation: Fastify app + status + blocks slice"** (single issue, internal
  checklist):
  - [ ] Scaffold `apps/api` Fastify + TS workspace; build/test/lint wiring; `api:dev`/`api:start`.
  - [ ] Add API dependencies: `fastify`, `@fastify/swagger`, `@fastify/swagger-ui`, `@fastify/cors`,
        `@sinclair/typebox`, `@fastify/type-provider-typebox` (dev: `tsx` or an existing
        repo-compatible watch runner, only if needed).
  - [ ] API config (`API_DATABASE_URL` + read-only role; documented `DATABASE_URL` fallback for
        local/test); read-only Prisma plugin (decorator + onClose).
  - [ ] Cross-cutting: TypeBox setup, `{ data }` response + `{ error }` envelopes, BigInt serializer,
        keyset pagination helper, CORS.
  - [ ] OpenAPI generation → `docs/reference/openapi.json`, `/docs` in non-prod, drift test.
  - [ ] `/health/live` (process up, no DB) + `/health/ready` (SELECT 1 + Prisma migration table
        readable + no failed migrations; API does NOT apply migrations, only verifies readiness).
  - [ ] `/api/v1/status` from `IndexerCursor` + `ProjectionCursor` (indexed height, last-observed tip,
        lag, freshness).
  - [ ] `/api/v1/blocks` + `/api/v1/blocks/:height` (DTO includes proposer read ONLY from materialized
        `BlockProposerAttribution`; raw address + null/unknown status if the row is absent).
  - [ ] Static no-chain-client/import guard + CI wiring.
  - [ ] Tests (route + repository + OpenAPI drift) and smoke against the live fixture DB.
- **Issue 9b** (later) — generic explorer API: txs, accounts, search, decode-failures, diagnostics.
- **Issue 9c** (later) — CoreSlot/validator/liveness/health/network-risk API.
- **Issue 9d** (later) — rewards API (epochs, slot rewards, claim history gated, balances sampled).
- **Issue (future, blocking `/supply` and account balances)** — indexer **balance/supply snapshot**
  samples (chain reads = indexer's job, height-tagged like `RewardsBalanceSample`): a `SupplySnapshot`
  for `/api/v1/supply`, and an `AccountBalance` snapshot for account balances. Both stay deferred in
  the API until these materialized samples land; the API then exposes them marked `source:"sampled"`.

## Validation strategy (per sub-phase)

- **Tests:** repository unit tests (mock-Prisma) + Fastify `inject()` route tests + OpenAPI drift test;
  integration tests vs a seeded test DB behind `RUN_INTEGRATION_TESTS`.
- **Commands:** `npm run db:generate && npm run typecheck && npm run build && npm test && npm run lint`,
  the new no-chain-client guard, and `npm --prefix apps/api test`.
- **9a smoke:** boot the API against the live fixture DB — `GET /health/ready`=200; `/api/v1/status`
  shows indexed height + last-observed tip + lag + freshness; `/api/v1/blocks` returns the latest
  block with attributed proposer; `/blocks/:height` matches a known block; `/docs` serves in non-prod
  and 404s in prod; OpenAPI drift test passes.
- **Per later sub-phase:** hit each new route against the validated fixture; assert DTO shape + a known
  value; OpenAPI stays in sync.
- **Codex target per sub-phase:** "DB-only (no chain import), envelope/serialization correct, OpenAPI
  matches handlers, pagination stable, observed-samples labeled, raw evidence not exposed in v1, no
  projection recompute."

## Risks & guardrails

- **Chain-leak** → omit chain-client dep + static guard incl. direct `fetch(`; no outbound network
  calls from `apps/api` (primary mitigation).
- **Balances are not derivable from event projections** → balance is bank-module current state, an
  inherently sampled observation; do not fetch live in the API and do not reconstruct ad hoc. Deferred
  to a materialized `AccountBalance` snapshot (sampled, height-tagged).
- **BigInt serialization correctness** → schema `type:string` + serializer + a focused test.
- **Raw-evidence volume / over-exposure** → BlockSignature/OperatorSigningEvidence/LivenessEvidence
  **excluded from v1** (locked); summaries/health are the public liveness surface.
- **Observed-sample mislabeling** → `source`/`sampledAtHeight` mandatory; `EpochReward` not claim truth.
- **Claim production-readiness** → gated behind Phase 7.2; v1 exposes claim *history* only.
- **`/supply` ad-hoc derivation** → forbidden; deferred to a real snapshot.
- **OpenAPI drift** → generated + checked-in + diff test.
- **`/status` freshness** → documented as indexed-vs-last-observed-tip + `updatedAt` age.
- **Write risk** → read-only DB role makes "no writes" a DB-level fact.

## Locked decisions (2026-06-26)

1. **TypeBox** with Fastify route schemas.
2. **`/status` DB-only** from `IndexerCursor`: `latestChainHeight` (last observed tip),
   `lag = latestChainHeight − lastIndexedHeight`, `freshness = updatedAt`. No indexer
   heartbeat/migration in 9a.
3. **v1 exposes CoreSlot summaries/health/network-risk; not raw** BlockSignature,
   OperatorSigningEvidence, or per-height CoreSlotLivenessEvidence (raw → later diagnostics only).
4. **`/supply` deferred** until a real `SupplySnapshot`/indexer sample exists; no ad-hoc derivation.
5. **`API_DATABASE_URL` + read-only role**; `DATABASE_URL` fallback only for local/test, documented.
6. **OpenAPI → `docs/reference/openapi.json`**, `/docs` non-prod only, drift test.
7. **Search** supports height, block hash, tx hash, account/operator address, slotId, consensus hex,
   and `twilightvalcons` bech32 normalization in the API/search layer.
8. **CORS in 9a**; rate-limit deferred to hardening unless trivial.

### Refinements (Codex review, 2026-06-26)

9. **`apps/api` performs no outbound network calls.** The static guard also fails on direct `fetch(`
   in `apps/api/src` (Node global `fetch`), with no exception expected for 9a.
10. **Envelope standardized to `{ data }` everywhere** — list `{ data, page }`, detail `{ data }`,
    error `{ error }`.
11. **Block proposer DTO reads only materialized `BlockProposerAttribution`** — raw address + null
    status if absent; `/blocks` never triggers a projection.
12. **Account balances DEFERRED** (identity/activity READY) until a materialized `AccountBalance`/
    balance-snapshot model exists; `/accounts/:address` promises no balances.
13. **`/rewards/claims` = indexed claim-history only**; no claimable balances / production economics
    until Phase 7.2 passes.
14. **`/health/ready`** = `SELECT 1` + readable `_prisma_migrations` + no failed migrations; the API
    never applies migrations.

## Final recommendation

Proceed to implement **9a as a single issue** with the checklist above; define the 9a OpenAPI contract
(`/health/*`, `/status`, `/blocks*`) before code (lock #6). Hold 9b/9c/9d until 9a establishes the
pattern. The architecture is implementable as specified, all decisions are locked, and the data is
ready.

**Phase 9 API Foundation Design: READY**
