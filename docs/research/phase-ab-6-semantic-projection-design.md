# Twilight Core Explorer Phase A/B-6 Semantic Projection Design

## 1. Summary

Phase A/B-6 is an exploration/design pass for CoreSlot and rewards semantic projections.

The key rule is:

```text
Generic ingestion is canonical.
Semantic projections are derived views.
```

The semantic layer must be rebuildable from:

- `Block`
- `ExplorerTransaction`
- `Message`
- `Event`
- `Account`
- `DecodeFailure`

No schema migration, projection worker, API route, web page, generated gRPC client, or chain change is part of this pass.

Recommendation: implement a small CoreSlot semantic audit slice first, driven by decoded `Message` rows plus matching `Event` rows. Defer current-state `CoreSlotProjection` maintenance until event/message correlation is proven across all CoreSlot event types.

## 2. Current Generic Indexer Foundation

Current canonical tables:

| Table | Canonical content |
|---|---|
| `Block` | Height, hash, time, proposer address, app/validator hashes, tx count, raw CometBFT block JSON. |
| `ExplorerTransaction` | Tx hash, height/index, code/status, gas, message type URLs, raw tx/result JSON. |
| `Message` | One row per decoded tx body message, keyed by `txHash,msgIndex`; includes type URL, module, type name, decoded JSON, raw value metadata, and decode error. |
| `Event` | Tx events and begin/end block events, keyed by deterministic `eventKey`; includes phase, type, attributes JSON, module inference, and extracted key fields. |
| `Account` | Conservative discovered addresses. |
| `DecodeFailure` | Non-halting raw tx/body/auth/Any decode failures. |
| `IndexerCursor` | Generic ingestion cursor and halt status. |

Important implementation facts:

- `ingestHeight()` always fetches `getBlock`, `getBlockResults`, and `getTxsByHeight`.
- `/block_results?height=N` remains mandatory for begin/end block events.
- REST tx decode failures fall back to CometBFT `/block` raw txs plus `/tx`.
- A/B-5 decodes fallback raw tx bytes into `Message` rows through descriptor-backed `TxRaw -> TxBody -> Any` decoding.
- Generic rows are upserted idempotently except `DecodeFailure`, which is currently append-only.
- Hash mismatch halts generic ingestion before semantic projection should run for that height.

Semantic projections must never mutate generic rows.

## 3. Actual Indexed Row Examples

Local smoke database was available at:

```text
postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public
```

Counts:

```json
{
  "Block": 3,
  "ExplorerTransaction": 1,
  "Message": 1,
  "Event": 5,
  "Account": 1,
  "IndexerCursor": 1,
  "DecodeFailure": 0
}
```

Representative `Block` rows:

| Height | Hash | Tx count | Proposer |
|---:|---|---:|---|
| 119 | `1840C0893690066CDB23AD10989DFFA4D2F1FF5366681EF5FE3451ABF2335F20` | 0 | `F060BF2347C76488A0390285E3B9EF3A44EC7D23` |
| 120 | `3A4406EB807E58A1AE35246ECFE6935B09E6427055247E9FFD1F7A15AB8CBA69` | 1 | `F355E56B8F475280E5FC84E71AC57CB018FA8411` |
| 121 | `8397081B767356C3557C5DDAB99309B21DA869688C3066EE30B2535997A41F78` | 0 | `A071AC8728912DAB4405B9E7E106294CB27F0B15` |

Representative `ExplorerTransaction`:

```json
{
  "hash": "2BF1A0557CBBA9FAB26671E471BDEC36A24A823032FFC91AF529092655E78A81",
  "height": "120",
  "index": 0,
  "code": 0,
  "status": "success",
  "gasWanted": "200000",
  "gasUsed": "53015",
  "messageTypesJson": [
    "/twilight.coreslot.v1.MsgUpdateOperatorMetadata"
  ],
  "rawResultJsonContains": [
    "raw_tx_base64",
    "rpc.result.tx_result.events",
    "events"
  ]
}
```

Representative `Message`:

