# Twilight Core Explorer Phase A/B-1 Implementation Report

## Result

Phase A/B-1 is implemented as the initial production-shaped scaffold.

This pass creates the TypeScript workspace, shared runtime config package, chain-client package, route-contract-backed route constants, `ChainClient` interface, and `RestRpcChainClient` first transport implementation. It does not implement the indexer loop, database schema, API service, web app, or generated gRPC clients.

## Files and Packages Added

| Area | Files | Notes |
|---|---|---|
| Workspace | `package.json`, `tsconfig.base.json`, `.gitignore`, `apps/.gitkeep` | npm workspaces for `apps/*` and `packages/*`; shared strict TypeScript config. |
| Config | `packages/config/*` | `loadConfig()` reads `CHAIN_ID`, `COMET_RPC_URL`, `REST_URL`, and `REQUEST_TIMEOUT_MS` with safe localhost defaults. No devnet IPs are hard-coded. |
| Chain client | `packages/chain-client/src/*` | Stable `ChainClient` interface, route constants, HTTP helper, error wrapper, and `RestRpcChainClient`. |
| Route contract | `docs/reference/rest-routes.md`, `app/openapi/twilight.swagger.json` | Imported current route contract from Twilight Core. Swagger has 61 paths and includes 20 Twilight custom routes. |
| Tests | `packages/config/test/*`, `packages/chain-client/test/*` | Config validation, route-contract validation, URL routing, and HTTP failure handling. |

## ChainClient Boundary

The indexer and future semantic processors should depend on `ChainClient`, not raw REST/RPC paths.

The first implementation is:

`RestRpcChainClient = CometBFT RPC + Cosmos REST + Twilight REST`

The future implementation remains:

`GrpcChainClient = CometBFT RPC + generated TypeScript gRPC/proto clients`

Both implementations must satisfy the same interface and normalize into the same persistence model. The code added in this pass keeps all transport route strings inside `packages/chain-client`.

## Implemented ChainClient Methods

Generic chain data:

- `getStatus()`
- `getBlock(height)`
- `getBlockResults(height)`
- `getTx(hash)`
- `getTxsByHeight(height)`
- `getSupply()`
- `getBalances(address)`

CoreSlot snapshots:

- `getCoreSlotParams()`
- `getCoreSlots()`
- `getActiveCoreSlots()`
- `getCoreSlot(slotId)`
- `getCoreSlotByOperator(operatorAddress)`
- `getCoreSlotByConsensusAddress(consensusAddress)`
- `getPendingKeyRotations()`
- `getLastAppliedValidators()`
- `getReservedConsensusAddress(consensusAddress)`
- `getRewardWeight(slotId)`

Rewards snapshots:

- `getRewardsParams()`
- `getEpochInfo()`
- `getNextHalving()`
- `getEpochReward(epoch)`
- `getSlotRewards(slotId, pagination?)`
- `getClaimableRewards(slotId, startEpoch, endEpoch)`
- `getCumulativeEmitted()`
- `getSupplySchedule()`
- `getCurrentEpochActiveBlocks()`
- `getModuleBalances()`

## Route Contract

The imported route contract is now executable in tests.

Tests assert:

- Swagger is imported and exposes 61 paths.
- All 10 x/rewards routes are present.
- All 10 x/coreslot routes are present.
- `CORE_SLOT_REST_ROUTES.activeSlots` is `/twilight/coreslot/v1/active-slots`.
- The stale active-slots route is absent from route constants and Swagger.
- Unsupported standard module route families are not exposed in Swagger.
- Unsupported standard module paths do not appear in implementation files.

The active slots route must remain:

`/twilight/coreslot/v1/active-slots`

## Transport Policy

CometBFT RPC remains mandatory for:

- `/status`
- `/block`
- `/block_results`
- `/tx`

Cosmos REST is used for first-transport generic reads:

- blocks/latest or block by height when useful later
- tx query by height
- bank supply
- bank balances

Twilight REST is used for first-transport module snapshots:

- x/coreslot query routes
- x/rewards query routes

Generated gRPC/proto clients are intentionally not implemented in this pass. They should be added later behind the same `ChainClient` interface.

## Not Implemented

- Prisma schema
- Postgres
- indexer cursor
- indexer polling loop
- block or event persistence
- semantic CoreSlot processors
- semantic rewards processors
- API routes
- web pages
- Docker deployment
- Redis
- generated gRPC/proto clients
- buf migration

## Validation

Expected validation commands:

```sh
npm install
npm run typecheck
npm test
npm --prefix packages/chain-client run typecheck
npm --prefix packages/chain-client test
npm --prefix packages/config run typecheck
```

Additional route checks:

```sh
STALE_PREFIX="/twilight/coreslot/v1/slots"
grep -R "$STALE_PREFIX/active" docs packages app --exclude='twilight.swagger.json' || true
SHORT_STALE="/slots"
grep -R "$SHORT_STALE/active" docs packages app --exclude='twilight.swagger.json' || true
```

Both route checks should return no stale references.

## Next Recommended Step

Phase A/B-2 should add Prisma schema, an `IndexerCursor`, and the first block ingestion worker:

1. Store block headers from CometBFT `/block`.
2. Store begin/end block events from CometBFT `/block_results`.
3. Store raw transaction result data by height.
4. Persist decode failures without stopping ingestion.
5. Keep all chain calls behind `ChainClient`.
