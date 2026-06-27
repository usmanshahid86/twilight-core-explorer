# Twilight Core Explorer Architecture Proposal

Date: 2026-06-23

> **⚠ Superseded as a build plan (2026-06-28).** This is the original architecture *proposal* (future
> tense). The proposed system is now **fully built and live-proven through Phase 12** — for current
> truth see [`explorer-project-checkpoint.md`](explorer-project-checkpoint.md) (status index),
> [`../../prisma/schema.prisma`](../../prisma/schema.prisma) (data model), and
> [`../reference/openapi.json`](../reference/openapi.json) (the API contract, 32 paths). The sections
> below are retained for design rationale. Known drift to read past:
> - **No `packages/ui`** — proposed, never built. Packages are `chain-client`, `config`, `db`,
>   `decoder`, `proto`; the web app is `apps/web` (Next.js 14 app-router) with inline components.
> - **Model names changed.** There is no `CoreSlot`/`CoreSlotEvent`/`RewardEpoch`/`RewardClaim`/
>   `RewardEvent`/`SupplySnapshot`/`ModuleBalanceSnapshot`. Actual: `CoreSlotProjection` +
>   `CoreSlotLifecycleEvent`/`CoreSlot*Change`, `RewardEpochProjection`, `RewardClaimEvent`,
>   `RewardsBalanceSample` (supply reuses `sampleKind="supply"`), `AccountBalanceCurrent`.
> - **Semantic projections are separate rebuildable projector quartets** (each with its own
>   `ProjectionCursor`/`ProjectionFailure`), not the inline indexer steps sketched in §Indexer Worker.
> - **API is versioned `/api/v1/*`** with `{data}` / `{data,page}` / `{error}` envelopes — not the
>   `/api/...` paths or `data`/`pagination`/`meta` envelope sketched in §API Design.

## Architecture Verdict

Build a Twilight-native TypeScript monorepo with a clean schema and selected reuse from the reference TypeScript explorer/indexer. Do not fork the old product wholesale. Do not design around standard staking validators. The explorer must model CoreSlot PoA, `x/rewards`, and `utwlt`.

Recommended repository shape:

```text
twilight-core-explorer/
  apps/
    web/
    api/
    indexer/
  packages/
    db/
    config/
    chain-client/
    decoder/
    proto/
    ui/
  prisma/
    schema.prisma
    migrations/
  docker-compose.yml
  docs/
    research/
```

## Preferred Stack

| Layer | Recommendation | Reason |
|---|---|---|
| Language | TypeScript | Shared types across web/API/indexer; aligns with reusable reference code. |
| Frontend | Next.js app router | Existing reference theme and data UI already fit. |
| API | Fastify or Express | Express is present in the reference and acceptable; Fastify is slightly better for typed schemas and performance. Use one consistently. |
| Database | PostgreSQL | Required for durable block/tx/event indexing and search. |
| ORM | Prisma | Already present in reference, fast iteration, readable schema. |
| Cache/pubsub | Redis optional | Defer for MVP unless live WebSocket updates or cross-instance cache invalidation are required immediately. |
| Local dev | Docker Compose | Postgres plus optional Redis; no chain/devnet modification. |
| Deployment | Separate web, API, indexer, Postgres, optional Redis | Clear scaling and failure boundaries. |

Redis recommendation: defer for MVP. Use Postgres indexes and short API cache headers first. Add Redis in hardening for rate limiting, hot dashboard cache, WebSocket pub/sub, and multi-instance API cache invalidation.

## Updated API Surface Assumptions

The base chain API surface has changed since the initial research pass:

- `x/rewards` REST gateway is now available.
- `x/coreslot` REST gateway is now available.
- Swagger/OpenAPI provides route inventory for enabled REST routes.
- The explorer should use a production-shaped `ChainClient` boundary from day one, with REST/RPC as the first transport implementation.
- The production indexer should preserve a path to generated gRPC clients for stronger typing behind the same `ChainClient` interface.
- CometBFT RPC remains mandatory for `/block_results` and consensus/block history.
- Standard staking, governance, mint module, and distribution surfaces remain intentionally unsupported and must not be used.

The correct integration split is:

- CometBFT RPC for block history, raw tx lookup, `/block_results`, consensus, and node status.
- Cosmos/Twilight REST for generic reads and CoreSlot/rewards module snapshots in the first `ChainClient` transport.
- gRPC as the canonical typed module API for a later generated TypeScript `ChainClient` transport.
- Swagger/OpenAPI as route inventory and integration-test contract, not a runtime dependency.