```json
{
  "txHash": "2BF1A0557CBBA9FAB26671E471BDEC36A24A823032FFC91AF529092655E78A81",
  "height": "120",
  "msgIndex": 0,
  "typeUrl": "/twilight.coreslot.v1.MsgUpdateOperatorMetadata",
  "module": "coreslot",
  "typeName": "MsgUpdateOperatorMetadata",
  "decodedJson": {
    "slot_id": "1",
    "operator": "twilight17n30thc6ntha6rpjvk46yrwvkd86guy9crevra",
    "metadata": {
      "moniker": "explorer-smoke-1782273257"
    }
  },
  "rawJson": {
    "typeUrl": "/twilight.coreslot.v1.MsgUpdateOperatorMetadata",
    "lookupName": "twilight.coreslot.v1.MsgUpdateOperatorMetadata",
    "rawValueBase64": "Ci90d2lsaWdodDE3bjMwdGhjNm50aGE2cnBqdms0Nnlyd3ZrZDg2Z3V5OWNyZXZyYRABGhsKGWV4cGxvcmVyLXNtb2tlLTE3ODIyNzMyNTc="
  },
  "decodeError": null
}
```

Actual `Event` rows for the transaction:

| Event type | Module | Attributes |
|---|---|---|
| `tx` | `tx` | `fee`, `fee_payer` |
| `tx` | `tx` | `acc_seq` |
| `tx` | `tx` | `signature` |
| `message` | `tx` | `action=/twilight.coreslot.v1.MsgUpdateOperatorMetadata`, `sender`, `module=coreslot`, `msg_index=0` |
| `coreslot_metadata_updated` | `coreslot` | `slot_id=1`, `operator_address`, `msg_index=0` |

Actual account row:

```json
{
  "address": "twilight17n30thc6ntha6rpjvk46yrwvkd86guy9crevra",
  "firstSeenHeight": "120",
  "lastSeenHeight": "120",
  "txCount": 1,
  "accountKind": "unknown"
}
```

Current cursor:

```json
{
  "chainId": "twilight-localnet-1",
  "lastIndexedHeight": "121",
  "lastIndexedHash": "8397081B767356C3557C5DDAB99309B21DA869688C3066EE30B2535997A41F78",
  "latestChainHeight": "3145",
  "status": "idle",
  "error": null
}
```

`DecodeFailure` is empty for this smoke range.

## 4. CoreSlot Message Surface

Source inspected:

- `/Users/quasar/Github/nyks-core/proto/twilight/coreslot/v1/tx.proto`
- `/Users/quasar/Github/nyks-core/x/coreslot/keeper/msg_server.go`
- `/Users/quasar/Github/nyks-core/x/coreslot/types/events.go`

Messages:

| Type URL | Key decoded fields | Intent |
|---|---|---|
| `/twilight.coreslot.v1.MsgRegisterCoreSlot` | `authority`, `operator_address`, `consensus_pubkey`, `payout_address`, `metadata` | Register a pending slot. |
| `/twilight.coreslot.v1.MsgActivateCoreSlot` | `authority`, `slot_id` | Activate pending/inactive/suspended slot. |
| `/twilight.coreslot.v1.MsgInactivateCoreSlot` | `authority_or_operator`, `slot_id`, `reason` | Inactivate active slot. |
| `/twilight.coreslot.v1.MsgSuspendCoreSlot` | `authority`, `slot_id`, `reason`, `evidence_reference` | Suspend a slot. |
| `/twilight.coreslot.v1.MsgRemoveCoreSlot` | `authority`, `slot_id`, `reason` | Remove a non-active slot. |
| `/twilight.coreslot.v1.MsgRotateConsensusKey` | `authority`, `slot_id`, `new_consensus_pubkey` | Queue or immediately apply consensus key rotation depending on slot status. |
| `/twilight.coreslot.v1.MsgUpdatePayoutAddress` | `operator`, `slot_id`, `new_payout_address` | Update payout address. |
| `/twilight.coreslot.v1.MsgUpdateOperatorMetadata` | `operator`, `slot_id`, `metadata` | Update operator metadata. |
| `/twilight.coreslot.v1.MsgUpdateParams` | `authority`, `params` | Update CoreSlot params. |

Projection note: message rows capture intent and rich payloads such as metadata and new payout address. Some event rows capture the confirmed effect but omit the full new value, so projections need both messages and events.

## 5. CoreSlot Event Surface

Source inspected:

- `/Users/quasar/Github/nyks-core/x/coreslot/types/events.go`
- `/Users/quasar/Github/nyks-core/x/coreslot/keeper/events.go`
- `/Users/quasar/Github/nyks-core/x/coreslot/keeper/msg_server.go`
- `/Users/quasar/Github/nyks-core/x/coreslot/keeper/endblock.go`

CoreSlot event types and attributes:

| Event type | Attributes | Notes |
|---|---|---|
| `coreslot_registered` | `slot_id`, `operator_address`, `consensus_address`, `new_status=PENDING` | Emitted by register tx. |
| `coreslot_activated` | `slot_id`, `operator_address`, `old_status`, `new_status=ACTIVE`, `consensus_address`, `power` | Emitted by activate tx. |
| `coreslot_inactivated` | `slot_id`, `operator_address`, `consensus_address`, `old_status`, `new_status=INACTIVE`, `power=0`, `reason` | Emitted by inactivate tx. Can be preceded by rotation cancellation. |
| `coreslot_suspended` | `slot_id`, `operator_address`, `consensus_address`, `old_status`, `new_status=SUSPENDED`, `power=0`, `reason` | Emitted by suspend tx. Can be preceded by rotation cancellation. |
| `coreslot_removed` | `slot_id`, `operator_address`, `old_status`, `new_status=REMOVED`, `consensus_address`, `reason` | Emitted by remove tx. |
| `coreslot_key_rotation_requested` | `slot_id`, `operator_address`, `old_consensus_address`, `new_consensus_address`, `effective_height` | Active-slot rotations are delayed. |
| `coreslot_key_rotated` | `slot_id`, `operator_address`, `old_consensus_address`, `new_consensus_address`, `power`, `effective_height` | Non-active rotations happen immediately; active rotations emit in EndBlock at effective height. |
| `coreslot_payout_updated` | `slot_id`, `operator_address` | Event omits new payout address, so use message payload. |
| `coreslot_metadata_updated` | `slot_id`, `operator_address` | Event omits metadata, so use message payload. Smoke DB confirms this shape. |
| `coreslot_params_updated` | `authority` | Event omits params, so use message payload. |
| `coreslot_validator_update_emitted` | `slot_id`, `operator_address`, `consensus_address`, `power`, `height` | Emitted in EndBlock by validator-set diff persistence. |
| `coreslot_rotation_cancelled` | `slot_id`, `operator_address`, `old_consensus_address`, `new_consensus_address`, `reason`, `height` | Reasons currently include `lifecycle_change` and `stale_rotation`. |

Observed event example from DB:

```json
{
  "type": "coreslot_metadata_updated",
  "attributesJson": [
    { "key": "slot_id", "value": "1", "index": true },
    { "key": "operator_address", "value": "twilight17n30thc6ntha6rpjvk46yrwvkd86guy9crevra", "index": true },
    { "key": "msg_index", "value": "0", "index": true }
  ],
  "keyFieldsJson": {
    "slot_id": "1",
    "operator_address": "twilight17n30thc6ntha6rpjvk46yrwvkd86guy9crevra"
  }
}
```

## 6. Rewards Message Surface

Source inspected:

- `/Users/quasar/Github/nyks-core/proto/twilight/rewards/v1/tx.proto`
- `/Users/quasar/Github/nyks-core/x/rewards/keeper/msg_server.go`
- `/Users/quasar/Github/nyks-core/x/rewards/keeper/claims.go`

Messages:

| Type URL | Key decoded fields | Intent |
|---|---|---|
| `/twilight.rewards.v1.MsgClaimRewards` | `signer`, `slot_id`, `start_epoch`, `end_epoch` | Claim finalized eligible rewards for a slot and epoch range. |
| `/twilight.rewards.v1.MsgUpdateRewardsParams` | `authority`, `params` | Queue rewards params update. Pause flags cannot be changed by this message. |
| `/twilight.rewards.v1.MsgPauseRewards` | `emergency_authority`, `pause_emissions`, `pause_epoch_settlement`, `pause_claims` | Disable selected rewards functions. |
| `/twilight.rewards.v1.MsgResumeRewards` | `emergency_authority`, `resume_emissions`, `resume_epoch_settlement`, `resume_claims` | Re-enable selected rewards functions. |

Rewards state/query structures of interest:

- `RewardsState`: `current_epoch`, `current_epoch_start_height`, `cumulative_emitted`, `carry_forward_remainder`.
- `EpochReward`: epoch height range, minted emission, carry in/out, treasury amount, reward pool, allocated amount, distribution method, reward rows, cumulative emitted after epoch.
- `EligibleSlotReward`: `slot_id`, `operator_address`, `payout_address`, `blocks_active`, weights, `amount`, `claimed`, `claimed_at_height`, `epoch_number`.
- `ModuleBalances`: `denom`, `rewards_balance`, `fee_pool_balance`.

## 7. Rewards Event Surface

Source inspected:

- `/Users/quasar/Github/nyks-core/x/rewards/types/events.go`
- `/Users/quasar/Github/nyks-core/x/rewards/keeper/events.go`
- `/Users/quasar/Github/nyks-core/x/rewards/keeper/claims.go`
- `/Users/quasar/Github/nyks-core/x/rewards/keeper/finalize.go`
- `/Users/quasar/Github/nyks-core/x/rewards/keeper/msg_server.go`

