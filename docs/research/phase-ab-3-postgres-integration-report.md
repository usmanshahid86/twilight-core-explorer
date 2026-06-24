# Twilight Core Explorer Phase A/B-3 Postgres Integration Report

## 1. Summary

Phase A/B-3 adds the local Postgres integration path for the Phase A/B-2 indexer foundation.

Implemented:

- Local Postgres `docker-compose.yml`.
- `.env.example` for explorer/indexer database and chain config.
- Root DB scripts for migration deploy, test DB reset, Prisma Studio, and integration tests.
- Safe test database reset script.
- Postgres readiness wait script.
- Real Prisma/Postgres integration test file for `ingestHeight()`.
- Local range-ingestion smoke alias.

Validation status: pass. After Docker daemon access became available, the Postgres container started, migrations deployed, the test database reset safely, and the opt-in real Prisma/Postgres integration suite passed.

## 2. Files Changed

- `package.json`
- `package-lock.json`
- `.env.example`
- `docker-compose.yml`
- `scripts/reset-test-db.js`
- `scripts/wait-for-postgres.js`
- `apps/indexer/package.json`
- `apps/indexer/src/account-extraction.ts`
- `apps/indexer/src/advisory-lock.ts`
- `apps/indexer/src/mapper.ts`
- `apps/indexer/test/ingest-height.integration.test.js`
- `docs/research/phase-ab-3-postgres-integration-report.md`

## 3. Docker/Postgres Setup

Added `docker-compose.yml` with:

- service name: `postgres`
- image: `postgres:16`
- container: `twilight-core-explorer-postgres`
- database: `twilight_explorer`
- user/password: `twilight` / `twilight`
- local port: `5432`
- persistent volume: `twilight_explorer_pgdata`
- healthcheck using `pg_isready`

Added `.env.example` with:

- `DATABASE_URL`
- `TEST_DATABASE_URL`
- `CHAIN_ID`
- `COMET_RPC_URL`
- `REST_URL`
- `REQUEST_TIMEOUT_MS`
- `START_HEIGHT`
- `END_HEIGHT`

No public devnet IPs are hard-coded.

## 4. DB Scripts

Root scripts added:

- `db:deploy`
- `db:studio`
- `db:reset:test`
- `test:integration`
- `indexer:dev`

`scripts/wait-for-postgres.js`:

- reads `DATABASE_URL` or `TEST_DATABASE_URL`
- retries until Postgres responds
- exits non-zero when unavailable

`scripts/reset-test-db.js`:

- requires `TEST_DATABASE_URL`
- refuses to run unless the database name includes `_test`
- connects through the `postgres` admin database
- terminates existing test DB connections
- drops and recreates the test database
- runs `prisma migrate deploy` against `TEST_DATABASE_URL`

Safety checks verified:

- missing `TEST_DATABASE_URL` exits non-zero
- non-test database URL exits non-zero before any reset

## 5. Migration Validation

Prisma client generation passed:

```sh
npm run db:generate
```

Migration deployment against a live Postgres database passed:

```sh
docker compose up -d postgres
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public node scripts/wait-for-postgres.js
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public npm run db:deploy
```

The migration `20260624000100_init` applied successfully to `twilight_explorer`.

The test DB reset/migration workflow also passed:

```sh
TEST_DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer_test?schema=public npm run db:reset:test
```

## 6. Integration Test Coverage

Added:

`apps/indexer/test/ingest-height.integration.test.js`

The test is explicit opt-in:

```sh
RUN_INTEGRATION_TESTS=1 TEST_DATABASE_URL=... npm run test:integration
```

Without `RUN_INTEGRATION_TESTS=1`, it skips clearly.

The integration test uses:

- real `PrismaClient`
- `TEST_DATABASE_URL`
- existing A/B-2 fixtures
- fixture `ChainClient`, not live network
- real calls to `ingestHeight()`

Covered assertions:

- empty block writes `Block`, block-results `Event` rows, and cursor success
- tx block writes `Block`, `ExplorerTransaction`, `Message`, tx events, block-results events, account rows, and cursor success
- re-ingesting same height does not duplicate durable rows
- hash mismatch does not overwrite the stored block and sets `halted_hash_mismatch`
- failed source call does not advance cursor and records `halted_error`
- advisory lock acquires/releases against Postgres

