# Twilight Core Explorer Phase A/B-4 Local Ingestion Smoke Plan

## 1. Summary

Phase A/B-4 prepares a real local-chain range ingestion smoke for the Twilight Core Explorer.

Result: `MOSTLY_ENOUGH`.

The Twilight Core repo has enough localnet and smoke infrastructure to support A/B-4, but the explorer smoke should remain an explorer-side wrapper that assumes a running REST-enabled localnet. The chain repo already provides localnet init/start/stop, multi-node block production, API surface smoke scripts, tx-producing lifecycle/rewards drills, and local reset paths. The main gap is operational: the generic localnet start path does not enable REST on node0 by default, and the self-contained API smoke starts REST+Swagger but tears the localnet down when it exits.

## 2. Chain Scripts Inspected

Chain repo path inspected:

`<path-to-nyks-core>`

Files inspected:

- `Makefile`
- `scripts/localnet/init.sh`
- `scripts/localnet/start.sh`
- `scripts/localnet/stop.sh`
- `scripts/localnet/smoke.sh`
- `scripts/smoke-local.sh`
- `scripts/smoke-api-surface.sh`
- `scripts/smoke-swagger-api.sh`
- `scripts/localnet/lib/drill-common.sh`
- `scripts/localnet/lifecycle-e2e.sh`
- `scripts/localnet/rewards-smoke.sh`
- `scripts/devnet/devnet-up.sh`
- `devnet/README.md`

Relevant Makefile targets:

- `make localnet-init`
- `make localnet-smoke`
- `make localnet-rewards-smoke`
- `make api-smoke`
- `make drill-lifecycle`
- `make drill-restart-rotation`
- `make drill-quorum`

## 3. Suitability Matrix

| Requirement | Existing script/command | Status | Gap | Recommendation |
|---|---|---|---|---|
| local chain starts | `scripts/localnet/init.sh` then `scripts/localnet/start.sh` | PASS | None for chain process startup. | Use chain repo to start localnet before explorer smoke. |
| blocks are produced | `scripts/localnet/smoke.sh` waits for all nodes to reach `MIN_HEIGHT` | PASS | `smoke.sh` tears down at exit. | For explorer smoke, run `init.sh` + `start.sh` manually and keep it running. |
| RPC 26657 reachable | node0 uses RPC `26657`; `smoke.sh` polls `/status` | PASS | None. | Explorer wrapper checks `COMET_RPC_URL/status`. |
| REST 1317 reachable | `scripts/smoke-local.sh` enables `[api] enable=true` on node0 | MOSTLY | `init.sh` does not enable REST by default. | Enable REST in `node0/config/app.toml` before `start.sh`, or use a chain-side helper later. |
| gRPC 9090 reachable | localnet init configures node0 gRPC `9090`; `smoke-api-surface.sh` can check reflection if `grpcurl` exists | PASS | gRPC not required for A/B-4. | Keep optional. |
| `/block` works | CometBFT RPC exposed on node0 | PASS | Not explicitly checked by chain smoke. | Explorer wrapper checks `COMET_RPC_URL/block`. |
| `/block_results` works | Operational drills query CometBFT RPC details; explorer `ChainClient` uses `/block_results` | PASS | Not explicitly checked by chain smoke. | Explorer wrapper checks `COMET_RPC_URL/block_results`. |
| tx REST query by height works | Generic REST API available once API is enabled; chain scripts rely on tx indexer by default for `/tx?hash` | MOSTLY | Need a tx-containing height and REST enabled. | Explorer wrapper checks `/cosmos/tx/v1beta1/txs?events=tx.height=...`. |
| `node_info` works | `smoke-api-surface.sh` preflight and generic checks use `/cosmos/base/tendermint/v1beta1/node_info` | PASS | Requires REST enabled. | Explorer wrapper checks it. |
| bank supply works | `smoke-api-surface.sh` checks `/cosmos/bank/v1beta1/supply` | PASS | Requires REST enabled. | Explorer wrapper checks it. |
| at least one tx-containing block can be produced | `lifecycle-e2e.sh` submits CoreSlot txs; `rewards-smoke.sh` submits a rewards claim tx | MOSTLY | These scripts are full drills and may own lifecycle/teardown. No minimal harmless bank-send helper found. | Use a documented tx-producing drill, or submit a small bank send from a funded operator account manually. |
| localnet can be reset | `scripts/localnet/stop.sh`, `scripts/localnet/init.sh` wipes `$TWILIGHT_LOCALNET_HOME` | PASS | None. | Use stop/init for reset. |
| command can run from explorer repo | Chain commands require `cd <path-to-nyks-core>`; explorer wrapper runs from explorer repo | PASS | Two-repo workflow. | Document exact directories and commands. |
| API surface smoke exists | `make api-smoke` / `scripts/smoke-local.sh` | PASS | Self-contained script tears down localnet. | Use it to validate API wiring separately; use manual localnet for explorer ingestion. |

## 4. Exact Local Chain Start Commands

Manual REST-enabled localnet that remains running for explorer smoke:

```sh
cd <path-to-nyks-core>
export TWILIGHT_LOCALNET_HOME=<twilight-localnet-home>
export CHAIN_ID=twilight-localnet-1
scripts/localnet/stop.sh || true
scripts/localnet/init.sh

# Enable REST and Swagger on node0 before start.
A="$TWILIGHT_LOCALNET_HOME/node0/config/app.toml"
sed -i.bak '/^\[api\]/,/^\[/ s/^enable = false/enable = true/; /^\[api\]/,/^\[/ s/^swagger = false/swagger = true/' "$A"
rm -f "$A.bak"

scripts/localnet/start.sh
```

Wait for blocks:

```sh
curl -s http://localhost:26657/status | jq '.result.sync_info'
```

Optional API surface validation:

```sh
BASE_REST=http://localhost:1317 BASE_RPC=http://localhost:26657 BASE_GRPC=localhost:9090 scripts/smoke-api-surface.sh
BASE_REST=http://localhost:1317 scripts/smoke-swagger-api.sh
```

Reset/stop:

```sh
cd <path-to-nyks-core>
scripts/localnet/stop.sh
rm -rf <twilight-localnet-home>
```

Self-contained API smoke, useful for route validation but not for explorer ingestion because it tears down:

```sh
cd <path-to-nyks-core>
make api-smoke
```

## 5. Endpoint Verification Commands

```sh
curl -s http://localhost:26657/status | jq .
curl -s http://localhost:26657/block | jq .
curl -s http://localhost:26657/block_results | jq .
curl -s 'http://localhost:1317/cosmos/tx/v1beta1/txs?query=tx.height=1' | jq .
curl -s http://localhost:1317/cosmos/base/tendermint/v1beta1/node_info | jq .
curl -s http://localhost:1317/cosmos/bank/v1beta1/supply | jq .
```

The chain API smoke also verifies:

- all `x/rewards` custom REST routes are wired
- all `x/coreslot` custom REST routes are wired
- `node_info` and bank supply return `200`
- standard staking, governance, mint, and distribution routes are intentionally absent

## 6. Explorer Postgres Setup Commands

From the explorer repo:

```sh
cd <path-to-twilight-core-explorer>
docker compose up -d postgres
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public node scripts/wait-for-postgres.js
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public npm run db:deploy
```

Optional clean smoke DB:

```sh
TEST_DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer_test?schema=public npm run db:reset:test
```

## 7. Indexer Smoke Command

Explorer-side wrapper added:

```sh
cd <path-to-twilight-core-explorer>
CHAIN_ID=twilight-localnet-1 \
COMET_RPC_URL=http://localhost:26657 \
REST_URL=http://localhost:1317 \
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public \
scripts/smoke-local-ingestion.sh
```

With explicit range:

```sh
START_HEIGHT=5 END_HEIGHT=20 scripts/smoke-local-ingestion.sh
```

The wrapper:

- assumes local Twilight chain is already running
- assumes Postgres is reachable
- checks `/status`, `/block`, `/block_results`, `node_info`, bank supply, and tx REST query by height
- deploys Prisma migrations
- runs the indexer over the selected range
- reruns the same range to prove idempotency
- prints DB row counts
- fails if no `ExplorerTransaction` rows exist in the selected range

## 8. Idempotency Rerun Command

The wrapper reruns the same range automatically. Manual equivalent:

```sh
START_HEIGHT=5 END_HEIGHT=20 npm --prefix apps/indexer start
START_HEIGHT=5 END_HEIGHT=20 npm --prefix apps/indexer start
```

Use:

```sh
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public node scripts/db-counts.js
```

to verify counts do not duplicate.

## 9. DB Count Inspection Command

Added:

```sh
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public node scripts/db-counts.js
```

It prints counts for:

- `Block`
- `ExplorerTransaction`
- `Message`
- `Event`
- `Account`
- `IndexerCursor`
- `DecodeFailure`

It also prints recent cursor rows with stringified heights.

## 10. Expected Pass/Fail Criteria

PASS when:

- local chain is running and producing blocks
- RPC `/status`, `/block`, and `/block_results` respond
- REST `node_info`, bank supply, and tx query by height respond
- selected range includes at least one empty block and one tx-containing block
- indexer completes first run
- indexer completes second run over the same range
- cursor reaches `END_HEIGHT`
- DB has at least one `Block`, `Event`, and `ExplorerTransaction`
- no stale active-slots route appears
- no unsupported standard-module route is used by explorer code

FAIL when:

- REST is not enabled
- `/block_results` is unavailable
- selected range has no tx-containing block
- cursor does not reach `END_HEIGHT`
- rerun duplicates rows or causes hash mismatch
- stale active-slots route or unsupported standard-module dependencies appear

## 11. Known Gaps

- No minimal chain-side "produce harmless bank send and leave localnet running" script was found.
- `scripts/smoke-local.sh` enables REST+Swagger and validates API surface, but tears down localnet when finished.
- The generic `scripts/localnet/init.sh` + `start.sh` path does not enable REST on node0 without the documented `sed`.
- A/B-4 smoke was prepared but not run in this pass because the task is audit/integration-prep first.

Smallest useful future chain-side improvement:

- Add a chain repo script such as `scripts/localnet/enable-api.sh`.
- Add a chain repo script such as `scripts/localnet/send-bank-tx.sh` or `scripts/localnet/produce-tx.sh` that submits one harmless bank send from a funded localnet operator account and prints the inclusion height.

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
