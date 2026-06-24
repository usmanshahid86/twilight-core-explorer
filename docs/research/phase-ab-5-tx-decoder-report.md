# Twilight Core Explorer Phase A/B-5 Tx Decoder Report

## 1. Summary

Phase A/B-5 adds the TypeScript descriptor decoder foundation for raw Cosmos SDK transaction bytes.

The A/B-4 gap is closed:

```json
{
  "ExplorerTransaction": 1,
  "Message": 1
}
```

Fallback-ingested transactions now preserve the raw CometBFT tx bytes and decode them as:

```text
cosmos.tx.v1beta1.TxRaw
  -> cosmos.tx.v1beta1.TxBody
  -> TxBody.messages[] google.protobuf.Any
  -> Twilight/Cosmos message body when type URL is known
```

No CoreSlot or rewards semantic projection was implemented.

## 2. Descriptor Artifacts Copied

Copied from the local chain repo:

```text
/Users/quasar/Github/nyks-core/docs/proto/twilight-descriptors.pb
/Users/quasar/Github/nyks-core/docs/proto/twilight-msg-type-urls.json
/Users/quasar/Github/nyks-core/docs/proto/README.md
```

Copied into:

```text
packages/proto/descriptors/twilight-descriptors.pb
packages/proto/descriptors/twilight-msg-type-urls.json
packages/proto/descriptors/README.md
```

Refresh command:

```sh
npm run proto:refresh
```

Refresh output:

```text
twilight-descriptors.pb 57048 bytes sha256=0a287ea1a1e42d06cfd848ee4b757c1efc39b8546dfa04006e11cbe60cd5c26a
twilight-msg-type-urls.json 1596 bytes sha256=95aafab74d9fbc96f6cb7974d30b1007191b81616beed705ba5b835e60821e53
README.md 4145 bytes sha256=2b938775b30bf95c676f39807c3f67a7dc4287d7d4630ccaad94607145e07cc6
```

The explorer uses the local copied descriptor at runtime. It does not depend on the chain repo at runtime.

## 3. Packages Added

Added `packages/proto`:

- exports descriptor and message type URL paths
- loads descriptor bytes
- loads message type URL manifest
- includes `scripts/refresh-from-chain.js`

Added `packages/decoder`:

- loads the binary `FileDescriptorSet` with `protobufjs`
- builds and caches a `protobufjs.Root`
- looks up messages by Any type URL
- decodes raw tx bytes and base64 tx bytes
- normalizes `Long` values to strings and bytes to base64

Dependency added:

```text
protobufjs
```

## 4. Decoder Architecture

The decoder is descriptor-backed, not generated source-backed.

Runtime flow:

```text
packages/proto local descriptor artifacts
    ↓
packages/decoder protobuf Root
    ↓
decodeRawTxBase64 / decodeRawTxBytes
    ↓
generic Message rows and DecodeFailure rows
```

Supported type URL forms:

```text
/twilight.coreslot.v1.MsgUpdateOperatorMetadata
type.googleapis.com/twilight.coreslot.v1.MsgUpdateOperatorMetadata
```

Lookup name:

```text
twilight.coreslot.v1.MsgUpdateOperatorMetadata
```

## 5. Raw Tx Decode Flow

`decodeRawTxBytes()`:

1. Looks up `cosmos.tx.v1beta1.TxRaw`.
2. Decodes raw tx bytes.
3. Decodes `TxRaw.bodyBytes` as `cosmos.tx.v1beta1.TxBody`.
4. Decodes `TxRaw.authInfoBytes` as `cosmos.tx.v1beta1.AuthInfo`.
5. Iterates `TxBody.messages[]`.
6. Normalizes each Any `typeUrl`.
7. Looks up the message type in the descriptor root.
8. Decodes known message values.
9. Preserves unknown or failed message decode as non-halting failure data.

## 6. Indexer Fallback Integration

`TxSource` now has:

```ts
rawTxBase64?: string;
```

`RestRpcChainClient` sets this field when REST tx search falls back to:

```text
CometBFT /block raw txs + CometBFT /tx result
```

The indexer mapper behavior is now:

- if REST already provides `tx.body.messages[]`, keep using that JSON path
- if messages are absent and `rawTxBase64` is present, decode raw tx bytes through `packages/decoder`
- create generic `Message` rows from decoded Any messages
- preserve raw message value base64 in `Message.rawJson`
- keep semantic CoreSlot/rewards projection out of scope

