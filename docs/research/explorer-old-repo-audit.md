# Twilight Core Explorer Old Repo Audit

Date: 2026-06-23

## Executive Summary

The copied reference repositories are useful as implementation evidence, not as a fork target. The current chain is Twilight Core: a Cosmos SDK CoreSlot PoA chain with `x/coreslot`, `x/rewards`, native accounting denom `utwlt`, and display symbol `TWLT`. The old explorer/indexers target an earlier Twilight product surface: zkOS, BTC bridge, QuisQuis, Volt/fragments, forks/oracles, dark-pool style transfer flows, and some standard Cosmos staking assumptions.

Recommendation: use the TypeScript explorer and TypeScript indexer/API as selective references for stack, layout primitives, block/tx polling patterns, Prisma conventions, pagination, health checks, and dark UI tokens. Do not fork either product wholesale. Treat the Rust indexer as historical only.

## Reference Repo Audit

| Repo | Purpose | Tech stack | Runtime dependencies | Database dependencies | Structure | Risk level | Recommendation |
|---|---|---|---|---|---|---|---|
| `reference/twilight-explorer` | Next.js web explorer for old Twilight network pages: blocks, txs, validators, deposits, withdrawals, fragments, scripts/accounts. | Next.js 14, React 18, TypeScript, Tailwind CSS, TanStack Query, Recharts, date-fns, lucide-react. | Node >= 18, API URL env vars, optional PM2 config. | None directly; consumes REST API. | `packages/web` app router, components, `src/lib/api.ts`, global Tailwind theme. | Medium | Reuse/adapt theme tokens and clean generic UI primitives. Rewrite navigation, data contracts, dashboard, module pages, and all old product pages. |
| `reference/twilight-indexer-api` | TypeScript backend monorepo that polls LCD, stores data in PostgreSQL, exposes Express REST/WebSocket API, and enriches zkOS txs. | TypeScript, Turbo, Prisma 5, Express, zod, helmet, pino, Redis, Swagger, PM2. | Node >= 18, LCD URL, Postgres, optional Redis, old `ZKOS_DECODE_URL`. | PostgreSQL via Prisma; Redis for cache/pubsub. | `packages/indexer`, `packages/api`, `prisma/schema.prisma`, docs. | High if forked; Medium if mined for patterns | Reuse generic block/tx/account/indexer/API patterns. Delete old module tables/routes/decoders and staking validator enrichment. Build new CoreSlot/rewards schema and decoders. |
| `reference/twilight-indexer` | Older Rust indexer/API for ZKOS and Bitcoin bridge statistics. | Rust 2021, Actix-web, Diesel, PostgreSQL, prost, reqwest blocking, Cosmos SDK proto crate, zkos-rust git deps. | Rust toolchain, libpq, Postgres, chain LCD/RPC, zkos-rust git dependencies. | PostgreSQL via Diesel migrations. | Combined API/indexer with blocking polling, generated proto for old bridge/zkOS txs. | Very High | Historical reference only. Do not reuse as architecture or code base for the new explorer. |

## Component Classification

