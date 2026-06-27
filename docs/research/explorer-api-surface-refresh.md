# Twilight Core Explorer API Surface Refresh

Date: 2026-06-23

> **⚠ Superseded for status/sequencing (2026-06-28).** Point-in-time research note. Its technical body
> (chain REST surface, source-of-truth table, claim-truth semantics) is still accurate and matches the
> built code, but its forward-looking framing is done: the transport plan is **built** (`ChainClient` +
> `RestRpcChainClient` + route-contract tests, Phase A/B), and everything through **Phase 12** is
> complete (next is Phase 13). Scoping note: this doc describes the **chain's** custom-module REST
> surface consumed by `ChainClient` (now in `packages/chain-client/src/routes.ts`), **NOT** the
> explorer's own API — the explorer's public contract is
> [`../reference/openapi.json`](../reference/openapi.json) (**32 paths**), and the "61 paths" figure
> below refers to the upstream twilight-core swagger, not the explorer. The route contract is now
> checked in (`docs/reference/rest-routes.md` + `app/openapi/twilight.swagger.json`). Status index:
> [`explorer-project-checkpoint.md`](explorer-project-checkpoint.md).

## 1. What Changed

The base Twilight Core API surface has improved since the original explorer research pass:

- `x/rewards` gRPC-Gateway REST routes are now wired and validated.
- `x/coreslot` gRPC-Gateway REST routes are now wired and validated.
- REST gateway now exposes all 10 rewards query RPCs.
- REST gateway now exposes all 10 CoreSlot query RPCs.
- `/swagger/` now serves a merged OpenAPI contract for the enabled REST surface.
- The merged spec reportedly includes 61 paths total: 20 Twilight custom routes and 41 generic Cosmos routes.
- gRPC remains the canonical typed module API.
- CometBFT RPC remains unchanged and required for blocks, transactions, `/block_results`, consensus, and node data.
- Standard staking, governance, mint module, and distribution REST surfaces remain intentionally unsupported.

No copied `docs/reference/rest-routes.md`, Swagger JSON, or OpenAPI JSON was present in this repo during this refresh, so route details below use the verified state supplied with this task plus the previously inspected local proto route annotations.

## 2. Obsolete Explorer Assumptions

The following assumptions from the first research pass are now obsolete:

- CoreSlot and rewards module REST snapshots are no longer unavailable.
- Semantic indexing no longer needs a gRPC or CLI-backed query adapter as a blocker for the first transport implementation.
- Swagger/OpenAPI is no longer unavailable; it can be used as a route inventory and integration-test contract.
- Phase D/E sequencing no longer needs to wait on generated TypeScript protobuf clients.
- Module snapshot reads can be browser/debug friendly in the first `ChainClient` transport because REST now exposes the query surfaces.

## 3. Decisions That Remain Unchanged

These design decisions still stand:

- Do not fork the old zkOS/BTC/QuisQuis product.
- Do not create staking-style explorer abstractions.
- Do not depend on staking, governance, mint module, or distribution endpoints.
- Do not remove CometBFT RPC from the indexer design.
- Do not make REST the only production API path.
- Store raw block, tx, message, event, and module snapshot JSON.
- Keep gRPC as the canonical typed module API and future generated-client path.
- Build a stable `ChainClient` interface now; REST/RPC is the first implementation, not a throwaway shortcut.
- Use a Twilight-native data model: CoreSlot, rewards epochs, claims, module balances, `utwlt`, and generic blocks/txs/accounts.

## 4. Updated Source-of-Truth Table

