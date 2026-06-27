# Twilight Core Explorer Data Model

Date: 2026-06-23

> **⚠ Superseded as the live schema reference (2026-06-28).** This is the original pre-implementation
> data-model *draft* (it self-describes as "a model-level draft, not final Prisma syntax"). The schema
> has since been implemented and **diverged substantially**. Source of truth:
> [`../../prisma/schema.prisma`](../../prisma/schema.prisma); status index:
> [`explorer-project-checkpoint.md`](explorer-project-checkpoint.md). Implemented-name map (this draft → real schema):
> - `Transaction` → **`ExplorerTransaction`**
> - `CoreSlot` → **`CoreSlotProjection`**; `CoreSlotEvent` → **`CoreSlotLifecycleEvent`** +
>   `CoreSlotMetadataChange`/`CoreSlotPayoutChange`/`CoreSlotParameterChange`/`CoreSlotConsensusKeyRotation`/`CoreSlotConsensusWindow`
> - `RewardEpoch` → **`RewardEpochProjection`**; `RewardClaim` → **`SlotRewardProjection`** (observed
>   sample) + **`RewardClaimEvent`** (rebuildable); `RewardEvent` → `RewardClaimEvent` +
>   `RewardsParamsChange` + `RewardsTreasuryPayment`
> - `ModuleBalanceSnapshot` + `SupplySnapshot` → **one `RewardsBalanceSample`** (`sampleKind ∈
>   {module_balance, treasury, supply, cumulative_emitted}`); `AccountBalance` → **`AccountBalanceCurrent`**
> - `Block.proposerCoreSlotId` was **not** built — proposer→slot attribution is the separate
>   rebuildable `BlockProposerAttribution` (joined via the temporal map at height N).
> - **Omitted entirely** (built later in Phases 6b/8): `BlockSignature`, `OperatorSigningEvidence`,
>   `BlockProposerAttribution`, `CoreSlotConsensusWindow`, `CoreSlotConsensusKeyRotation`,
>   `CoreSlotLivenessEvidence`/`CoreSlotLivenessSummary`, `CoreSlotHealthSnapshot`,
>   `NetworkLivenessRiskSnapshot`, plus `ProjectionCursor`/`ProjectionFailure`.

## Data Model Verdict

Use a generic block/tx/event foundation plus Twilight-native CoreSlot and rewards models. Avoid staking-centric compatibility tables. Store raw JSON for auditability and forward compatibility, then layer semantic projections for known CoreSlot/rewards events and messages.

No MVP tables for:

- `Delegation`
- `StakingPool`
- `Inflation`
- `Proposal`
- `DistributionReward`

If old schemas include bridge/forks/volt/zkOS tables, mark them legacy/delete.

## Prisma/PostgreSQL Draft

This is a model-level draft, not final Prisma syntax.

### `Block`

Purpose: durable block header and indexing anchor.

Key fields:

- `height BigInt @id`
- `hash String @unique`
- `time DateTime`
- `chainId String`
- `proposerAddress String?`
- `proposerCoreSlotId BigInt?`
- `appHash String?`
- `validatorsHash String?`
- `nextValidatorsHash String?`
- `lastBlockHash String?`
- `txCount Int`
- `rawJson Json`
- `createdAt DateTime`

Indexes:

- `time`
- `proposerAddress`
- `proposerCoreSlotId`
- `chainId, height`

Source:

- REST `/cosmos/base/tendermint/v1beta1/blocks/{height}`
- RPC `/block?height={height}`

Retention/reindex:

- Retain all.
- Reindex by height range; stop on hash mismatch.

### `Transaction`

Purpose: transaction summary and raw result storage.

Key fields:

- `hash String @id`
- `height BigInt`
- `index Int`
- `code Int`
- `codespace String?`
- `status String`
- `gasWanted BigInt`
- `gasUsed BigInt`
- `memo String?`
- `feeJson Json?`
- `signerAddressesJson Json`
- `messageTypesJson Json`
- `rawTx Json?`
- `rawResultJson Json`
- `createdAt DateTime`

Indexes:

- `height, index`
- `status`
- `messageTypesJson` as GIN if using raw JSONB query patterns
- `createdAt`

Source:

- REST `/cosmos/tx/v1beta1/txs?events=tx.height={height}`
- REST `/cosmos/tx/v1beta1/txs/{hash}`
- RPC `/tx?hash=...`