| Component | Reuse | Rewrite | Delete | Notes |
|---|---:|---:|---:|---|
| Next.js monorepo shape from `twilight-explorer` | Yes | Minor | No | Good starting point for `apps/web`, but current repo should become a clean monorepo rather than a blind copy. |
| Tailwind CSS variable theme bridge | Yes | Minor | No | Keep dark surface/accent token approach. Prefer the purple/fuchsia legacy direction for Twilight Core; avoid the unrelated gold auction personality unless product asks for it. |
| `Header` layout mechanics | Partial | Yes | Delete old nav | Dropdown/mobile/search behavior is useful; current nav groups are old product concepts (`Security`, `Bitcoin`, validators/fragments/deposits/withdrawals). |
| `SearchBar` | Yes | Minor | No | Generic block height / tx hash / `twilight...` address routing is relevant. Add support for slot id and CoreSlot operator/consensus lookup later. |
| `StatsCard`, `Loading`, table/card CSS | Yes | Minor | No | Clean primitives, easy to adapt. |
| `BlockCard`, generic block/tx pages | Partial | Yes | No | Styling and rhythm are reusable; data contracts need `utwlt`, CoreSlot proposer semantics, and no staking enrichment. |
| `TxCard` module classifier | Partial | Yes | No | Replace bridge/forks/volt/zkOS classifier with `coreslot`, `rewards`, `bank`, `auth`, `unknown`. |
| `ZkosTransactionViewer`, `MessageFormatter` old module formatting | Limited | Yes | Mostly | Keep only the idea of typed message renderers. Remove zkOS/dark-pool behavior from active UI. |
| `deposits`, `withdrawals`, `fragments`, `scripts` pages | No | No | Yes | Old product pages; not part of Twilight Core CoreSlot/rewards explorer. |
| `validators` pages | No | Yes | Yes | Do not represent CoreSlot as standard staking validators. Replace with CoreSlot slot/operator pages. |
| API Express middleware, health checks, zod pagination | Yes | Minor | No | Good production shape. Readiness should include DB and indexer lag; Redis should be optional for MVP. |
| API block/tx/account routes | Partial | Yes | No | Reuse route style; remove staking proposer map and old module filters. |
| API `validators` and `bitcoin` routes | No | No | Yes | Staking and Bitcoin bridge assumptions are incompatible with current chain. |
| TS indexer block polling | Yes | Moderate | No | Useful sync loop, cursor, linkage validation, retry concepts. Need current CoreSlot/rewards semantics and better reorg strategy. |
| TS old decoders (`bridge`, `forks`, `volt`, `zkos`) | No | Yes | Yes | Replace with `twilight.coreslot.v1` and `twilight.rewards.v1` registry. |
| TS old Prisma schema | Partial | Yes | Delete old modules | Generic `Block`, `Transaction`, `Event`, `Account`, `IndexerState` are useful references only. Delete bridge/volt/forks/zkOS tables. |
| Redis cache/pubsub | Optional | Minor | No | Useful later; not required for MVP if API reads Postgres efficiently. |
| Rust indexer polling | Historical | No | Yes | Blocking loop and Diesel schema are less suitable than TS/Prisma stack. |
| Rust QuisQuis/zkOS decode | No | No | Yes | Obsolete and product-incompatible. |

## Old-Chain Concepts That Must Not Leak

These concepts appear in the reference repos and must be removed from the current explorer product surface:

- zkOS decode API and `ZKOS_DECODE_URL`
- `MsgTransferTx` / `MsgMintBurnTradingBtc` old zkOS flows
- QuisQuis / QQ account mappings
- BTC bridge deposits and withdrawals
- reserve/sweep/refund Bitcoin bridge flows
- Volt fragments and signer applications
- Boomerang / dark-pool / perps pages or terminology if present in future references
- old SATS/BTC transfer volume assumptions
- old funding/trading account language
- forks/oracle/BTC chain tip pages
- standard staking validator assumptions
- staking pool, delegation, inflation, governance, and distribution reward assumptions

## Verified Current-Chain Constraints

The local `nyks-core` repo confirms:

- `README.md` says Twilight Core is a greenfield Cosmos SDK/CometBFT PoA chain.
- Standard staking, distribution, slashing, mint, and governance modules are omitted.
- Native accounting denom is `utwlt`; display denom is `twlt`, symbol `TWLT`, six decimal places.
- CoreSlot owns validator admission, lifecycle state, consensus keys, and validator updates.
- Rewards issues scheduled `utwlt` block rewards per epoch and pays claim records to CoreSlot operators/payout addresses.

Read-only live devnet probes on 2026-06-23 initially showed the following. API-0 through API-3 later superseded the module/Swagger rows: CoreSlot REST, rewards REST, and Swagger/OpenAPI are now available and should be treated as the current design surface. The unsupported standard module rows remain intentionally unsupported.

| Endpoint | Result | Notes |
|---|---|---|
| `http://16.192.99.123:26657/status` | `200 OK` | Chain id `twilight-devnet-1`, CometBFT `0.38.19`, tx index on. |
| `/cosmos/base/tendermint/v1beta1/blocks/latest` | `200 OK` | Latest block and SDK block response available. |
| `/cosmos/base/tendermint/v1beta1/node_info` | `200 OK` | Cosmos SDK version reported as `v0.53.7`; app metadata mostly unset. |
| `/cosmos/base/node/v1beta1/config` | `200 OK` | Generic node config works. |
| `/cosmos/bank/v1beta1/supply` | `200 OK` | Supply response includes only `utwlt`. |
| `/cosmos/staking/v1beta1/pool` | `501 Not Implemented` | Expected and intentional. |
| `/cosmos/mint/v1beta1/inflation` | `501 Not Implemented` | Expected and intentional. |
| `/cosmos/gov/v1/proposals` | `501 Not Implemented` | Expected and intentional. |
| `/cosmos/distribution/v1beta1/params` | `501 Not Implemented` | Expected and intentional. |
| `/swagger/`, `/openapi.json` | Initially `501`; now available | Use current Swagger/OpenAPI as route inventory and integration-test contract. |
| `/twilight/coreslot/v1/slots` | Initially `501`; now available | Use CoreSlot REST routes for MVP snapshots; keep gRPC as future typed path. |
| `/twilight/rewards/v1/epoch-info` | Initially `501`; now available | Use rewards REST routes for MVP snapshots; keep gRPC as future typed path. |