| Data category | Primary source | Secondary/fallback | Notes |
|---|---|---|---|
| Blocks | CometBFT RPC `/block` | Cosmos REST `/cosmos/base/tendermint/v1beta1/blocks/{height}` | REST is useful for SDK-shaped block JSON; RPC remains canonical for block history and consistency with `/block_results`. |
| Latest height / node sync | CometBFT RPC `/status` | Cosmos REST latest block | Use `/status` for catching-up state and node info; REST latest block can cross-check height/time. |
| Block results / BeginBlock / EndBlock events | CometBFT RPC `/block_results` | None | Mandatory for CoreSlot/rewards lifecycle events outside tx responses. Do not replace with REST. |
| Transactions by hash | CometBFT RPC `/tx` and Cosmos tx REST `/cosmos/tx/v1beta1/txs/{hash}` | Indexed DB after ingestion | Use whichever response gives the best decoded SDK tx/result data; keep raw payloads. |
| Transactions by height | Cosmos tx REST event query | CometBFT block raw txs + `/tx` lookups | Cosmos tx REST is convenient for tx responses; RPC remains available for raw verification. |
| Accounts | Cosmos auth REST if enabled | Event/message-derived account discovery | Account rows are explorer projections, not a full auth mirror. |
| Balances | Cosmos bank REST `/cosmos/bank/v1beta1/balances/{address}` | Indexed snapshots | Use for account detail and balance snapshot refresh. |
| Supply | Cosmos bank REST `/cosmos/bank/v1beta1/supply` | Rewards cumulative emitted REST for emission context | Supply is bank data; rewards cumulative emitted explains scheduled emissions. |
| CoreSlot current state | `ChainClient` backed first by Twilight CoreSlot REST `/twilight/coreslot/v1/*` | `GrpcChainClient` later; CoreSlot event projection | REST/RPC is the first production-shaped transport. Events remain lifecycle history. |
| CoreSlot lifecycle history | Event projection from `/block_results` and tx events | CoreSlot REST snapshots for current state | Snapshots cannot replace historical event indexing. |
| Rewards current/finalized state | `ChainClient` backed first by Twilight rewards REST `/twilight/rewards/v1/*` | `GrpcChainClient` later; rewards event projection | REST/RPC is the first production-shaped transport for epoch/current/module snapshots. |
| Reward claims | Twilight rewards REST slot rewards / claimable routes | Tx/message/event correlation for `claimTxHash` | Consensus state does not store claim tx hashes; indexer must correlate. |
| Module balances | Twilight rewards REST module-balances route | Bank balances for known module accounts if needed | Snapshot at startup, epoch finalization, and periodic intervals. |
| Swagger/OpenAPI | `/swagger/` | Checked-in Swagger JSON or `docs/reference/rest-routes.md` when copied | Route discovery and integration-test inventory only; not a runtime dependency. |
| gRPC | Canonical typed module API | REST/RPC first implementation through the same `ChainClient` interface | Use later for generated TS clients or if REST becomes insufficient. |

## 5. Updated Integration Strategy

### Generic Blocks

Use CometBFT RPC `/block` as the primary ingestion source for block history. Cosmos REST block endpoints can be used for SDK-shaped block JSON and cross-checking, but the indexer should be comfortable operating from RPC because `/block_results` is paired with height-by-height RPC ingestion.

### Transactions

Use Cosmos tx REST for convenient decoded transaction responses by hash and by `tx.height` event query where available. Keep CometBFT RPC `/tx` support for raw verification and fallback. Store both raw tx and raw result JSON where possible.

### `block_results` Events

Always fetch CometBFT RPC `/block_results?height=N`. This is the only required source for begin-block and end-block events, including non-transaction CoreSlot/rewards lifecycle signals. The new REST module routes do not replace event ingestion.

### Accounts and Balances

Use Cosmos bank REST for balances. Use auth REST for account metadata if enabled and useful, but derive explorer account discovery primarily from tx signers, messages, and events.

### Supply

Use Cosmos bank REST `/cosmos/bank/v1beta1/supply` for total `utwlt` supply. Pair it with rewards REST `cumulative-emitted` and `supply-schedule` snapshots for emission context.

### CoreSlot Snapshots

Use Twilight CoreSlot REST routes for MVP snapshots:

- `/twilight/coreslot/v1/params`
- `/twilight/coreslot/v1/slots`
- `/twilight/coreslot/v1/slots/{slot_id}`
- `/twilight/coreslot/v1/active-slots`
- `/twilight/coreslot/v1/operators/{operator_address}`
- `/twilight/coreslot/v1/consensus/{consensus_address}`

Active slots route must come from the current route contract. The validated chain route is `/twilight/coreslot/v1/active-slots`; do not use the legacy nested active-slots variant that collides with the slot-id route.

The remaining CoreSlot query RPCs are also available through the gateway per the validated API report, even where the original proto did not show HTTP annotations in the first audit. Import the current Swagger or `docs/reference/rest-routes.md` before implementation to lock exact paths for pending rotations, last-applied validators, reserved consensus addresses, and reward weights.

### Rewards Snapshots

Use Twilight rewards REST routes for MVP snapshots:

- `/twilight/rewards/v1/params`
- `/twilight/rewards/v1/epoch-info`
- `/twilight/rewards/v1/next-halving`
- `/twilight/rewards/v1/epochs/{epoch_number}`
- `/twilight/rewards/v1/slots/{slot_id}/rewards`
- `/twilight/rewards/v1/slots/{slot_id}/claimable`
- `/twilight/rewards/v1/cumulative-emitted`
- `/twilight/rewards/v1/supply-schedule`
- `/twilight/rewards/v1/current-epoch/active-blocks`
- `/twilight/rewards/v1/module-balances`