Rewards event types and attributes:

| Event type | Attributes | Notes |
|---|---|---|
| `epoch_finalized` | `epoch`, `start_height`, `end_height`, `minted_emission`, `cumulative_emitted`, `reward_pool`, `allocated`, `carry_out`, `eligible_slots`, `distribution_method` | Emitted during epoch finalization in EndBlock. |
| `reward_claimed` | `signer`, `slot_id`, `start_epoch`, `end_epoch`, `amount`, `payout_count` | Emitted by successful `MsgClaimRewards`. |
| `params_update_queued` | `authority` | Message payload carries full params. |
| `params_activated` | none | Emitted when pending params activate during epoch finalization. |
| `rewards_paused` | `authority` | Message payload indicates which flags were paused. |
| `rewards_resumed` | `authority` | Message payload indicates which flags were resumed. |
| `treasury_paid` | `payout_address`, `amount` | Emitted on positive treasury payment during epoch finalization. |

No rewards events were present in the current smoke DB range, so the event shapes above come from chain code inspection, not local DB examples.

## 8. Proposed CoreSlot Projection Models

These are model drafts only. Do not add them until implementation is approved.

### `CoreSlotProjection`

Purpose: current explorer view of one CoreSlot.

Source rows used: primarily `Message` and `Event`; later reconciled with `ChainClient.getCoreSlot()` or `getCoreSlots()` snapshots.

Primary key: `slotId`.

Unique constraints: `operatorAddress` unique while active/current; `consensusAddress` unique while current, with caution around removed/reserved keys.

Important indexes: `status`, `operatorAddress`, `payoutAddress`, `consensusAddress`, `updatedHeight`.

Fields:

- `slotId BigInt`
- `status String`
- `operatorAddress String`
- `payoutAddress String?`
- `consensusAddress String?`
- `consensusPubkeyJson Json?`
- `rewardWeight String?`
- `consensusPower BigInt?`
- `createdHeight BigInt?`
- `activatedHeight BigInt?`
- `suspendedHeight BigInt?`
- `removedHeight BigInt?`
- `updatedHeight BigInt`
- `metadataJson Json?`
- `lastSourceHeight BigInt`
- `lastSourceTxHash String?`
- `lastSourceMsgIndex Int?`
- `lastSourceEventId BigInt?`
- `rawSnapshotJson Json?`

Rebuild behavior: clear and replay CoreSlot semantic events/messages in height order. Optionally reconcile at the end with current CoreSlot REST/gRPC snapshot and record snapshot drift.

Open questions:

- Should removed slots keep unique operator/consensus constraints, or should uniqueness be enforced only for current non-removed state?
- Should `consensusAddress` be computed by the decoder for pubkey Any, or always read from events/snapshots?
- How should snapshot drift be surfaced if replay and live snapshot disagree?

### `CoreSlotLifecycleEvent`

Purpose: append-only semantic history of CoreSlot lifecycle/status and validator-set effects.

Source rows used: `Event` rows with CoreSlot event types plus matching `Message` rows where available.

Primary key: `id`.

Unique constraints: `sourceEventId` unique.

Important indexes: `slotId,height`, `eventType`, `operatorAddress`, `txHash`, `effectiveHeight`.

Fields:

- `id BigInt`
- `slotId BigInt?`
- `height BigInt`
- `txHash String?`
- `msgIndex Int?`
- `eventType String`
- `oldStatus String?`
- `newStatus String?`
- `operatorAddress String?`
- `consensusAddress String?`
- `oldConsensusAddress String?`
- `newConsensusAddress String?`
- `power BigInt?`
- `reason String?`
- `effectiveHeight BigInt?`
- `sourceMessageId BigInt?`
- `sourceEventId BigInt`
- `rawMessageJson Json?`
- `rawEventJson Json`

Rebuild behavior: clear table and replay matching `Event` rows ordered by `height, txIndex, eventIndex`.

Open questions:

- Should `coreslot_validator_update_emitted` live here or in a separate validator-set table?
- Should lifecycle rows be created for message intent even if no effect event exists because the tx failed? Recommendation: no; failed txs belong in generic tx/message views.

### `CoreSlotMetadataChange`

Purpose: record metadata updates with full new metadata payload.

Source rows used: `Message` type `MsgUpdateOperatorMetadata` plus matching `coreslot_metadata_updated` event.

Primary key: `id`.