## Repo-Specific Notes

### `reference/twilight-explorer`

Purpose: old web explorer frontend.

Reusable:

- Next.js app router structure.
- Tailwind token system in `globals.css` and `tailwind.config.js`.
- Dark high-contrast cards, tables, badges, hash formatting, loading states.
- React Query API consumption pattern.
- Search routing logic for height/hash/address.
- Basic block and transaction display component rhythm.

Must be rewritten:

- Information architecture.
- Dashboard metrics.
- Navigation.
- API types in `src/lib/api.ts`.
- Module badges and tx formatting.
- Account page semantics around `utwlt` balances and CoreSlot/reward activity.

Must be removed:

- Deposits and withdrawals pages.
- Fragments pages.
- Scripts pages if tied to old zkOS scripts.
- Validator pages as staking-like pages.
- BTC and fragment dashboard metrics.
- Any old product copy.

Obsolete:

- BTC volume widgets.
- `formatBTC` and sats formatting.
- bridge analytics, fragment health, zkOS decoded tx fields.

Risk level: Medium. UI can be adapted, but product terms are deeply mixed into app/page/api contracts.

Recommendation: extract theme and clean primitives, then rebuild pages for Twilight Core.

### `reference/twilight-indexer-api`

Purpose: TS backend and indexer for the old explorer.

Reusable:

- Workspaces/Turbo/Prisma/Express structure.
- `packages/indexer` block sync loop shape.
- LCD/REST client methods for generic blocks/txs/node/bank/account.
- `IndexerState`/cursor pattern.
- API middleware: CORS, helmet, pino, zod validation, readiness/liveness.
- Cache abstraction if Redis is adopted later.
- Swagger docs generation pattern.

Must be rewritten:

- Prisma schema around new models.
- Message decoder registry.
- Custom message processing.
- Account extraction.
- Module stats endpoints.
- Search semantics.
- Block proposer enrichment: must use CoreSlot/consensus-address mapping, not staking validators.

Must be removed:

- Bridge/forks/volt/zkOS decoders.
- zkOS enrichment worker.
- `bitcoin`, `validators`, old `twilight` routes.
- Bridge/Volt/Forks/ZKOS tables.
- `ZKOS_DECODE_URL` config.
- Calls to `/cosmos/staking/v1beta1/validators`.

Obsolete:

- External zkOS decode API.
- Bitcoin reserve/deposit/withdraw APIs.
- Validator count from bonded staking validators.
- Old `CHAIN_ID=nyks` default.

Risk level: High if forked because obsolete assumptions are schema-deep. Medium if mined for generic API/indexer patterns.

Recommendation: clean implementation using the same family of tools.

### `reference/twilight-indexer`

Purpose: older Rust ZKOS/bridge statistics API and indexer.

Reusable:

- High-level evidence of old chain concepts.
- Some historical transaction type names can help identify what to delete.

Must be rewritten:

- Everything if reused, which means it should not be reused.

Must be removed:

- QuisQuis decoder.
- BTC bridge tables and APIs.
- standard staking/gov/distribution tx support.
- Diesel schema and blocking 30-second polling loop as a production base.

Obsolete:

- Satoshi accounting.
- funding/trading account split.
- old API shape around `/api/funding`, `/api/exchange-withdrawal`, `/api/qq-account`.

Risk level: Very High.

Recommendation: historical reference only.

## Build vs Reuse Decision

| Option | Pros | Cons | Risk | Estimated time | Recommendation |
|---|---|---|---|---|---|
| 1. Fork old TS explorer/indexer | Fast initial scaffold; known Next/Express/Prisma shape; theme already present. | Old product assumptions are everywhere: routes, schema, nav, metrics, docs, decoders, env vars. Easy to ship a misleading explorer. | High | 1-2 weeks to appear functional, then high cleanup cost | Do not choose. |
| 2. Clean repo, copy selected components/patterns | Preserves useful stack and visual language; avoids stale schema/product leakage; allows CoreSlot-native data model. | More upfront scaffolding; requires disciplined component extraction. | Medium | 2-4 weeks for production MVP depending on gRPC access and backfill scope | Choose this. |
| 3. Build fully from scratch | Maximum cleanliness; no old conceptual baggage. | Slower; risks re-solving generic explorer/API concerns already available in references. | Medium | 4-6 weeks for MVP | Good fallback if old code quality proves more expensive than expected. |

Hard recommendation: Option 2, clean repo plus selective adaptation of the TypeScript web/API/indexer patterns. Discard the old Rust stack for this product.