## 7. DecodeFailure Behavior

Decode failures are persisted as data-quality records and do not halt indexing.

Implemented failure kinds:

```text
tx_raw_decode
tx_body_decode
auth_info_decode
any_type_lookup
any_value_decode
```

Known unsupported message types still allow the transaction to index. If a type URL is known enough to identify module/type name, the generic Message row preserves that metadata.

## 8. Tests Added

`packages/proto`:

- descriptor file exists
- message type URL manifest exists
- descriptor bytes are non-empty
- manifest contains `/twilight.coreslot.v1.MsgUpdateOperatorMetadata`
- manifest contains `/twilight.rewards.v1.MsgClaimRewards`

`packages/decoder`:

- descriptor loads into a protobuf root
- resolves `cosmos.tx.v1beta1.TxRaw`
- resolves `cosmos.tx.v1beta1.TxBody`
- resolves `twilight.coreslot.v1.MsgUpdateOperatorMetadata`
- resolves `twilight.rewards.v1.MsgClaimRewards`
- type URL helpers classify coreslot/rewards/bank/auth
- invalid raw tx bytes return structured decode failure
- A/B-4 raw tx fixture decodes to `/twilight.coreslot.v1.MsgUpdateOperatorMetadata`

`apps/indexer`:

- fallback raw tx source creates Message rows
- fallback decode failure creates DecodeFailure rows
- decode failures do not halt ingestion

## 9. Local Smoke Rerun Result

Command:

```sh
CHAIN_ID=twilight-localnet-1 \
COMET_RPC_URL=http://localhost:26657 \
REST_URL=http://localhost:1317 \
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public \
START_HEIGHT=119 \
END_HEIGHT=121 \
scripts/smoke-local-ingestion.sh
```

Result:

```text
PASS local ingestion smoke 119..121
```

## 10. DB Counts Before/After

A/B-4 after smoke:

```json
{
  "Block": 3,
  "ExplorerTransaction": 1,
  "Message": 0,
  "Event": 5,
  "Account": 1,
  "IndexerCursor": 1,
  "DecodeFailure": 0
}
```

A/B-5 after smoke and idempotency rerun:

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

Decoded message:

```json
{
  "txHash": "2BF1A0557CBBA9FAB26671E471BDEC36A24A823032FFC91AF529092655E78A81",
  "height": "120",
  "msgIndex": 0,
  "typeUrl": "/twilight.coreslot.v1.MsgUpdateOperatorMetadata",
  "module": "coreslot",
  "typeName": "MsgUpdateOperatorMetadata",
  "decodeError": null
}
```

Final cursor:

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

## 11. Validation

Passed:

```sh
npm install
npm run proto:refresh
npm run db:generate
npm run typecheck
npm test
npm run lint
npm --prefix packages/proto test
npm --prefix packages/decoder test
npm --prefix packages/chain-client test
npm --prefix apps/indexer test
```

Static guards:

```sh
grep -R "<stale CoreSlot active slots path>" apps packages prisma docs scripts --exclude-dir=node_modules || true
grep -R "/cosmos/staking\|/cosmos/gov\|/cosmos/mint\|/cosmos/distribution" apps packages prisma docs scripts --exclude-dir=node_modules || true
```

Results:

- no stale CoreSlot active-slots collision-path references
- standard module route mentions are docs-only unsupported/non-goal notes

## 12. Known Limitations

- Descriptor-backed decoding is generic; semantic CoreSlot and rewards projection is still future work.
- DecodeFailure rows are append-only for now. A future phase should add a deterministic key or cleanup policy if repeated bad raw tx ingestion becomes common.
- The current decoder does not recursively decode nested `Any` values such as consensus pubkeys inside message fields.
- The current local smoke fixture is one CoreSlot metadata update tx; more fixture coverage should be added for rewards and bank messages.
- Generated gRPC clients are still future work behind `ChainClient`.

## 13. Explicit Non-Goals

- No CoreSlot semantic projection.
- No rewards semantic projection.
- No API routes.
- No web pages.
- No generated gRPC clients.
- No buf migration.
- No production Docker packaging.
- No devnet deployment.
- No staking/gov/mint/distribution REST dependencies or models.

## 14. Next Recommendation

Proceed to Phase A/B-6: semantic event/message projection design for CoreSlot and rewards, starting with read-only projections from existing `Message` and `Event` rows into reviewed model drafts before implementing web/API pages.
