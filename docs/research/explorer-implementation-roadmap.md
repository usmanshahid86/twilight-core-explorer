# Twilight Core Explorer Implementation Roadmap

Date: 2026-06-23

## MVP Definition

Generic explorer MVP:

- latest blocks
- block detail
- latest txs
- tx detail
- account lookup
- `utwlt` supply
- node/network status
- search by height, tx hash, and address

Twilight-specific MVP:

- CoreSlot slots
- rewards current epoch
- finalized epochs
- reward claims
- cumulative emitted
- module balances

Non-goals:

- no deployment in research/design pass
- no live devnet modification
- no chain code modification
- no AWS resources
- no fake staking/gov/mint/distribution compatibility
- no BTC bridge/zkOS/QuisQuis/dark-pool pages

## Mandatory Pre-Implementation Route Contract Task

Before writing `ChainClient` route constants, import one of:

- `docs/reference/rest-routes.md` from `twilight-core`, or
- `app/openapi/twilight.swagger.json` exported from `twilight-core` `/swagger/twilight.swagger.json`.

The imported route contract is the source of truth for:

- all 10 `x/rewards` routes
- all 10 `x/coreslot` routes
- enabled generic Cosmos REST routes
- intentionally unsupported staking, governance, mint module, and distribution routes

Hard-coded routes in code must be tested against this contract. Route-contract tests must fail if:

- the active slots route regresses to the legacy nested active-slots variant
- any required rewards/CoreSlot route is missing
- the indexer calls staking, governance, mint module, or distribution routes

## Phase A — Repo Scaffold and Theme Foundation

Scope:

- Create TypeScript monorepo structure.
- Add Next.js web app, API app, indexer app, shared config/db/chain-client/decoder packages.
- Define the stable `ChainClient` interface in `packages/chain-client`.
- Add the `RestRpcChainClient` skeleton as the first transport implementation.
- Add Prisma/Postgres baseline.
- Adapt reference Twilight dark purple/fuchsia theme tokens.
- Add base layout, navigation, cards, tables, badges, search, loading/error states.

Components/files:

- `package.json`, workspace config
- `apps/web`
- `apps/api`
- `apps/indexer`
- `packages/config`
- `packages/db`
- `packages/chain-client`
- `packages/decoder`
- `packages/ui` if needed
- `prisma/schema.prisma`
- `docker-compose.yml`

Acceptance criteria:

- Local web/API/indexer packages build.
- `ChainClient` interface exists and is imported by indexer code boundaries, not bypassed by processors.
- `RestRpcChainClient` owns route constants internally.
- Web renders a real dashboard shell, not a marketing page.
- Theme matches dark Twilight direction and contains no old BTC/zkOS pages.
- Navigation uses Dashboard, Blocks, Transactions, Accounts, CoreSlot, Rewards, Claims, Supply, Network, API Status.

Tests:

- Typecheck all packages.
- Lint all packages.
- Minimal web smoke test for dashboard render.

Risks:

- Copying too much old frontend creates stale IA.
- Over-abstracting shared UI too early.

What not to do:

- Do not port deposits/withdrawals/fragments/scripts pages.
- Do not add staking validator pages.
- Do not deploy.

## Phase B — Generic Block/Tx/Account Indexer

Scope:

- Implement read-only indexer against `ChainClient`, backed first by `RestRpcChainClient`.
- `RestRpcChainClient` uses live CometBFT RPC and generic Cosmos REST for generic chain data.
- Store blocks, txs, messages, events, accounts, cursor, decode failures.
- Handle empty blocks and unknown decodes.
- Include mandatory `/block_results` event ingestion from CometBFT RPC.
- Add production-shaped chain-client boundaries so Phase D/E can reuse the same interface for module snapshots.

Components/files:

- `apps/indexer/src/index.ts`
- `packages/chain-client/src/chain-client.ts`
- `packages/chain-client/src/rest-rpc-chain-client.ts`
- `packages/chain-client/src/route-contract.test.ts`
- `packages/decoder/src/registry.ts`
- `packages/db`
- `prisma/schema.prisma`

Acceptance criteria:

- Indexer can start from configured height and reach tip on devnet.
- Blocks with zero txs are stored.
- Tx responses are stored when present.
- Events from tx responses and `/block_results` are stored.
- Cursor updates only after successful height transaction.
- Unknown messages/events do not fail indexing.
- Indexer and processors call `ChainClient` methods rather than raw REST/RPC helpers.
- Raw source payloads remain available for audit/debug while normalized source objects are passed to processors.

Tests:

- Unit tests for type URL classification.
- Unit tests for event attribute parsing.
- Integration test with saved block/tx fixtures.
- Idempotent re-run test over same height range.
- Chain-client test proves the indexer can fetch `/block_results` from CometBFT RPC.
- Guard test or static assertion proves the indexer does not call staking, governance, mint module, or distribution routes.
- Route-contract tests fail if the active slots route regresses to the legacy nested active-slots variant.
- Route-contract tests fail if any required CoreSlot or rewards route is missing.