Retention/reindex:

- Retain all.
- Upsert by `hash`.

### `Message`

Purpose: one row per Cosmos SDK message for filtering, display, and decoder state.

Key fields:

- `id BigInt @id`
- `txHash String`
- `height BigInt`
- `msgIndex Int`
- `typeUrl String`
- `module String?`
- `typeName String?`
- `decodedJson Json?`
- `rawJson Json`
- `decodeError String?`
- `createdAt DateTime`

Indexes:

- unique `txHash, msgIndex`
- `height`
- `typeUrl`
- `module`
- `decodeError`

Source:

- Tx body messages.

Retention/reindex:

- Retain all.
- Re-decodable in place when decoder registry improves.

### `Event`

Purpose: all block, begin-block, end-block, and tx events.

Key fields:

- `id BigInt @id`
- `height BigInt`
- `txHash String?`
- `txIndex Int?`
- `msgIndex Int?`
- `eventIndex Int`
- `phase String` (`begin_block`, `tx`, `end_block`, `block`, `unknown`)
- `type String`
- `attributesJson Json`
- `module String?`
- `keyFieldsJson Json?`
- `createdAt DateTime`

Indexes:

- unique `height, phase, txHash, eventIndex` with null-safe strategy
- `height`
- `txHash`
- `type`
- `module`
- GIN on `attributesJson`

Source:

- Tx responses events.
- RPC `/block_results?height={height}`.

Retention/reindex:

- Retain all.
- Rebuild semantic event tables from this source.

### `Account`

Purpose: account discovery and activity summary, not a full auth account mirror.

Key fields:

- `address String @id`
- `firstSeenHeight BigInt?`
- `lastSeenHeight BigInt?`
- `txCount Int`
- `accountKind String?` (`user`, `coreslot_operator`, `payout`, `module`, `unknown`)
- `rawAccountJson Json?`
- `createdAt DateTime`
- `updatedAt DateTime`

Indexes:

- `lastSeenHeight`
- `accountKind`

Source:

- Tx signers.
- Message fields ending in address/operator/signer/payout.
- Event attributes.
- REST `/cosmos/auth/v1beta1/accounts/{address}` if needed.

Retention/reindex:

- Rebuildable from messages/events plus account queries.

### `AccountBalance`

Purpose: current or snapshotted balances by account and denom.

Key fields:

- `id BigInt @id`
- `address String`
- `denom String`
- `amount String`
- `height BigInt`
- `isLatest Boolean`
- `rawJson Json?`
- `updatedAt DateTime`

Indexes:

- unique latest `address, denom` where `isLatest=true`
- `address, denom, height`
- `denom`

Source:

- REST `/cosmos/bank/v1beta1/balances/{address}`
- Optional snapshots after account activity.

Retention/reindex:

- MVP can keep latest only plus sampled snapshots.
- Production can snapshot balances at tx/account views on demand.

### `CoreSlot`

Purpose: current CoreSlot operator/validator ownership state.

Key fields:

- `slotId BigInt @id`
- `status String`
- `operatorAddress String`
- `payoutAddress String`
- `consensusPubkey Json?`
- `consensusAddress String?`
- `consensusPower BigInt?`
- `rewardWeight String?`
- `finalRewardWeight String?`
- `createdHeight BigInt?`
- `activatedHeight BigInt?`
- `updatedHeight BigInt?`
- `suspendedHeight BigInt?`
- `removedHeight BigInt?`
- `metadataJson Json?`
- `rawJson Json`
- `lastObservedHeight BigInt`
- `updatedAt DateTime`

Indexes:

- `status`
- `operatorAddress`
- `payoutAddress`
- `consensusAddress`
- `updatedHeight`

Source:

- Twilight REST `/twilight/coreslot/v1/*` snapshots for MVP.
- CoreSlot gRPC `CoreSlots`, `CoreSlot`, `ActiveCoreSlots`, `RewardWeight` later for generated typed clients.
- Events/messages as incremental updates.

Retention/reindex:

- Current projection can be rebuilt from snapshots and events.
- Keep historical lifecycle in `CoreSlotEvent`.

### `CoreSlotEvent`

Purpose: semantic lifecycle timeline for slots.

Key fields:

- `id BigInt @id`
- `height BigInt`
- `txHash String?`
- `eventIndex Int`
- `slotId BigInt?`
- `eventType String`
- `operatorAddress String?`
- `consensusAddress String?`
- `oldStatus String?`
- `newStatus String?`
- `power BigInt?`
- `reason String?`
- `effectiveHeight BigInt?`
- `attributesJson Json`
- `createdAt DateTime`

Indexes:

- unique `height, txHash, eventIndex`
- `slotId, height`
- `eventType, height`
- `operatorAddress`
- `consensusAddress`

Source:

- CoreSlot events:
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

Retention/reindex:

- Retain all.
- Semantic projection can be rebuilt from base `Event`.

### `RewardEpoch`

Purpose: finalized epoch aggregate plus optional current epoch snapshot.

Key fields:

- `epoch BigInt @id`
- `startHeight BigInt`
- `endHeight BigInt?`
- `emissionAmount String`
- `carryIn String?`
- `distributableFees String?`
- `treasuryAmount String?`
- `rewardPool String?`
- `allocatedAmount String`
- `carryOut String?`
- `rewardAllocationMethod String?`
- `remainderPolicy String?`
- `cumulativeEmittedAfterEpoch String?`
- `eligibleSlots Int?`
- `finalizedHeight BigInt?`
- `rawJson Json`
- `createdAt DateTime`
- `updatedAt DateTime`

Indexes:

- `startHeight`
- `endHeight`
- `finalizedHeight`

Source:

- Rewards event `epoch_finalized`.
- Twilight rewards REST `EpochReward`.
- Twilight rewards REST `EpochInfo` for current epoch summary.
- gRPC later for generated typed clients.

Retention/reindex:

- Retain all finalized epochs.
- Refresh current epoch separately; finalized epochs should be immutable.

### `RewardClaim`

Purpose: claim records per epoch/slot/payout address, with indexer-attached tx hash when claimed.

Key fields:

- `id BigInt @id`
- `epoch BigInt`
- `slotId BigInt`
- `operatorAddress String?`
- `payoutAddress String`
- `amount String`
- `blocksActive BigInt?`
- `rewardWeight String?`
- `effectiveWeight String?`
- `claimed Boolean`
- `claimedHeight BigInt?`
- `claimTxHash String?`
- `rawJson Json`
- `updatedAt DateTime`

Indexes:

- unique `epoch, slotId, payoutAddress`
- `slotId, epoch`
- `payoutAddress`
- `claimed`
- `claimTxHash`

Source:

- Twilight rewards REST `SlotRewards` claim records for authoritative per-epoch/per-slot
  `claimed` and `claimedHeight` state.
- Twilight rewards REST `ClaimableRewards` for explicit unclaimed-only epoch ranges.
- Rewards event `reward_claimed` for tx history and claim hash correlation.
- Tx message `MsgClaimRewards` for `claimTxHash` correlation.
- Twilight rewards REST `EpochReward` only for epoch aggregate/finalization context; it is
  not the source of current per-claim truth.
- gRPC later for generated typed clients.

Retention/reindex:

- Retain all.
- Claims can be refreshed from paginated `SlotRewards`; tx hash correlation comes from indexer events/messages.
- `ClaimableRewards` absence means "not currently claimable in the requested range", not a
  standalone historical claim record.

### `RewardEvent`

Purpose: semantic rewards event stream.

Key fields:

- `id BigInt @id`
- `height BigInt`
- `txHash String?`
- `eventIndex Int`
- `eventType String`
- `epoch BigInt?`
- `slotId BigInt?`
- `signer String?`
- `amount String?`
- `payoutAddress String?`
- `attributesJson Json`
- `createdAt DateTime`

Indexes:

- unique `height, txHash, eventIndex`
- `eventType, height`
- `epoch`
- `slotId`
- `signer`
- `payoutAddress`

Source:

- Rewards events:
  - `epoch_finalized`
  - `reward_claimed`
  - `params_update_queued`
  - `params_activated`
  - `rewards_paused`
  - `rewards_resumed`
  - `treasury_paid`

Retention/reindex:

- Retain all.
- Rebuildable from base `Event`.

### `ModuleBalanceSnapshot`

Purpose: snapshots of rewards module balances and other module accounts.

Key fields:

- `id BigInt @id`
- `height BigInt`
- `moduleName String`
- `address String?`
- `denom String`
- `amount String`
- `balanceKind String?` (`rewards_balance`, `fee_pool_balance`, `bank_module`, etc.)
- `rawJson Json?`
- `createdAt DateTime`