### Claims

Use rewards REST `slot-rewards` and `claimable` responses to populate claim records. Use tx/message/event correlation to attach `claimTxHash`, because consensus state intentionally does not store transaction hashes.

### Module Balances

Use rewards REST `module-balances` for `rewards_balance`, `fee_pool_balance`, denom, and periodic snapshots. Also snapshot around epoch finalization events.

## 6. Risks Introduced by the REST/RPC First Transport

| Risk | Mitigation |
|---|---|
| REST JSON can be less type-safe than generated gRPC/proto clients. | Keep raw JSON, add zod/io-ts response validation at `ChainClient` boundaries, and preserve `GrpcChainClient` path. |
| REST route names can drift if annotations change. | Import or vendor Swagger/OpenAPI route inventory before implementation and test representative routes. |
| Gateway may expose paginated fields differently than generated gRPC clients. | Normalize pagination in `packages/chain-client`; write fixture tests. |
| REST may omit details needed for binary/protobuf edge cases. | Store raw tx/event data from RPC and add gRPC clients in hardening. |
| Browser/debug friendliness can tempt direct web-to-chain calls. | Keep chain calls in indexer/API services; web reads explorer API/Postgres-backed data. |
| Snapshot REST reads can race with indexed event height. | Store snapshot height where available and correlate to indexer cursor; favor event height for lifecycle history. |

## 7. Descriptor Decoder and Future gRPC/TS Clients

Add `GrpcChainClient` behind the same `ChainClient` interface when any of these are true:

- The MVP data model and page contracts have stabilized.
- REST response validation becomes brittle or misses typed edge cases.
- Backfill volume needs stricter typed decoding and fewer JSON shape assumptions.
- The explorer needs typed CoreSlot/rewards query clients beyond REST JSON snapshots.
- CI can enforce proto generation from the current chain repo or a pinned proto package.
- The team wants stronger compile-time safety for CoreSlot/rewards query clients.

Current production decoder path:

- Use the copied Twilight `FileDescriptorSet` under `packages/proto`.
- Decode raw CometBFT transaction bytes through descriptor-backed `TxRaw -> TxBody -> Any` decoding in `packages/decoder`.
- Refresh descriptor artifacts from the chain repo export when chain protos change.
- Treat generated TS bindings as an optional explorer-side enhancement, not as an artifact currently provided by the chain repo.
- Keep `RestRpcChainClient` for debug/fallback.
- Keep Swagger as route inventory and integration-test source, not runtime dependency.

Chain-client boundary updates after chain alignment review:

- `getClaimableRewards(slotId, startEpoch, endEpoch)` must always send required `start_epoch` and `end_epoch` query parameters.
- `getSlotRewards(slotId, pagination)` must support route-contract-backed pagination, including `pagination.reverse` for newest-first reads.
- CoreSlot consensus lookups must normalize 40-character CometBFT hex consensus addresses to lowercase and must not forward uppercase, bech32, or invalid values blindly.
- Claim truth comes from claim records: `SlotRewards.claimed` is the reconciled per-record state, `ClaimableRewards` returns only currently unclaimed records for an explicit range, `reward_claimed` events provide transaction history/correlation, and `EpochReward` remains an epoch aggregate snapshot.

## 8. Updated Implementation Recommendation

Proceed with the same clean TypeScript monorepo strategy, but make the chain client abstraction explicit from the start:

- Phase A/B should create `ChainClient`, `RestRpcChainClient`, route-contract tests, and generic CometBFT RPC/Cosmos REST ingestion.
- Phase D/E should consume the same `ChainClient` interface for CoreSlot/rewards snapshots.
- Generated gRPC/TS clients become a later `GrpcChainClient` implementation behind the same interface.
- Swagger/OpenAPI or `docs/reference/rest-routes.md` must be imported or referenced before writing chain-client route constants.

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

Do not change the old build-vs-reuse verdict: clean repo + selective adaptation remains the right path.

## Recommended Next Implementation Prompt

Start with Phase A/B together: scaffold + generic block/tx/event indexer + `ChainClient` plus `RestRpcChainClient`.

Reasoning:

- The improved REST surface removes the biggest Phase D/E blocker, so the earliest implementation should establish the shared `ChainClient` boundary correctly.
- The indexer still needs CometBFT RPC from day one for `/block_results`, so a scaffold-only pass would leave the most important architectural risk untested.
- Include route-contract import/reference as a first task: copy or generate `docs/reference/rest-routes.md` and/or checked-in Swagger JSON before hard-coding Twilight REST routes.