Unique constraints: `sourceMessageId` unique.

Important indexes: `slotId,height`, `operatorAddress`.

Fields:

- `id BigInt`
- `slotId BigInt`
- `operatorAddress String`
- `height BigInt`
- `txHash String`
- `msgIndex Int`
- `metadataJson Json`
- `sourceMessageId BigInt`
- `sourceEventId BigInt?`
- `rawMessageJson Json`
- `rawEventJson Json?`

Rebuild behavior: replay matching messages; attach event by same `txHash` and `msg_index` attribute when present.

Open questions:

- Should initial registration metadata also create a metadata-change row? Recommendation: yes, mark `changeKind=initial` later if useful.

### `CoreSlotPayoutAddressChange`

Purpose: record payout address updates with the new payout address omitted by the event but present in the message.

Source rows used: `MsgUpdatePayoutAddress` plus `coreslot_payout_updated`.

Primary key: `id`.

Unique constraints: `sourceMessageId` unique.

Important indexes: `slotId,height`, `operatorAddress`, `newPayoutAddress`.

Fields:

- `id BigInt`
- `slotId BigInt`
- `operatorAddress String`
- `newPayoutAddress String`
- `height BigInt`
- `txHash String`
- `msgIndex Int`
- `sourceMessageId BigInt`
- `sourceEventId BigInt?`
- `rawMessageJson Json`
- `rawEventJson Json?`

Rebuild behavior: replay messages and attach effect event.

Open questions:

- Should current payout live only on `CoreSlotProjection`, with this table only historical? Recommendation: yes.

### `CoreSlotConsensusKeyRotation`

Purpose: track requested, applied, immediate, and cancelled consensus key rotations.

Source rows used: `MsgRotateConsensusKey`, `coreslot_key_rotation_requested`, `coreslot_key_rotated`, `coreslot_rotation_cancelled`.

Primary key: `id`.

Unique constraints: `sourceEventId` unique; optional `slotId,effectiveHeight,newConsensusAddress` unique for applied rotations.

Important indexes: `slotId`, `status`, `effectiveHeight`, `oldConsensusAddress`, `newConsensusAddress`.

Fields:

- `id BigInt`
- `slotId BigInt`
- `operatorAddress String?`
- `oldConsensusAddress String?`
- `newConsensusAddress String?`
- `requestedHeight BigInt?`
- `effectiveHeight BigInt?`
- `appliedHeight BigInt?`
- `cancelledHeight BigInt?`
- `status String` (`requested`, `applied`, `cancelled`, `immediate_applied`)
- `power BigInt?`
- `reason String?`
- `sourceMessageId BigInt?`
- `requestEventId BigInt?`
- `appliedEventId BigInt?`
- `cancelEventId BigInt?`
- `rawMessageJson Json?`
- `rawEventJson Json?`

Rebuild behavior: replay request/apply/cancel events by height. Link request to apply/cancel by slot ID and new consensus address where possible.

Open questions:

- Is `old_consensus_address + new_consensus_address` sufficient to link delayed requests and later EndBlock applications? Likely yes, but test fixtures should confirm.

### `CoreSlotParameterChange`

Purpose: record CoreSlot params changes.

Source rows used: `MsgUpdateParams` plus `coreslot_params_updated`.

Primary key: `id`.

Unique constraints: `sourceMessageId` unique.

Important indexes: `height`, `authority`.

Fields:

- `id BigInt`
- `height BigInt`
- `txHash String`
- `msgIndex Int`
- `authority String`
- `paramsJson Json`
- `sourceMessageId BigInt`
- `sourceEventId BigInt?`
- `rawMessageJson Json`
- `rawEventJson Json?`

Rebuild behavior: replay successful param messages with matching event.

Open questions:

- Should old params be stored by snapshot reconciliation? The message only carries new params.

## 9. Proposed Rewards Projection Models

### `RewardEpochProjection`

Purpose: finalized epoch semantic summary.

Source rows used: `epoch_finalized` events; later rewards REST/gRPC `EpochReward` snapshots for full reward rows.

Primary key: `epoch`.

Unique constraints: `sourceEventId` unique.

Important indexes: `startHeight`, `endHeight`, `finalizedHeight`.

Fields:

- `epoch BigInt`
- `startHeight BigInt`
- `endHeight BigInt`
- `finalizedHeight BigInt`
- `mintedEmission String`
- `cumulativeEmitted String`
- `rewardPool String`
- `allocatedAmount String`
- `carryOut String`
- `eligibleSlots BigInt`
- `distributionMethod String`
- `sourceEventId BigInt`
- `rawEventJson Json`
- `rawSnapshotJson Json?`