## Data Flow

```text
CometBFT RPC + Cosmos/Twilight REST
    ↓
Indexer
    ↓
PostgreSQL
    ↓
API
    ↓
Next.js explorer
```

Future typed backend path:

```text
gRPC
  canonical typed module API
  use later for generated TS clients or if REST becomes insufficient
```

Expanded:

```text
CometBFT RPC:
  /status
  /block
  /block_results
  /blockchain
  /tx

Cosmos REST:
  /cosmos/base/tendermint/v1beta1/blocks/latest
  /cosmos/base/tendermint/v1beta1/blocks/{height}
  /cosmos/base/tendermint/v1beta1/node_info
  /cosmos/base/node/v1beta1/config
  /cosmos/bank/v1beta1/supply
  /cosmos/bank/v1beta1/balances/{address}
  /cosmos/tx/v1beta1/txs/{hash}

Twilight REST:
  /twilight/coreslot/v1/*
  /twilight/rewards/v1/*

Twilight gRPC:
  twilight.coreslot.v1.Query
  twilight.rewards.v1.Query
```

## Chain Client Abstraction

The indexer and semantic processors depend on `ChainClient`, not on raw REST paths scattered through the codebase. The first implementation is REST/RPC-backed, but the architecture is production-shaped from day one: a later generated gRPC/proto transport must satisfy the same interface.

Draft TypeScript boundary:

```ts
export interface ChainClient {
  getStatus(): Promise<ChainStatus>;
  getBlock(height: bigint): Promise<BlockSource>;
  getBlockResults(height: bigint): Promise<BlockResultsSource>;
  getTx(hash: string): Promise<TxSource>;
  getTxsByHeight(height: bigint): Promise<TxSource[]>;
  getSupply(): Promise<SupplySource>;
  getBalances(address: string): Promise<BalanceSource>;

  getCoreSlotParams(): Promise<CoreSlotParamsSource>;
  getCoreSlots(): Promise<CoreSlotSnapshotSource>;
  getActiveCoreSlots(): Promise<CoreSlotSnapshotSource>;
  getCoreSlot(slotId: bigint): Promise<CoreSlotSource>;
  getCoreSlotByOperator(operatorAddress: string): Promise<CoreSlotSource>;
  getCoreSlotByConsensusAddress(consensusAddress: string): Promise<CoreSlotSource>;
  getPendingKeyRotations(): Promise<PendingKeyRotationsSource>;
  getLastAppliedValidators(): Promise<LastAppliedValidatorsSource>;
  getReservedConsensusAddress(consensusAddress: string): Promise<ReservedConsensusAddressSource>;
  getRewardWeight(slotId: bigint): Promise<RewardWeightSource>;

  getRewardsParams(): Promise<RewardsParamsSource>;
  getEpochInfo(): Promise<EpochInfoSource>;
  getNextHalving(): Promise<NextHalvingSource>;
  getEpochReward(epoch: bigint): Promise<EpochRewardSource>;
  getSlotRewards(slotId: bigint, pagination?: PaginationRequest): Promise<SlotRewardsSource>;
  getClaimableRewards(slotId: bigint, startEpoch: bigint, endEpoch: bigint): Promise<ClaimableRewardsSource>;
  getCumulativeEmitted(): Promise<CumulativeEmittedSource>;
  getSupplySchedule(): Promise<SupplyScheduleSource>;
  getCurrentEpochActiveBlocks(): Promise<CurrentEpochActiveBlocksSource>;
  getModuleBalances(): Promise<ModuleBalancesSource>;
}
```

Implementations:

| Implementation | Timing | Transport | Notes |
|---|---|---|---|
| `RestRpcChainClient` | First implementation | CometBFT RPC + Cosmos REST + Twilight REST | Uses route constants generated/imported from the Swagger or `rest-routes` contract where practical. This is not a throwaway MVP shortcut; it is the first production-shaped transport behind `ChainClient`. |
| `GrpcChainClient` | Later hardening | CometBFT RPC + generated TypeScript gRPC/proto clients for Twilight modules | Must satisfy the same `ChainClient` interface. Useful for stronger typing, protobuf `Any` support, and REST/gRPC output comparison tests. |

Rules:

- REST paths must live inside `packages/chain-client`, not inside indexer processors or web/API pages.
- Processors receive normalized source objects from `ChainClient`.
- Raw payloads are preserved for audit/debug.
- BigInt values and token amounts are normalized as strings at the boundary.
- `ChainClient` must never call staking, governance, mint module, or distribution routes.
- CoreSlot consensus-address lookup methods must not forward user input blindly. The first
  transport accepts 40-character CometBFT hex consensus addresses, lowercases them before
  building routes, and rejects bech32 `twilightvalcons...` values until explicit conversion is
  added.