Risks:

- Module REST routes are now available through `RestRpcChainClient`, but Phase B should not skip event ingestion because CoreSlot/rewards lifecycle history still depends on `/block_results`.
- Reorg/hash mismatch strategy needs controlled rollback.

What not to do:

- Do not query staking validators to enrich proposers.
- Do not assume txs exist in every block.
- Do not skip EndBlock events.

## Phase C — API and Web Generic Explorer

Scope:

- Expose indexed generic data through API.
- Build web pages for dashboard, blocks, block detail, txs, tx detail, accounts, search, network/API status.
- Add supply endpoint from bank supply snapshots.

Components/files:

- `apps/api/src/routes/blocks.ts`
- `apps/api/src/routes/txs.ts`
- `apps/api/src/routes/accounts.ts`
- `apps/api/src/routes/search.ts`
- `apps/api/src/routes/status.ts`
- `apps/api/src/routes/supply.ts`
- `apps/web/src/app/blocks`
- `apps/web/src/app/txs`
- `apps/web/src/app/accounts`
- `apps/web/src/app/search`
- `apps/web/src/app/network`

Acceptance criteria:

- Search routes height/tx hash/address correctly.
- Block detail shows header hashes, proposer, tx list, events, raw JSON drawer.
- Tx detail shows messages, events, fee/gas/status/signers, decode status.
- Account page shows current `utwlt` balances and tx activity.
- API health/ready includes DB and indexer lag.

Tests:

- API route tests with seeded DB.
- Web component tests for empty/loading/error states.
- Playwright smoke for dashboard/search/block/tx pages once frontend exists.

Risks:

- Search can become ambiguous between numeric slot ids and block heights; API should return typed result choices when ambiguity exists.

What not to do:

- Do not add old module filters.
- Do not represent proposer as a staking validator.

## Phase D — CoreSlot Semantic Indexing/Pages

Scope:

- Add CoreSlot message/event parsers.
- Consume `ChainClient` for CoreSlot snapshots.
- `RestRpcChainClient` supplies CoreSlot snapshots through Twilight REST as the first transport.
- Keep a future path for `GrpcChainClient` generated CoreSlot clients.
- Build CoreSlot list/detail/event pages.
- Map consensus proposer addresses to CoreSlot when possible.

Components/files:

- `packages/decoder/src/coreslot.ts`
- `packages/chain-client/src/rest-rpc-chain-client.ts`
- `apps/indexer/src/processors/coreslot.ts`
- `apps/api/src/routes/coreslot.ts`
- `apps/web/src/app/coreslot`
- `apps/web/src/components/coreslot/*`

Acceptance criteria:

- Slot list shows slot id, status, operator, payout, consensus address/pubkey, reward weight, updated height.
- Slot detail shows metadata and lifecycle timeline.
- Events table includes registration/activation/inactivation/suspension/removal/key rotation/payout/metadata/params/validator update events.
- Active/suspended/removed slots are clearly distinct.
- No staking/delegation terminology appears.

Tests:

- Parser tests for every CoreSlot event type.
- Message decoder tests for every CoreSlot Msg type.
- Projection rebuild test from stored events.
- API tests for status filters.
- Chain-client integration tests call representative CoreSlot REST routes, including slot list and active slots.
- Route-contract test checks CoreSlot REST paths against imported Swagger/OpenAPI or `docs/reference/rest-routes.md`.

Risks:

- REST JSON validation must be explicit inside `RestRpcChainClient` because generated gRPC types are deferred.
- Consensus address formats differ between CometBFT hex/base64 and SDK bech32; normalize carefully.

What not to do:

- Do not create a `Validator` or `Delegation` model as the primary abstraction.
- Do not use staking `/validators`.

## Phase E — Rewards Semantic Indexing/Pages

Scope:

- Add rewards message/event parsers.
- Consume `ChainClient` for rewards snapshots.
- `RestRpcChainClient` supplies rewards snapshots through Twilight REST as the first transport.
- Keep a future path for `GrpcChainClient` generated rewards clients.
- Snapshot epoch info, finalized epoch detail, slot rewards, claimable rewards, cumulative emitted, supply schedule, current active blocks, module balances.
- Build rewards overview, epoch detail, claims, and supply views.

Components/files:

- `packages/decoder/src/rewards.ts`
- `packages/chain-client/src/rest-rpc-chain-client.ts`
- `apps/indexer/src/processors/rewards.ts`
- `apps/api/src/routes/rewards.ts`
- `apps/api/src/routes/claims.ts`
- `apps/web/src/app/rewards`
- `apps/web/src/app/claims`
- `apps/web/src/app/supply`
- `apps/web/src/components/rewards/*`

Acceptance criteria:

- Rewards overview shows current epoch, current epoch start/end height, pause state, params summary.
- Finalized epochs list shows emission amount, allocated amount, carry out, eligible slots, and reward allocation method.
- Claims table shows epoch, slot id, payout address, amount, claimed state, claim tx hash when indexer-correlated.
- Cumulative emitted and module balances are visible.
- Amount display supports raw `utwlt` and display `TWLT`.

Tests:

- Parser tests for every rewards event type.
- Message decoder tests for all rewards Msg types.
- Epoch finalization fixture test that creates `RewardEpoch` and `RewardClaim` rows.
- Claim tx correlation test.
- Chain-client integration tests call representative rewards REST routes, including `epoch-info`, `epoch-reward`, `slot-rewards`, and `module-balances`.
- Route-contract test checks rewards REST paths against imported Swagger/OpenAPI or `docs/reference/rest-routes.md`.

Risks:

- `reward_claimed` event does not store tx hash in consensus state; correlation must come from indexed tx context.
- Current epoch state is live query/snapshot data, not purely event-derived.
- REST snapshots can race with event indexing height; persist observed height or indexer cursor context with snapshots.

What not to do:

- Do not model rewards as staking distribution rewards.
- Do not use `/cosmos/distribution`.
- Do not call `/cosmos/mint`.

## Phase F — Deployment Packaging

Scope:

- Containerize web, API, and indexer.
- Provide Docker Compose for local production-like testing.
- Add env var docs and health checks.
- Add migration workflow.

Components/files:

- `apps/*/Dockerfile`
- root `docker-compose.yml`
- `.env.example`
- migration scripts
- `docs/deployment/*`

Acceptance criteria:

- One command starts Postgres, API, indexer, web locally against configured read-only devnet.
- API readiness fails clearly if DB unavailable or indexer lag exceeds threshold.
- Indexer runs as single active writer using Postgres advisory lock.

Tests:

- Container build test.
- Compose smoke test against a small height range or fixtures.

Risks:

- Running an unconstrained backfill against live devnet could stress endpoints; use rate limits and configurable start/end heights.

What not to do:

- Do not create AWS resources.
- Do not modify live devnet.
- Do not hard-code devnet IP as production config.

## Phase G — Hardening and Production Testnet Readiness

Scope:

- Add operational features and production safety.

Hardening backlog:

- batch backfill
- multi-RPC fallback
- `GrpcChainClient` behind the same `ChainClient` interface
- REST-vs-gRPC output comparison tests for CoreSlot/rewards snapshots where useful
- indexer lag monitoring
- WebSocket/SSE updates
- Redis cache/pubsub
- rate limiting
- nginx/TLS
- DB backups
- reindex/reset workflow
- decode failure dashboard
- event parser tests
- charts
- structured logs and metrics
- Sentry/OpenTelemetry if desired
- admin-only re-decode job

Acceptance criteria:

- Backfills can pause/resume safely.
- Reindex workflow is documented and tested.
- Unknown decode failures are visible and actionable.
- API has rate limits and cache controls.
- DB backup/restore drill exists.
- Explorer can survive RPC transient failures without corrupting cursor.
- `GrpcChainClient` can be added without changing indexer processors or persistence models.

Tests:

- Long-running backfill test.
- RPC failure/retry tests.
- DB restore/reindex drill.
- Load test for common API routes.
- Playwright responsive visual tests.

Risks:

- Charts and live updates can distract from correctness; defer until data model is stable.
- Multi-RPC fallback must not mix different chain ids or inconsistent heights.

What not to do:

- Do not introduce compatibility shims that imply standard staking/gov/mint/distribution modules.
- Do not add write operations to chain.

## Top 10 First Implementation Tasks

1. Import `docs/reference/rest-routes.md` or `app/openapi/twilight.swagger.json` as the mandatory route contract.
2. Scaffold monorepo and shared TypeScript config.
3. Define `ChainClient` and implement `RestRpcChainClient` as the first transport.
4. Add route-contract tests, including active-slots regression and unsupported-route guards.
5. Add Prisma schema with generic and CoreSlot/rewards MVP models.
6. Add Postgres Docker Compose and migration workflow.
7. Implement generic block/tx/event indexer through `ChainClient`, including `/block_results`.
8. Implement raw message/event storage and decode failure capture.
9. Implement API health/status/blocks/txs/accounts/search routes.
10. Add CoreSlot/rewards processors consuming `ChainClient` snapshots plus event parsers.

## Acceptance Gate for Starting Build

Proceed to implementation only after:

- These research docs are reviewed.
- CoreSlot/rewards REST route contract is imported.
- Generated gRPC client work is accepted as production hardening, not an MVP blocker.
- `ChainClient`/`RestRpcChainClient` boundary is accepted as the first implementation architecture.
- The team agrees not to fork old product pages.
- The data model is accepted as the starting schema.
- The MVP page list is accepted.
