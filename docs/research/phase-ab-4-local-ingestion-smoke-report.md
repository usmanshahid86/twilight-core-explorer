# Twilight Core Explorer Phase A/B-4 Local Ingestion Smoke Report

## 1. Summary

Phase A/B-4 local chain range ingestion smoke passed against a running Twilight Core localnet.

The smoke proved:

- CometBFT RPC `/status` works.
- CometBFT RPC `/block` works.
- CometBFT RPC `/block_results` works.
- REST `/cosmos/base/tendermint/v1beta1/node_info` works.
- REST `/cosmos/bank/v1beta1/supply` works.
- REST tx query endpoint responds with the correct `query=tx.height=N` form.
- The explorer indexer can ingest a real local chain height range.
- The selected range includes a tx-containing block.
- The same range can be rerun idempotently.
- The cursor reaches `END_HEIGHT` and remains `idle`.

## 2. Local Chain Start Commands Used

The local chain was started from the chain repo:

```sh
cd /Users/quasar/Github/nyks-core

export TWILIGHT_LOCALNET_HOME=/tmp/twilight-localnet
export CHAIN_ID=twilight-localnet-1

scripts/localnet/stop.sh || true
scripts/localnet/init.sh

A="$TWILIGHT_LOCALNET_HOME/node0/config/app.toml"
sed -i.bak '/^\[api\]/,/^\[/ s/^enable = false/enable = true/; /^\[api\]/,/^\[/ s/^swagger = false/swagger = true/' "$A"
rm -f "$A.bak"

scripts/localnet/start.sh
```

The user verified:

```sh
curl -s http://localhost:26657/status | jq '.result.sync_info'
curl -s http://localhost:26657/block_results | jq .
curl -s http://localhost:1317/cosmos/base/tendermint/v1beta1/node_info | jq .
curl -s http://localhost:1317/cosmos/bank/v1beta1/supply | jq .
```

Explorer-side endpoint checks later confirmed:

- `/status` latest height: `97` during initial probe
- `/block_results`: `200`
- REST `node_info`: `200`
- REST bank supply: `200`

## 3. Transaction Produced for Smoke

No generic bank-send CLI was available through `twilightd tx bank send`; this app's `tx` command is query-only.

A low-impact local CoreSlot metadata update tx was submitted instead:

```sh
/Users/quasar/Github/nyks-core/build/twilightd coreslot update-metadata 1 explorer-smoke-<timestamp> \
  --from operator0 \
  --keyring-backend test \
  --home /tmp/twilight-localnet/node0 \
  --chain-id twilight-localnet-1 \
  --node tcp://127.0.0.1:26657 \
  --gas 200000 \
  --fees 0utwlt \
  --broadcast-mode sync \
  --output json \
  -y
```

Tx hash:

`2BF1A0557CBBA9FAB26671E471BDEC36A24A823032FFC91AF529092655E78A81`

Inclusion height:

`120`

## 4. Selected Height Range

Selected range:

```text
START_HEIGHT=119
END_HEIGHT=121
```

Reason:

- includes the tx-containing height `120`
- includes neighboring blocks likely to be empty
- keeps the smoke small and deterministic

## 5. First Run Result

Initial smoke run exposed two real integration issues before the final successful run:

1. REST tx query form:

   - `events=tx.height=N` returned `500` with `query cannot be empty`.
   - The chain's REST tx endpoint accepts `query=tx.height=N`.
   - Fixed `RestRpcChainClient.getTxsByHeight()` and `scripts/smoke-local-ingestion.sh`.

2. Custom tx REST decode:

   - Querying the tx-containing height via REST returned `500`:
     `unable to resolve type URL /twilight.coreslot.v1.MsgUpdateOperatorMetadata`.
   - Fixed by adding a `RestRpcChainClient` fallback from REST tx search to CometBFT `/block` raw txs plus `/tx` results.

After these fixes, the wrapper passed:

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

## 6. Second/Idempotency Run Result

The smoke wrapper reran the same range automatically and passed.

An additional manual rerun also passed:

```sh
CHAIN_ID=twilight-localnet-1 \
COMET_RPC_URL=http://localhost:26657 \
REST_URL=http://localhost:1317 \
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public \
START_HEIGHT=119 \
END_HEIGHT=121 \
npm --prefix apps/indexer start
```

Counts before and after the manual rerun were unchanged.

## 7. DB Row Counts

Initial counts before smoke:

```json
{
  "Block": 0,
  "ExplorerTransaction": 0,
  "Message": 0,
  "Event": 0,
  "Account": 0,
  "IndexerCursor": 0,
  "DecodeFailure": 0
}
```

Counts after wrapper run and idempotency rerun:

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

Counts after extra manual rerun:

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

`Message` is `0` because the tx was ingested through the CometBFT fallback path. The fallback preserves the tx result and events but does not decode Cosmos SDK message bodies from raw transaction bytes yet.

## 8. Final Cursor

Final cursor:

```json
{
  "chainId": "twilight-localnet-1",
  "lastIndexedHeight": "121",
  "lastIndexedHash": "8397081B767356C3557C5DDAB99309B21DA869688C3066EE30B2535997A41F78",
  "latestChainHeight": "154",
  "status": "idle",
  "error": null
}
```

Cursor reached `END_HEIGHT=121` and remained `idle`.

## 9. Fixes Made

Files changed during smoke execution:

- `packages/chain-client/src/rest-rpc-client.ts`
- `packages/chain-client/test/rest-rpc-client.test.js`
- `scripts/smoke-local-ingestion.sh`
- `docs/research/phase-ab-4-local-ingestion-smoke-plan.md`
- `docs/research/phase-ab-4-local-ingestion-smoke-report.md`

Fixes:

- Changed tx-height REST query from `events=tx.height=N` to `query=tx.height=N`.
- Added `RestRpcChainClient` fallback for REST tx search decode failures:
  - fetch CometBFT `/block?height=N`
  - compute tx hashes from raw block tx bytes
  - fetch each tx via CometBFT `/tx?hash=0xHASH`
  - return normalized `TxSource` rows for generic transaction/event storage
- Added a chain-client unit test for the fallback path.
- Updated the smoke wrapper to build the indexer before running it.

## 10. Validation

Passed:

```sh
npm --prefix packages/chain-client run typecheck
npm --prefix packages/chain-client test
CHAIN_ID=twilight-localnet-1 COMET_RPC_URL=http://localhost:26657 REST_URL=http://localhost:1317 DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public START_HEIGHT=119 END_HEIGHT=121 scripts/smoke-local-ingestion.sh
CHAIN_ID=twilight-localnet-1 COMET_RPC_URL=http://localhost:26657 REST_URL=http://localhost:1317 DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public START_HEIGHT=119 END_HEIGHT=121 npm --prefix apps/indexer start
```

## 11. Known Limitations

- Raw fallback tx ingestion stores transaction result/events but does not decode message bodies yet.
- The tx used for smoke was a CoreSlot metadata update, not a harmless bank send, because no generic bank-send CLI command was available.
- REST tx search can respond `500` for custom Twilight txs when the REST layer cannot resolve the custom message type URL.
- No CoreSlot or rewards semantic projection was implemented.
- No API/web pages were implemented.

## 12. Explicit Non-Goals

Not implemented:

- CoreSlot semantic projection
- rewards semantic projection
- API routes
- web pages
- generated gRPC clients
- buf migration
- production Docker packaging
- devnet deployment
- chain code changes

No staking, delegation, governance, mint, or distribution explorer models were added.

## 13. Result

Explorer Phase A/B-4 local ingestion smoke: `PASS`