- Rewards claimability must be range-explicit: `ClaimableRewards` requires `start_epoch` and
  `end_epoch`; callers derive the range in the rewards service/projection layer, not inside the
  low-level transport.
- `SlotRewards` must be pagination-aware. Use route-contract-backed pagination parameters,
  including `pagination.reverse` for newest-first reads where the gateway supports it.

## Endpoint Discovery Findings

Initial live devnet probes on 2026-06-23 found generic REST/RPC working while module REST and Swagger were not yet served. The chain API has since been improved and validated.

Current verified surface:

| Endpoint family | Status | Design implication |
|---|---|---|
| CometBFT RPC `/status` | Works | Use for chain status, node status, latest height, sync state. |
| CometBFT RPC `/block_results` | Works and required | Mandatory for begin/end/block events and lifecycle history. |
| Generic Cosmos REST block/node/bank/tx | Works | Use for generic REST reads, supply, balances, and decoded tx responses. |
| Twilight CoreSlot REST routes | Works | Use via `RestRpcChainClient` for current CoreSlot snapshots. |
| Twilight rewards REST routes | Works | Use via `RestRpcChainClient` for current/finalized rewards snapshots. |
| Swagger/OpenAPI REST discovery | Works | Use as route inventory and integration-test contract. |
| Standard staking/governance/mint module/distribution REST | Unsupported by design | Treat as intentionally unsupported. Never depend on these. |

## Core Domain Model

The explorer domain should be:

- Blocks and transactions as generic chain data.
- Accounts and `utwlt` balances as bank data.
- CoreSlot slots/operators as the validator ownership surface.
- Rewards epochs/claims/module balances as the economic surface.
- Generic events as the integration layer.
- Decode failures as first-class operational data.

It should not include:

- `Delegation`
- `StakingPool`
- `Inflation`
- `Proposal`
- `DistributionReward`
- synthetic staking validators
- fake governance compatibility

## Indexer Worker

Responsibilities:

1. Poll latest height from REST or RPC.
2. Process block heights sequentially from `IndexerCursor.lastIndexedHeight + 1`.
3. Fetch block header and tx list.
4. Fetch tx responses by height when available, or decode raw txs via `/tx` if needed.
5. Fetch `/block_results?height=N` from CometBFT RPC to capture begin/end/block events, including CoreSlot and rewards events.
6. Decode messages using a Twilight type URL registry.
7. Store raw block, tx, message, result, and event JSON before semantic processing.
8. Extract generic accounts from signer/message/event address fields.
9. Process CoreSlot semantic events/messages into `CoreSlot` and `CoreSlotEvent`.
10. Process rewards semantic events/messages into `RewardEpoch`, `RewardClaim`, `RewardEvent`, `ModuleBalanceSnapshot`, and `SupplySnapshot`.
11. Track cursor only after all writes for a height commit.
12. Retry transient failures safely without duplicating rows.
13. Record unknown messages and decode failures without stopping indexing.

### Indexer Safety

| Concern | Strategy |
|---|---|
| Duplicate processing | Use unique keys: block height, tx hash, message `(txHash,msgIndex)`, event natural keys. Upsert idempotently. |
| Cursor correctness | Update `IndexerCursor` in the same DB transaction as height writes. |
| Reorgs | Core devnet likely finalizes quickly, but still compare block hash/last block hash. On mismatch, stop and require controlled rollback/reindex workflow. |
| Empty blocks | Store blocks even with zero txs; CoreSlot/rewards EndBlock events can still matter. |
| Unknown messages | Store raw message and `decodeError`; do not fail block. |
| Unknown events | Store raw event type and attributes; do not fail block. |
| Chain route gaps | Prefer RPC block/block_results plus generic REST for base data; use Twilight REST through `RestRpcChainClient` for module snapshots and preserve `GrpcChainClient` as the later typed transport. |
| Multiple indexers | Use Postgres advisory lock for single active writer. |

## Decoder Strategy

Known Twilight message type URLs from local proto:

### CoreSlot