Indexes:

- unique `height, moduleName, balanceKind, denom`
- `moduleName, height`
- `denom`

Source:

- Twilight rewards REST `ModuleBalances`.
- Bank balances for known module addresses if exposed.
- gRPC later for generated typed clients.

Retention/reindex:

- Snapshot every N blocks and at epoch finalization for MVP.
- Production can sample more frequently or store latest plus epoch-boundary snapshots.

### `SupplySnapshot`

Purpose: total supply and cumulative emitted tracking.

Key fields:

- `id BigInt @id`
- `height BigInt`
- `denom String`
- `totalSupply String`
- `cumulativeEmitted String?`
- `maxSupply String?`
- `source String` (`bank_supply`, `rewards_cumulative_emitted`)
- `rawJson Json?`
- `createdAt DateTime`

Indexes:

- unique `height, denom, source`
- `denom, height`

Source:

- REST `/cosmos/bank/v1beta1/supply`
- Twilight rewards REST `CumulativeEmitted`
- gRPC later for generated typed clients.

Retention/reindex:

- Snapshot at indexer startup, every N blocks, and epoch finalization.

### `IndexerCursor`

Purpose: durable sync cursor by chain.

Key fields:

- `chainId String @id`
- `lastIndexedHeight BigInt`
- `lastIndexedHash String?`
- `latestChainHeight BigInt?`
- `status String`
- `updatedAt DateTime`
- `error String?`

Indexes:

- `updatedAt`
- `status`

Source:

- Indexer internal.

Retention/reindex:

- One row per chain.
- Controlled reset/reindex workflow must be explicit.

### `DecodeFailure`

Purpose: operational table for unknown/failed decodes.

Key fields:

- `id BigInt @id`
- `height BigInt`
- `txHash String?`
- `msgIndex Int?`
- `eventIndex Int?`
- `typeUrl String?`
- `eventType String?`
- `failureKind String` (`unknown_message`, `message_decode_error`, `unknown_event_parser`, `raw_tx_decode_error`)
- `rawJson Json?`
- `rawBase64 String?`
- `decodeError String`
- `resolved Boolean`
- `resolvedAt DateTime?`
- `createdAt DateTime`

Indexes:

- `height`
- `txHash`
- `typeUrl`
- `eventType`
- `failureKind`
- `resolved`

Source:

- Decoder registry.
- Event parser.
- Raw tx decoder.

Retention/reindex:

- Retain until resolved and for at least one release after parser fix.
- Re-run decoders against stored raw data to resolve.

## Optional Later Models

| Model | When to add |
|---|---|
| `CoreSlotRewardWeightHistory` | If reward weights become mutable beyond current v1 equal weighting and history needs charting. |
| `ActiveBlockCounterSnapshot` | If current epoch active-block accounting needs trend views beyond gRPC live query. |
| `ApiRequestLog` | If product needs first-party analytics or abuse investigation. |
| `NodeStatusSnapshot` | If network status charts are required. |
| `IndexerJob` | If backfills/reindex jobs become user-visible. |

## Decoder and Raw Data Policy

For known messages:

- Decode semantically into `Message.decodedJson`.
- Update semantic projections only after raw data is stored.
- Do not discard raw JSON.

For unknown messages:

- Do not fail indexing.
- Store `txHash`, `height`, `msgIndex`, `typeUrl`, raw JSON/base64, and `decodeError`.
- Display as unknown message in UI with raw drawer.

For unknown events:

- Do not fail indexing.
- Store event type and attributes in `Event`.
- Add `DecodeFailure` only if the event looked like a known Twilight module event but parser failed.

MVP strategy: hybrid raw JSON + type URL registry plus descriptor-backed raw tx decoding.

Production strategy: keep descriptor-backed decoding from the copied Twilight
`FileDescriptorSet` as the durable raw transaction decoder. Generated TypeScript query clients
may be added later behind `ChainClient` for CoreSlot/rewards snapshots, while preserving raw
storage.

## API Source Mapping

Data models should not depend on transport-specific response shapes directly. The indexer stores:

- raw source payload JSON
- normalized semantic fields

Transport-specific parsing lives in `packages/chain-client` and `packages/decoder`, not in Prisma model definitions. `RestRpcChainClient` is the first transport implementation; `GrpcChainClient` can later normalize generated gRPC/proto responses into the same persistence model.

