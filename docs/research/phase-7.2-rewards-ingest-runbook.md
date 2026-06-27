# Phase 7.2 — Rewards Fixture → Explorer Ingest Runbook

**Status: Runbook.** Date: 2026-06-27. Populates a **separate** explorer DB
(`twilight_explorer_rewards`, path B) from the `rewards-fixture.sh` localnet, so the Phase 12
rewards/claims/supply endpoints return real data. Keeps the existing CoreSlot/liveness fixture
(`twilight_explorer`) untouched.

## Step 0 — VERIFY you are pointed at the rewards fixture (not the default localnet)

The fixture and the default localnet share ports, so it's easy to ingest the wrong chain. **Confirm
all three** before ingesting:

```sh
# 1. chain-id must be the fixture's, NOT twilight-localnet-1
curl -fsS http://127.0.0.1:26657/status | jq -r '.result.node_info.network'
#   expect: twilight-rewards-fixture-1   (if you see twilight-localnet-1 -> wrong chain, see below)

# 2. REST must be up on 1317
curl -fsS -o /dev/null -w "REST %{http_code}\n" http://127.0.0.1:1317/cosmos/base/tendermint/v1beta1/blocks/latest

# 3. the fixture script's READY banner must have printed two non-empty claim tx hashes.
```

If chain-id is `twilight-localnet-1` (the default localnet) you're on the wrong chain. Fix:
```sh
cd ~/Github/nyks-core
TWILIGHT_LOCALNET_HOME=/tmp/twilight-localnet scripts/localnet/stop.sh   # stop the default localnet (frees 26657)
./scripts/localnet/rewards-fixture.sh                                    # run the real fixture; wait for the READY banner
```

## Step 1 — Environment

```sh
cd ~/Github/twilight-core-explorer
export COMET_RPC_URL=http://127.0.0.1:26657
export REST_URL=http://127.0.0.1:1317
export DATABASE_URL='postgresql://twilight:twilight@localhost:5432/twilight_explorer_rewards?schema=public'
```

## Step 2 — Create + migrate the separate rewards DB

```sh
PGPASSWORD=twilight createdb -h localhost -U twilight twilight_explorer_rewards 2>/dev/null || true
npm run db:generate
npm run db:deploy          # applies prisma migrations to twilight_explorer_rewards
```

## Step 3 — Ingest the fixture range

```sh
# final height from the fixture banner (or: curl .../status | jq -r .result.sync_info.latest_block_height)
START_HEIGHT=1 END_HEIGHT=<final_height> npm --prefix apps/indexer run start
```

## Step 4 — Project (order matters)

For Phase 12 (rewards) the required chain is CoreSlot identity + rewards + the sampled snapshots.
Liveness is **optional** here (only needed if you also want this fixture's liveness pages populated).

```sh
# CoreSlot semantic layer (slot identity that /coreslots/{slotId}/rewards needs).
# On reset/startHeight<=1 the metadata step now also SEEDS genesis CoreSlot identity from
# getGenesis() (Phase 7.2 F1) — without it, genesis-created slots have no CoreSlotProjection
# row and the rewards snapshot/operator pages come up empty.
RESET_PROJECTION=true npm --prefix apps/indexer run project:coreslot-semantic
#   (combined replay: metadata(+genesis seed) -> lifecycle -> payout -> params -> key_rotation -> temporal_map)

# Rewards + observed samples. ORDER MATTERS (the snapshot's SlotRewardProjection is co-owned):
#   a rewards reset wipes SlotRewardProjection, and the claim reconciliation (claimTxHash +
#   clearing missing_reward_records) needs snapshot rows to already exist. So:
npm --prefix apps/indexer run project:rewards            # epochs + claims (1st pass: 2 expected missing_reward_records)
npm --prefix apps/indexer run project:rewards-snapshot   # SlotRewardProjection (claimed + claimedAtHeight); height-pinned to the sample height
# reconcile pass: replay the claim projection over the now-present snapshot rows to stitch
# claimTxHash and clear the expected first-pass failures (clear only the semantic cursor, NOT a reset):
psql "$DATABASE_URL" -c "delete from \"ProjectionCursor\" where \"projectionName\"='rewards_semantic_v1';"
npm --prefix apps/indexer run project:rewards            # 2nd pass reconciles onto snapshot rows -> 0 failures
npm --prefix apps/indexer run project:balance-snapshot   # supply + account balances; height-pinned

# Note: sampled REST reads are now height-pinned (x-cosmos-block-height) to the ingest max block,
# so samples reflect that height honestly even if the localnet keeps minting past it.

# OPTIONAL — liveness pages on this fixture (needs the height-1 temporal-map genesis seed first,
# per coverage-truth-genesis-gap). Skip for a rewards-only Phase 12 validation.
#   ... 8c-0b genesis seed -> 8a/8b signature ingest -> 8c liveness/health
```

## Step 5 — Boot the API + verify acceptance

```sh
DATABASE_URL="$DATABASE_URL" PORT=8080 npm --prefix apps/api run dev   # background it
```
Then confirm real data (EPOCH_LENGTH=10 → emission/epoch 4,161,900; per-slot 1,040,475):
```sh
curl -s http://localhost:8080/api/v1/rewards/epochs        | jq '.data | length, .data[0]'   # >=1 finalized epoch
curl -s http://localhost:8080/api/v1/coreslots/1/rewards   | jq '.data[] | {epochNumber, amount, claimed}'  # claimed:true rows
curl -s http://localhost:8080/api/v1/rewards/claims        | jq '.data | length, .data[0]'   # the claim events
curl -s http://localhost:8080/api/v1/supply                | jq '.data'                       # 2,000,00X,XXX,XXX utwlt
curl -s http://localhost:8080/api/v1/rewards/balances      | jq '.data | length'              # sampled module balance
```
**Acceptance:** epochs non-empty + finalized; `/coreslots/1/rewards` shows `claimed:true` with
`claimedAtHeight`/`claimTxHash`; `/rewards/claims` has the claim rows; `/supply` reflects emission.

## Step 6 — Point the web app at the rewards DB (for Phase 12 dev)

The API already reads `twilight_explorer_rewards` via the env above; the web app reads it through the
API. Run the web dev server as usual (`NEXT_PUBLIC_API_BASE_URL=http://localhost:8080`).

## Step 7 — Teardown

```sh
# explorer API: stop the dev process
# rewards localnet:
TWILIGHT_LOCALNET_HOME=/tmp/twilight-rewards-fixture ~/Github/nyks-core/scripts/localnet/stop.sh
# the separate DB can be dropped or kept for Phase 12 dev:
# PGPASSWORD=twilight dropdb -h localhost -U twilight twilight_explorer_rewards
```

## Notes / gotchas

- **REST is mandatory** for `rewards-snapshot` + `balance-snapshot` (supply/balances samples). Rewards
  *events* (epochs/claims/slot-rewards) come from RPC `/block_results` and populate without REST.
- **claimant ≠ payout:** the fixture signs slot-1 claims with `operator1` while the payout is
  `operator0` — `/rewards/claims.claimant` is the signer; the UI must not assume signer == payout.
- **Separate DB on purpose (path B):** keeps the canonical `twilight_explorer` (CoreSlot/liveness
  fixture) intact. Consolidate to one rewards-complete canonical fixture AFTER Phase 12 is built.
- If `project:rewards-snapshot`/`balance-snapshot` error on a REST route (e.g. a 501 on a rewards query
  path), the rewards *events* still populate — capture the failing path and treat the sampled surfaces
  as a follow-up rather than blocking the epochs/claims validation.