- `/twilight.coreslot.v1.MsgRegisterCoreSlot`
- `/twilight.coreslot.v1.MsgActivateCoreSlot`
- `/twilight.coreslot.v1.MsgInactivateCoreSlot`
- `/twilight.coreslot.v1.MsgSuspendCoreSlot`
- `/twilight.coreslot.v1.MsgRemoveCoreSlot`
- `/twilight.coreslot.v1.MsgRotateConsensusKey`
- `/twilight.coreslot.v1.MsgUpdatePayoutAddress`
- `/twilight.coreslot.v1.MsgUpdateOperatorMetadata`
- `/twilight.coreslot.v1.MsgUpdateParams`

### Rewards

- `/twilight.rewards.v1.MsgClaimRewards`
- `/twilight.rewards.v1.MsgUpdateRewardsParams`
- `/twilight.rewards.v1.MsgPauseRewards`
- `/twilight.rewards.v1.MsgResumeRewards`

### MVP Decoder Recommendation

Use a hybrid raw JSON + type URL registry:

- Store raw tx/message/event JSON first.
- Decode known CoreSlot/rewards JSON fields from REST tx responses when present.
- Derive semantic state from events plus periodic `ChainClient` snapshots.
- Keep a registry that maps type URL to module, display name, signer fields, and semantic parser.
- On missing/unknown decode, populate `DecodeFailure`.

This now works with module REST query routes wired for CoreSlot/rewards snapshots through `RestRpcChainClient` and descriptor-backed raw tx decoding from the copied Twilight descriptor set. The same registry should remain compatible with generated gRPC/protobuf query clients later through `GrpcChainClient`.

### Production Decoder Recommendation

Use the descriptor-backed decoder foundation as the production decoder path for raw
`TxRaw -> TxBody -> Any` message decoding:

- Keep the copied `twilight-descriptors.pb` and message type URL manifest under `packages/proto`.
- Refresh descriptor artifacts from the chain repo export command when the chain proto surface changes.
- Decode raw tx bytes and `Any` messages reliably through `packages/decoder`.
- Keep raw JSON storage even after typed decode.
- Optionally add generated TypeScript bindings later inside the explorer repo if they are driven from the pinned descriptor/proto artifacts.
- Use generated gRPC clients for CoreSlot/rewards query snapshots when stronger typing or REST limitations justify the migration; they remain a transport implementation behind `ChainClient`, not a replacement architecture.

## CoreSlot Integration

Data sources:

- Messages: CoreSlot Msg types above.
- Events from `x/coreslot/types/events.go`:
  - `coreslot_registered`
  - `coreslot_activated`
  - `coreslot_inactivated`
  - `coreslot_suspended`
  - `coreslot_removed`
  - `coreslot_key_rotation_requested`
  - `coreslot_key_rotated`
  - `coreslot_payout_updated`
  - `coreslot_metadata_updated`
  - `coreslot_params_updated`
  - `coreslot_validator_update_emitted`
  - `coreslot_rotation_cancelled`
- gRPC queries:
  - `Params`
  - `CoreSlot`
  - `CoreSlots`
  - `ActiveCoreSlots`
  - `CoreSlotByOperator`
  - `CoreSlotByConsensusAddress`
  - `PendingKeyRotations`
  - `LastAppliedValidators`
  - `ReservedConsensusAddress`
  - `RewardWeight`

- REST gateway snapshots:
  - `/twilight/coreslot/v1/params`
  - `/twilight/coreslot/v1/slots`
  - `/twilight/coreslot/v1/slots/{slot_id}`
  - `/twilight/coreslot/v1/active-slots`
  - `/twilight/coreslot/v1/operators/{operator_address}`
  - `/twilight/coreslot/v1/consensus/{consensus_address}`
  - remaining CoreSlot query routes from Swagger/OpenAPI route inventory

Active slots route must come from the current route contract. The validated chain route is `/twilight/coreslot/v1/active-slots`; do not use the legacy nested active-slots variant that collides with the slot-id route.

CoreSlot REST gateway routes are now served and should be used through `RestRpcChainClient` for first transport snapshots. Keep gRPC as the canonical typed source for generated clients later.

Important semantics:

- CoreSlot owns validator admission and validator updates.
- Active slots, not staking validators, are the explorer's operator set.
- `CoreSlot.ConsensusPower` is consensus only.
- `OperatorRewardWeight.FinalWeight` is rewards only.
- Suspended/removed slots retain slot rows and can still have historical rewards.

## Rewards Integration

Data sources:

- Messages:
  - `MsgClaimRewards`
  - `MsgUpdateRewardsParams`
  - `MsgPauseRewards`
  - `MsgResumeRewards`
- Events from `x/rewards/types/events.go`:
  - `epoch_finalized`
  - `reward_claimed`
  - `params_update_queued`
  - `params_activated`
  - `rewards_paused`
  - `rewards_resumed`
  - `treasury_paid`