## 7. Advisory Lock and Cursor Behavior

The advisory lock helper is covered by:

- mocked unit test from A/B-2
- real Postgres integration test path in A/B-3

The real DB run exposed that Prisma parameters need explicit `integer` casts for Postgres advisory lock functions. The helper now casts both advisory-lock key parts to `integer`.

Cursor behavior in the integration test path verifies:

- success cursor advances only after writes complete
- hash mismatch sets `halted_hash_mismatch`
- failed source call sets `halted_error` without advancing to the failed height

## 8. Idempotency and Hash Mismatch

The real-DB integration test path verifies:

- `Block.height` idempotency
- `ExplorerTransaction.hash` idempotency
- `Message.txHash,msgIndex` idempotency
- `Event.eventKey` idempotency
- hash mismatch halt behavior

`apps/indexer/src/mapper.ts` was also adjusted so JSON attributes omit optional `undefined` values before entering Prisma JSON columns.

`apps/indexer/src/account-extraction.ts` now also recognizes Cosmos-style event attributes shaped as `{ key, value }`, so address-bearing event attributes are discovered during real persistence tests.

## 9. Validation Commands and Results

Passed:

```sh
npm install
npm run db:generate
npm run typecheck
npm test
npm run lint
npm --prefix packages/chain-client test
npm --prefix packages/config test
npm --prefix apps/indexer test
npm run test:integration
RUN_INTEGRATION_TESTS=1 TEST_DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer_test?schema=public npm run test:integration
```

`npm run test:integration` passed in skip mode when `RUN_INTEGRATION_TESTS` was not set.

Docker/Postgres validation passed:

```sh
docker compose up -d postgres
```

Postgres readiness passed:

```sh
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public node scripts/wait-for-postgres.js
```

Migration deployment passed:

```sh
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public npm run db:deploy
```

Test DB reset and migration passed:

```sh
TEST_DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer_test?schema=public npm run db:reset:test
```

Real integration tests passed:

```sh
RUN_INTEGRATION_TESTS=1 TEST_DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer_test?schema=public npm run test:integration
```

Scope guards passed:

```sh
STALE_CORE_SLOT_PREFIX="/twilight/coreslot/v1/slots"
grep -R "$STALE_CORE_SLOT_PREFIX/active" apps packages prisma docs scripts --exclude-dir=node_modules || true

STANDARD_MODULE_PREFIX="/cosmos"
grep -R "$STANDARD_MODULE_PREFIX/staking\|$STANDARD_MODULE_PREFIX/gov\|$STANDARD_MODULE_PREFIX/mint\|$STANDARD_MODULE_PREFIX/distribution" apps packages prisma docs scripts --exclude-dir=node_modules || true
```

Results:

- no stale active-slots route references
- standard-module route mentions only appear in docs as unsupported/non-goals

## 10. Real DB Findings Fixed

The real Postgres run caught two issues that mocked tests did not:

- Cosmos-style event attributes shaped as `{ key, value }` were not being used for account extraction. Fixed in `apps/indexer/src/account-extraction.ts`.
- Prisma sent advisory-lock parameters with types that did not match Postgres `pg_try_advisory_lock(integer, integer)`. Fixed with explicit `::integer` casts in `apps/indexer/src/advisory-lock.ts`.

## 11. Known Limitations

- No live local-chain range ingestion smoke was run.
- The indexer remains range-based, not an infinite daemon.
- Account extraction remains conservative and prefix-based.
- No API/web pages exist yet.
- No CoreSlot/rewards semantic projections exist yet.

## 12. Explicit Non-Goals

Not implemented:

- CoreSlot semantic projection
- rewards semantic projection
- API routes
- web pages
- generated gRPC clients
- buf migration
- Redis
- WebSockets/SSE
- Docker production packaging for all apps
- live devnet deployment
- chain code changes

No staking, delegation, governance, mint, or distribution explorer models were added.

## 13. Next Step Recommendation

Proceed to Phase A/B-4: durable range-ingestion smoke against a local Twilight chain or saved RPC fixture server, still without CoreSlot/rewards semantic projections.