| Model | CometBFT RPC | Cosmos REST | Twilight REST | Event projection | gRPC later |
|---|---|---|---|---|---|
| `Block` | Primary: `/block`; pair with `/block_results` by height | Optional block endpoint for SDK-shaped JSON | No | No | No |
| `Transaction` | `/tx` for raw lookup/fallback | Primary decoded tx responses by hash or height query where available | No | Tx events attached after ingest | Descriptor-backed raw protobuf decode is available; generated query clients remain optional |
| `Message` | Raw tx bytes can be decoded from RPC fallback through descriptor-backed decoding | Decoded REST tx body messages where available | No | No | Generated query clients later; raw tx decode does not require them |
| `Event` | Primary for `/block_results` begin/end/block events | Tx response events | No | Base source for semantic event projections | No |
| `Account` | No direct primary source | Cosmos auth REST if enabled; otherwise discovery from tx data | No | Signers/message/event address extraction | No |
| `AccountBalance` | No | Cosmos bank REST balances | No | Optional balance refresh after account activity | No |
| `CoreSlot` | No | No | First source via `RestRpcChainClient` snapshots from `/twilight/coreslot/v1/*` | Lifecycle events update/history | `GrpcChainClient` normalizing into the same persistence model |
| `CoreSlotEvent` | Base events from `/block_results` | Tx response events where lifecycle tx emits events | Snapshot context only | Primary source | No |
| `RewardEpoch` | No direct primary source | No | First source via `RestRpcChainClient` snapshots from rewards epoch/current routes | `epoch_finalized` drives refresh and history | `GrpcChainClient` normalizing into the same persistence model |
| `RewardClaim` | No direct primary source | No | First source via `RestRpcChainClient`: paginated `SlotRewards` for claim records and range-explicit `ClaimableRewards` for unclaimed-only checks | `reward_claimed` plus tx/message correlation for `claimTxHash` | `GrpcChainClient` normalizing into the same persistence model |
| `RewardEvent` | Base events from `/block_results` | Tx response events for claim/params/pause/resume txs | Snapshot context only | Primary source | No |
| `ModuleBalanceSnapshot` | No | Bank balances for known module accounts if needed | First source via `RestRpcChainClient` from rewards module-balances | Snapshot on epoch finalization events | `GrpcChainClient` later |
| `SupplySnapshot` | No | Primary total supply from bank REST | Rewards cumulative emitted/supply schedule context | Snapshot on epoch finalization events | Generated rewards query client later |
| `IndexerCursor` | Latest chain height/hash cross-checks | Latest block cross-checks | No | No | No |
| `DecodeFailure` | Raw tx decode failures | REST message shape failures | Twilight REST response validation failures | Event parser failures | Generated decoder failures later |

Policy notes:

- `Block`: filled by CometBFT RPC `/block`, with optional REST block endpoint enrichment.
- `Event`: filled by CometBFT RPC `/block_results` and tx responses.
- `CoreSlot`: first filled by `RestRpcChainClient` via Twilight REST `/twilight/coreslot/v1/*` for current snapshots, CoreSlot events for lifecycle history, and `GrpcChainClient` later. Both transports must normalize into the same persistence model.
- `RewardEpoch`: first filled by `RestRpcChainClient` via Twilight rewards REST for finalized/current epoch snapshots and rewards events for history/correlation. `GrpcChainClient` must normalize into the same model later.
- `RewardClaim`: first filled by `RestRpcChainClient` via Twilight rewards REST for claim records and tx/message/event correlation for `claimTxHash`. `GrpcChainClient` must normalize into the same model later.
- Do not add staking, governance, mint module, or distribution models.

## Legacy Schema Deletions From Reference

Delete or do not recreate:

- `BtcDeposit`
- `BtcDepositAddress`
- `BtcWithdrawal`
- `Reserve`
- `SweepProposal`
- `SweepSignature`
- `RefundSignature`
- `DelegateKey`
- `BtcChainTip`
- `Fragment`
- `FragmentSigner`
- `ClearingAccount`
- `ZkosTransfer`
- `ZkosMintBurn`

The old generic `Block`, `Transaction`, `Event`, `Account`, and `IndexerState` models are useful references, but the new versions should be rewritten with CoreSlot/rewards fields and raw JSON retention.