- gRPC queries:
  - `Params`
  - `EpochInfo`
  - `NextHalving`
  - `EpochReward`
  - `SlotRewards`
  - `ClaimableRewards`
  - `CumulativeEmitted`
  - `SupplySchedule`
  - `CurrentEpochActiveBlocks`
  - `ModuleBalances`
- REST gateway snapshots:
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

Important semantics:

- Amounts are integer `utwlt`.
- Display conversion is `TWLT = utwlt / 1_000_000`.
- `reward_claimed` does not store tx hash in consensus state; the indexer should attach `claimTxHash` by correlating tx events/messages.
- `epoch_finalized` is the authoritative signal to fetch/store epoch details.
- Rewards can be paused/resumed independently for emissions, settlement, and claims.

## API Design

Base endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /health/live` | Process liveness. |
| `GET /health/ready` | DB reachable, indexer cursor known, lag under configured threshold. |
| `GET /api/status` | API version, chain id, latest indexed height, latest chain height, lag, route support. |
| `GET /api/search?q=` | Search by height, tx hash, account, slot id, operator address, consensus address. |
| `GET /api/blocks` | Paginated blocks. |
| `GET /api/blocks/:height` | Block detail with txs/events. |
| `GET /api/txs` | Paginated txs with filters. |
| `GET /api/txs/:hash` | Tx detail with messages/events/decode info. |
| `GET /api/accounts/:address` | Account, balances, txs, CoreSlot/rewards relationships. |
| `GET /api/coreslot/slots` | Slot list with status filters. |
| `GET /api/coreslot/slots/:slotId` | Slot detail and lifecycle events. |
| `GET /api/coreslot/events` | CoreSlot event stream. |
| `GET /api/rewards/epoch-info` | Current epoch snapshot. |
| `GET /api/rewards/epochs` | Finalized epoch list. |
| `GET /api/rewards/epochs/:epoch` | Epoch aggregate and per-slot rewards. |
| `GET /api/rewards/claims` | Claim records by slot/address/claimed state. |
| `GET /api/rewards/module-balances` | Rewards module balances snapshots/current. |
| `GET /api/supply` | Total supply and cumulative emitted. |
| `GET /api/decode-failures` | Operational decode failure list. |

API rules:

- Cursor pagination for deep lists; page pagination acceptable for MVP tables.
- No endpoint should call standard staking/mint/gov/distribution.
- BigInt amounts must serialize as strings.
- Expose raw JSON under explicit debug/raw fields, not as primary UX.
- Use stable response envelopes with `data`, `pagination`, and `meta`.

## Web Design

Pages:

- Dashboard
- Blocks
- Block detail
- Transactions
- Transaction detail
- Accounts
- CoreSlot slot list
- CoreSlot detail
- Rewards overview
- Finalized epochs
- Reward claims
- Supply
- Network
- API status/decode failures

Dashboard MVP cards:

- Latest indexed height
- Chain latest height / indexer lag
- Latest block time
- Total transactions
- Active CoreSlots
- Current rewards epoch
- Cumulative emitted
- Total `utwlt` supply
- Rewards module balance
- Node status

## Deployment Topology

```text
                 ┌──────────────┐
                 │  nginx/TLS   │  later
                 └──────┬───────┘
                        │
        ┌───────────────┴───────────────┐
        │                               │
   ┌────▼────┐                     ┌────▼────┐
   │   web   │                     │   api   │
   │ Next.js │                     │ Fastify │
   └─────────┘                     └────┬────┘
                                        │
                                  ┌─────▼─────┐
                                  │ Postgres  │
                                  └─────▲─────┘
                                        │
                                  ┌─────┴─────┐
                                  │ indexer   │
                                  └─────┬─────┘
                                        │
          ┌─────────────────────────────┼────────────────────────────┐
          │                             │                            │
    CometBFT RPC                  Twilight REST                Twilight gRPC later

Optional:
  Redis for cache/pubsub/rate-limit state
```

MVP deployment:

- Postgres
- indexer
- API
- web

Later:

- Redis
- nginx/TLS
- DB backups
- read replica if needed
- observability stack

## Why Not Ping.pub Compatibility

Ping.pub expects standard Cosmos staking/mint/gov/distribution surfaces. Twilight Core intentionally does not expose those modules. Adding fake compatibility tables or routes would misrepresent the chain. If ecosystem compatibility is ever required, it must be a clearly labeled read-only projection derived from CoreSlot, not active staking compatibility.