Rebuild behavior: replay `epoch_finalized` events; optionally enrich from `ChainClient.getEpochReward(epoch)`.

Open questions:

- Should enrichment from snapshots be part of the projection worker or a separate reconciler? Recommendation: separate reconciler after event parser is stable.

### `RewardClaimProjection`

Purpose: claim history with tx hash correlation.

Source rows used: `MsgClaimRewards` message plus `reward_claimed` event.

Primary key: `id`.

Unique constraints: `sourceMessageId` unique; optional `txHash,msgIndex` unique.

Important indexes: `slotId`, `signer`, `startEpoch,endEpoch`, `height`.

Fields:

- `id BigInt`
- `slotId BigInt`
- `signer String`
- `startEpoch BigInt`
- `endEpoch BigInt`
- `amount String?`
- `payoutCount Int?`
- `height BigInt`
- `txHash String`
- `msgIndex Int`
- `sourceMessageId BigInt`
- `sourceEventId BigInt?`
- `rawMessageJson Json`
- `rawEventJson Json?`

Rebuild behavior: replay claim messages and attach `reward_claimed` event by `txHash` and `msg_index` where available. If event lacks `msg_index`, attach by tx and type if unambiguous.

Open questions:

- Claim event currently gives total amount and payout count, not individual payout rows. Full per-epoch/per-slot claim rows need rewards REST/gRPC `SlotRewards` claim records. `EpochReward` is an epoch aggregate/finalization snapshot and must not be treated as current per-claim truth.

### `RewardEmissionEvent`

Purpose: historical emission and treasury events.

Source rows used: `epoch_finalized` and `treasury_paid`.

Primary key: `id`.

Unique constraints: `sourceEventId` unique.

Important indexes: `epoch`, `height`, `eventType`, `payoutAddress`.

Fields:

- `id BigInt`
- `height BigInt`
- `epoch BigInt?`
- `eventType String`
- `mintedEmission String?`
- `cumulativeEmitted String?`
- `rewardPool String?`
- `allocatedAmount String?`
- `carryOut String?`
- `treasuryPayoutAddress String?`
- `treasuryAmount String?`
- `sourceEventId BigInt`
- `rawEventJson Json`

Rebuild behavior: replay rewards emission/treasury events.

Open questions:

- Should this be merged into `RewardEpochProjection` plus a separate `TreasuryPaymentProjection`? Keep separate only if explorer needs an emission event stream.

### `RewardModuleBalanceSnapshot`

Purpose: periodic or event-triggered module balance snapshots.

Source rows used: `ChainClient.getModuleBalances()` through Twilight REST first, gRPC later; optionally triggered by `epoch_finalized`, `reward_claimed`, and treasury events.

Primary key: `id`.

Unique constraints: optional `observedHeight,denom` unique.

Important indexes: `observedHeight`, `createdAt`, `denom`.

Fields:

- `id BigInt`
- `observedHeight BigInt`
- `denom String`
- `rewardsBalance String`
- `feePoolBalance String`
- `source String` (`twilight_rest`, `grpc`)
- `rawSnapshotJson Json`
- `createdAt DateTime`

Rebuild behavior: can be cleared and regenerated from scheduled snapshots only if source snapshots are saved. If not saved, this is not fully rebuildable from generic rows and should be treated as a sampled snapshot table.

Open questions:

- Since snapshots are not derivable from generic rows unless explicitly stored, should this wait until a snapshot ingestion policy is approved? Recommendation: yes.

### `RewardParameterChange`

Purpose: record queued, activated, paused, and resumed rewards parameter changes.

Source rows used: rewards param/pause/resume messages and events.

Primary key: `id`.

Unique constraints: `sourceMessageId` unique for message-driven changes; `sourceEventId` unique for `params_activated`.

Important indexes: `height`, `changeType`, `authority`.

Fields:

- `id BigInt`
- `height BigInt`
- `txHash String?`
- `msgIndex Int?`
- `changeType String` (`queued`, `activated`, `paused`, `resumed`)
- `authority String?`
- `paramsJson Json?`
- `emissionsFlagChanged Boolean?`
- `settlementFlagChanged Boolean?`
- `claimsFlagChanged Boolean?`
- `sourceMessageId BigInt?`
- `sourceEventId BigInt?`
- `rawMessageJson Json?`
- `rawEventJson Json?`

Rebuild behavior: replay rewards param/pause/resume messages and `params_activated` events.

Open questions:

- `params_activated` has no attributes. To reconstruct activated params exactly, the worker needs to carry prior queued params state or reconcile with snapshots.

### `RewardPauseResumeEvent`

Purpose: compact history of emergency pause/resume actions.

Source rows used: `MsgPauseRewards`, `MsgResumeRewards`, `rewards_paused`, `rewards_resumed`.

Primary key: `id`.

Unique constraints: `sourceMessageId` unique.

Important indexes: `height`, `authority`, `action`.

Fields:

- `id BigInt`
- `height BigInt`
- `txHash String`
- `msgIndex Int`
- `action String` (`pause`, `resume`)
- `authority String`
- `emissions Boolean`
- `epochSettlement Boolean`
- `claims Boolean`
- `sourceMessageId BigInt`
- `sourceEventId BigInt?`
- `rawMessageJson Json`
- `rawEventJson Json?`

Rebuild behavior: replay messages and attach event by tx.

Open questions:

- This overlaps with `RewardParameterChange`; use one unified table unless UI needs a separate emergency-action stream.

## 10. Projection Architecture

Recommended worker shape:

```text
Generic canonical tables
  Block
  ExplorerTransaction
  Message
  Event
  Account
  DecodeFailure
        |
        v
Semantic projection worker
        |
        v
Derived CoreSlot/rewards projection tables
```

Worker properties:

- Reads only generic rows.
- Writes only semantic projection tables and `ProjectionCursor`/`ProjectionFailure`.
- Never mutates generic rows.
- Processes heights in order.
- Supports single-height, range, and catch-up modes.
- Supports clearing semantic tables and rebuilding from a height range.
- Uses advisory lock separate from generic indexer lock.
- Tolerates unknown future message/event types.
- Stores source references on every semantic row:
  - `sourceHeight`
  - `sourceTxHash`
  - `sourceMsgIndex`
  - `sourceEventId`
  - `sourceMessageId`
  - `rawMessageJson`
  - `rawEventJson`

Recommended projection stages per height:

1. Load successful `ExplorerTransaction` rows at height.
2. Load `Message` rows for those txs.
3. Load tx `Event` rows for those txs.
4. Load block-result `Event` rows for the height.
5. Parse known CoreSlot and rewards messages/events.
6. Correlate message effects with events by `txHash` and `msg_index` when present.
7. Upsert derived rows by source keys.
8. Record `ProjectionFailure` for semantic parse/correlation failures.
9. Advance projection cursor only after semantic writes commit.

### Message-driven, Event-driven, or Hybrid?

Recommendation: hybrid.

- Messages provide intent and rich payloads, such as metadata, payout address, params, and pause/resume flags.
- Events provide confirmed chain effects and EndBlock-only lifecycle signals, such as validator updates, epoch finalization, and delayed key rotation application.
- Some events omit important payloads, so event-only projection is insufficient.
- Some effects happen outside tx execution, so message-only projection is insufficient.

### Source of Truth for Current CoreSlot State

Canonical explorer source of truth remains generic rows plus optional module snapshots.

For current CoreSlot state:

- First derive from successful messages/events.
- Reconcile periodically with `ChainClient.getCoreSlots()` snapshots.
- Store reconciliation drift as projection failure or snapshot mismatch, not by silently mutating history.

### Reconstruct from Events or Reconcile with Snapshots?

Recommendation: both, staged.

1. First build event/message historical projections.
2. Later add `CoreSlotProjection` current state by replay.
3. Then add snapshot reconciliation with Twilight REST first and gRPC later.

This avoids making live snapshots the hidden source of truth while still catching parser gaps.

### Chain Reorg / Hash Mismatch Handling

Generic ingestion already halts on block hash mismatch. Projection should:

- Refuse to advance past a generic cursor with `halted_hash_mismatch`.
- Store projected source block hash or read `Block.hash` during processing.
- Support clearing semantic rows from a height onward if generic rows are repaired/reindexed later.

### Repeated Idempotent Reruns

Use deterministic unique keys:

- message projections: `sourceMessageId` unique or `txHash,msgIndex,projectionType`
- event projections: `sourceEventId` unique
- current state: natural key such as `slotId` or `epoch`
- cursor: `projectionName,chainId`

Rerunning the same height range should update/upsert the same semantic rows, not append duplicates.

### Semantic Table Rebuilds

Support:

- full semantic reset: truncate semantic tables and projection cursor, keep generic tables
- module reset: clear only CoreSlot or only rewards semantic tables
- height reset: delete semantic rows with `sourceHeight >= N`, rewind projection cursor

Do not delete generic canonical rows during semantic rebuilds.

## 11. Projection Failure Strategy

`ProjectionFailure` is needed.

Reason: generic decode may succeed, but semantic parsing/correlation can still fail because:

- expected event attributes are missing
- message and event `slot_id` disagree
- a known event type has unexpected shape
- delayed key rotation cannot be linked to a request
- rewards `params_activated` cannot be associated with queued params
- future chain versions add fields or event types

Draft model:

```prisma
model ProjectionFailure {
  id              BigInt   @id @default(autoincrement())
  projectionName  String
  module          String?
  sourceHeight    BigInt
  sourceTxHash    String?
  sourceMsgIndex  Int?
  sourceMessageId BigInt?
  sourceEventId   BigInt?
  typeUrl         String?
  eventType       String?
  failureKind     String
  rawMessageJson  Json?
  rawEventJson    Json?
  error           String
  resolved        Boolean  @default(false)
  resolvedAt      DateTime?
  createdAt       DateTime @default(now())

  @@index([projectionName])
  @@index([module])
  @@index([sourceHeight])
  @@index([sourceTxHash])
  @@index([failureKind])
  @@index([resolved])
}
```

Suggested failure kinds:

- `missing_required_attribute`
- `message_event_mismatch`
- `unknown_semantic_type`
- `invalid_numeric_field`
- `missing_source_message`
- `missing_source_event`
- `snapshot_reconciliation_mismatch`

## 12. Recommended First Implementation Slice

Recommended option: Option A, CoreSlot message/event projection only.

Scope:

- Add semantic projection tables for:
  - `CoreSlotLifecycleEvent`
  - `CoreSlotMetadataChange`
  - optionally `ProjectionFailure`
- Parse CoreSlot messages and events from existing generic rows.
- Start with `MsgUpdateOperatorMetadata` and `coreslot_metadata_updated`, because the smoke DB already contains real data and fixture coverage.
- Add parser fixtures for every CoreSlot event type from chain code before enabling broad projection.
- Do not maintain `CoreSlotProjection` current state yet.

Why this first:

- Smallest meaningful slice.
- Uses real A/B-5 indexed data.
- Tests message/event correlation without the complexity of current-state replay.
- Keeps semantic rows rebuildable.
- Avoids prematurely treating snapshot state as canonical.

Rejected first slices:

- Option B, CoreSlot current-state projection: more useful, but higher risk because lifecycle, delayed key rotations, cancellation, and EndBlock validator updates need robust ordering first.
- Option C, rewards claims first: likely smaller in some chains, but current local smoke has no rewards claim event. It would start with less actual indexed data.

## 13. Explicit Non-Goals

Not part of this exploration:

- semantic Prisma migration
- projection worker implementation
- CoreSlot semantic projection code
- rewards semantic projection code
- API routes
- web pages
- generated gRPC clients
- buf migration
- production Docker packaging
- devnet deployment
- chain repo modification
- unsupported standard module REST dependencies
- staking/delegation/governance/mint/distribution compatibility models

## 14. Open Questions

1. Should `CoreSlotProjection` be replay-only first, or should the first current-state version require snapshot reconciliation from day one?
2. Should delayed key rotations be represented as one mutable row with status transitions, or append-only request/apply/cancel rows?
3. Should `coreslot_validator_update_emitted` be shown as part of lifecycle history or as a separate validator-set history?
4. Should `CoreSlotMetadataChange` include registration metadata as an initial metadata row?
5. How should nested consensus pubkey `Any` fields be decoded or displayed before generated gRPC clients exist?
6. Should rewards module balance snapshots be considered semantic projections if they are not rebuildable from generic rows unless separately stored?
7. How should `params_activated` with no attributes be tied to the queued params it activates?
8. Should projection cursors be per module (`coreslot`, `rewards`) or per projection version?
9. What retention policy should `ProjectionFailure` use once a parser bug is fixed and projections are rebuilt?
10. How much snapshot drift is acceptable before a projection should halt rather than warn?

## 15. Acceptance Recommendation

This exploration satisfies the design prerequisites for A/B-6 implementation if the team agrees that the first build slice is CoreSlot semantic audit projection only.

The next implementation prompt should ask for:

1. Add `ProjectionCursor` and `ProjectionFailure`.
2. Add `CoreSlotLifecycleEvent` and `CoreSlotMetadataChange`.
3. Implement a range-based projection worker reading only generic rows.
4. Support rebuild/reset of semantic tables only.
5. Add tests using the A/B-5 CoreSlot metadata tx fixture and synthetic fixtures for remaining CoreSlot events.
