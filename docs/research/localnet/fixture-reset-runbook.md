# Localnet Fixture Reset + End-to-End Runbook (through Phase 8c)

Date: 2026-06-26

Purpose: rebuild a clean, contiguous, fully-attributable 4-CoreSlot localnet fixture and exercise the
**entire liveness backend stack end to end**:

```
ingest → block_signatures_v1 (8a) → operator_signing_evidence_v1 (8b)
       → coreslot_temporal_map_v1 genesis seed (8c-0b)
       → coreslot_liveness_v1 (8c-1) → coreslot_liveness_summary_v1 (8c-2)
       → coreslot_health_v1 (8c-3)
```

Plus the one-node liveness drill (8c-0c) that produces real missed signatures so the whole chain has
something to attribute, summarize, and label.

Everything below is reproducible from genesis + contiguous blocks. The only non-tx input is genesis
(`/genesis`), read through `ChainClient` — natural chain data, not DB manipulation. **Do not** hand-edit
explorer rows; reset the DB only at the start, then let projections rebuild from generic rows.

────────────────────────────────

## 0. Conventions / env

```sh
export CHAIN_REPO=/Users/quasar/Github/nyks-core
export EXPLORER_REPO=/Users/quasar/Github/twilight-core-explorer
export TWILIGHT_LOCALNET_HOME=/tmp/twilight-localnet
export CHAIN_ID=twilight-localnet-1

export COMET_RPC_URL=http://127.0.0.1:26657
export REST_URL=http://127.0.0.1:1317
export DATABASE_URL='postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public'
export PG='postgresql://twilight:twilight@localhost:5432/twilight_explorer'   # psql form, no ?schema
export PSQL='/Applications/Postgres.app/Contents/Versions/latest/bin/psql'
```

BFT quorum note (4 validators, equal power 1): the chain stays live with **3** signers. Stopping **1**
node = liveness drill (chain advances; that node's commits go absent → network `warning`). Stopping
**2** = the chain **halts** (would demo network `critical`, but produces no new blocks to attribute).

────────────────────────────────

## Part A — Rebuild the chain with 4 genesis CoreSlot operators (chain side)

> The invariant that matters for the explorer: `genesis.app_state.coreslot.slots` must contain **4
> slots, each `SLOT_STATUS_ACTIVE` with a bound consensus pubkey**, so the Phase 8c-0b seed opens 4
> windows from height 1.

```sh
cd "$CHAIN_REPO"
scripts/localnet/stop.sh || true
scripts/localnet/init.sh

# enable REST/swagger on node0 (REST is optional for liveness; ingest uses RPC)
A="$TWILIGHT_LOCALNET_HOME/node0/config/app.toml"
sed -i.bak '/^\[api\]/,/^\[/ s/^enable = false/enable = true/; /^\[api\]/,/^\[/ s/^swagger = false/swagger = true/' "$A"
rm -f "$A.bak"

scripts/localnet/start.sh
sleep 10
```

Verify the premise (4 validators + 4 ACTIVE genesis CoreSlots):

```sh
curl -s "$COMET_RPC_URL/status" | jq '.result.sync_info'
curl -s "$COMET_RPC_URL/validators?height=10&per_page=100" | jq '.result.validators | length'   # 4
curl -s "$COMET_RPC_URL/genesis" \
  | jq '.result.genesis.app_state.coreslot.slots[] | {slot_id,status,operator_address,consensus_pubkey}'
# expect 4 slots, all SLOT_STATUS_ACTIVE, each with an ed25519 consensus_pubkey
```

(If genesis is large, CometBFT returns a "use genesis_chunked" error — expected; the 8c-0b
`getGenesis()` already supports `/genesis_chunked`.)

────────────────────────────────

## Part B — Reset the explorer database

```sh
cd "$EXPLORER_REPO"
$PSQL "$PG" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
npm install
npm run db:generate
npm run db:deploy
npm run build
```

────────────────────────────────

## Part C — Contiguous ingest from height 1 (baseline)

```sh
TIP=$(curl -s "$COMET_RPC_URL/status" | jq -r '.result.sync_info.latest_block_height')
START_HEIGHT=1 END_HEIGHT="$TIP" npm --prefix apps/indexer run start

# assert contiguity (count == max-min+1, no gaps)
$PSQL "$PG" -tAc 'select min(height), max(height), count(*), (max(height)-min(height)+1)=count(*) as contiguous from "Block";'
```

────────────────────────────────

## Part D — Rebuild every projection in order

```sh
cd "$EXPLORER_REPO"

# 1) CoreSlot semantic set — metadata → lifecycle → payout → params → key_rotation → temporal_map.
#    The temporal_map step performs the genesis seed (8c-0b step 0) then replays event deltas.
RESET_PROJECTION=true npm --prefix apps/indexer run project:coreslot-semantic

# 2) Block signatures (8a)
RESET_PROJECTION=true npm --prefix apps/indexer run project:block-signatures

# 3) Signature → CoreSlot attribution (8b)
RESET_PROJECTION=true npm --prefix apps/indexer run project:operator-signing-evidence

# 4) Per-height liveness evidence (8c-1)
RESET_PROJECTION=true npm --prefix apps/indexer run project:coreslot-liveness

# 5) Liveness summaries (8c-2)
RESET_PROJECTION=true npm --prefix apps/indexer run project:coreslot-liveness-summary

# 6) Health + network halt-risk (8c-3)
RESET_PROJECTION=true npm --prefix apps/indexer run project:coreslot-health
```

Baseline (all 4 up, no drill yet) sanity — every active CoreSlot should be healthy:

```sh
$PSQL "$PG" -tAc 'select count(*) from "CoreSlotConsensusWindow" where "openedByKind"='"'"'genesis'"'"' and "effectiveFromHeight"=1;'   # 4
$PSQL "$PG" -tAc 'select "healthStatus", count(*) from "CoreSlotHealthSnapshot" group by 1;'                                              # healthy|4
$PSQL "$PG" -tAc 'select "haltRiskLevel","haltRiskReason" from "NetworkLivenessRiskSnapshot";'                                           # normal|all_healthy
```

────────────────────────────────

## Part E — One-node liveness drill (8c-0c): produce real missed signatures

This makes one CoreSlot miss a bounded run of committed heights, then recover. First record which
slot a node maps to (so you know what should go absent):

```sh
# node3's consensus address (lowercased) → match it to a CoreSlotConsensusWindow.consensusAddress/slotId
jq -r '.address' "$TWILIGHT_LOCALNET_HOME/node3/config/priv_validator_key.json" | tr 'A-Z' 'a-z'
$PSQL "$PG" -tAc 'select "slotId","consensusAddress" from "CoreSlotConsensusWindow" order by "slotId";'
```

Stop exactly ONE node, let the chain run on 3/4, then restart it:

```sh
cd "$CHAIN_REPO"
BEFORE=$(curl -s "$COMET_RPC_URL/status" | jq -r '.result.sync_info.latest_block_height')
echo "stopping node3 after height $BEFORE"

kill "$(cat "$TWILIGHT_LOCALNET_HOME/node3.pid")"
rm -f "$TWILIGHT_LOCALNET_HOME/node3.pid"

sleep 75   # ~15+ blocks down → an unambiguous miss window
DOWN_TIP=$(curl -s "$COMET_RPC_URL/status" | jq -r '.result.sync_info.latest_block_height')
echo "node3 down across roughly committed heights $((BEFORE+1))..$DOWN_TIP"

# restart node3 (single line; avoids the dquote trap), record pid, let it catch up
./build/twilightd start --home "$TWILIGHT_LOCALNET_HOME/node3" --minimum-gas-prices 0utwlt --log_no_color >>"$TWILIGHT_LOCALNET_HOME/logs/node3.log" 2>&1 &
echo $! > "$TWILIGHT_LOCALNET_HOME/node3.pid"
ps -p "$(cat "$TWILIGHT_LOCALNET_HOME/node3.pid")" -o pid,etime,command | cat
tail -n 15 "$TWILIGHT_LOCALNET_HOME/logs/node3.log"   # height should climb back toward the tip
```

Re-ingest the new heights and rerun the projection chain (incremental ingest; full projection reset):

```sh
cd "$EXPLORER_REPO"
LAST=$($PSQL "$PG" -tAc 'select coalesce(max(height),0) from "Block";')
TIP=$(curl -s "$COMET_RPC_URL/status" | jq -r '.result.sync_info.latest_block_height')
START_HEIGHT=$((LAST+1)) END_HEIGHT="$TIP" npm --prefix apps/indexer run start

RESET_PROJECTION=true npm --prefix apps/indexer run project:coreslot-semantic
RESET_PROJECTION=true npm --prefix apps/indexer run project:block-signatures
RESET_PROJECTION=true npm --prefix apps/indexer run project:operator-signing-evidence
RESET_PROJECTION=true npm --prefix apps/indexer run project:coreslot-liveness
RESET_PROJECTION=true npm --prefix apps/indexer run project:coreslot-liveness-summary
RESET_PROJECTION=true npm --prefix apps/indexer run project:coreslot-health
```

> Key empirical fact (8c-0c): an absent validator is **anonymous** in the commit (flag-1 ABSENT
> carries an empty validator_address). Misses are recovered by set-difference (expected active
> CoreSlots minus flag-2 signed), never read off a flag. The downed slot's miss window is whatever the
> data shows, not the wall-clock kill time (absence lags the kill by ~3 blocks).

────────────────────────────────

## Part F — End-to-end verification checklist

Reference numbers below are from the accepted drill (heights 1..361 → 360 committed heights, slot 4
down across committed 296–348 then recovered). Your exact counts depend on how long node3 was down;
the **shapes** are what must hold.

### Block contiguity
```sh
$PSQL "$PG" -tAc 'select (max(height)-min(height)+1)=count(*) as contiguous from "Block";'   # t
```

### 8c-0b genesis seed
```sh
$PSQL "$PG" -tAc 'select count(*) from "CoreSlotConsensusWindow" where "openedByKind"='"'"'genesis'"'"' and "effectiveFromHeight"=1;'   # 4
```

### 8a — BlockSignature flag shape (absent entries are anonymous)
```sh
$PSQL "$PG" -tAc 'select "blockIdFlagCode","signed",(coalesce("validatorAddress",'"''"')='"''"') as empty_addr,count(*) from "BlockSignature" group by 1,2,3 order by 1,2;'
# flag 1 (ABSENT) rows have empty_addr = t; flag 2 (COMMIT) signed = t; flag 3 (NIL) carries an address
```

### 8b — attribution (1:1 with BlockSignature, 0 unresolved failures)
```sh
$PSQL "$PG" -tAc 'select "attributionStatus", count(*) from "OperatorSigningEvidence" group by 1 order by 2 desc;'
$PSQL "$PG" -tAc 'select (select count(*) from "BlockSignature")=(select count(*) from "OperatorSigningEvidence");'   # t
$PSQL "$PG" -tAc 'select count(*) from "ProjectionFailure" where "projectionName"='"'"'operator_signing_evidence_v1'"'"' and resolved=false;'   # 0
```

### 8c-1 — per-height liveness evidence (set-difference; reference 1440 / 1399 / 41)
```sh
$PSQL "$PG" -tAc 'select status,count(*) from "CoreSlotLivenessEvidence" group by 1 order by 1;'                    # signed 1399 / missed 41
$PSQL "$PG" -tAc 'select "slotId","missCause",count(*) from "CoreSlotLivenessEvidence" where status='"'"'missed'"'"' group by 1,2 order by 1,2;'   # slot 4: absent 39, nil 2
$PSQL "$PG" -tAc 'select count(*) from "ProjectionFailure" where "projectionName"='"'"'coreslot_liveness_v1'"'"' and resolved=false;'   # 0
```

### 8c-2 — summaries (16 rows = 4 slots × 4 windows; uptime in bps)
```sh
$PSQL "$PG" -tAc 'select "slotId","windowKind","expectedCount","signedCount","missedCount","uptimeBps","summaryStatus" from "CoreSlotLivenessSummary" where "windowKind" in ('"'"'lifetime'"'"','"'"'recent_100'"'"') order by "slotId","windowKind";'
# slots 1/2/3: uptime 10000 everywhere; slot 4 lifetime 8861, recent_100 5900 (depends on miss window)
$PSQL "$PG" -tAc 'select count(*) from "ProjectionFailure" where "projectionName"='"'"'coreslot_liveness_summary_v1'"'"' and resolved=false;'   # 0
```

### 8c-3 — health + network halt-risk
```sh
$PSQL "$PG" -tAc 'select "slotId","healthStatus","healthReason","uptimeBps","currentMissedStreak","isActiveAtLatest" from "CoreSlotHealthSnapshot" order by "slotId";'
# slots 1/2/3 healthy; slot 4 degraded (recovered → currentMissedStreak 0) or down (if still missing, streak >= 10)
$PSQL "$PG" -tAc 'select "haltRiskLevel","haltRiskReason","activeSlotCount","healthySlotCount","degradedSlotCount","downSlotCount","availablePowerBps" from "NetworkLivenessRiskSnapshot";'
# one degraded/down active slot → warning (availablePowerBps stays 10000 if degraded, 7500 if 1 down)
$PSQL "$PG" -tAc 'select count(*) from "ProjectionFailure" where "projectionName"='"'"'coreslot_health_v1'"'"' and resolved=false;'   # 0
```

Expected invariants on a healthy clean fixture after the drill:
- Blocks contiguous from 1 to tip; 4 genesis windows at `effectiveFromHeight = 1`.
- `OperatorSigningEvidence` 1:1 with `BlockSignature`; absent entries anonymous (8b `absent_no_validator`).
- `CoreSlotLivenessEvidence`: missed rows only for the downed slot; `signed + missed == 4 × committed-heights`.
- Summaries: `signed + missed == expected`, `absent + nil == missed`; downed slot uptime < 10000.
- Health: only the downed slot is degraded/down; all others healthy; network `warning` (or `critical`
  only if ≥ 2 slots down → chain would have halted, so not reachable from a single-node drill).
- Zero unresolved `ProjectionFailure` for every `*_v1` projection.

### Full validation ritual
```sh
cd "$EXPLORER_REPO"
npm run db:generate && npm run typecheck && npm test && npm run lint
npm --prefix apps/indexer test
npm --prefix packages/chain-client test
DATABASE_URL="$DATABASE_URL" npm run db:deploy
```

────────────────────────────────

## Optional drills (for future fixtures)

- **Network critical:** stop 2 of 4 nodes briefly — the chain halts (no new blocks), but demonstrates
  the halt condition. Not attributable while halted.
- **Key rotation mid-outage:** rotate one operator's consensus key while another is down — live-exercises
  the temporal `validatorUpdateHeight + 2` boundary and the 8c-1 `observed_attributed_slot_not_expected`
  guard.

## Notes & caveats

- `REST_URL` (1317) is sometimes down/partial on this chain; ingest, genesis seed, and the whole 8a–8c
  stack rely only on RPC (`/block`, `/block_results`, `/genesis`). REST is needed only for observed-sample
  snapshots (rewards), not for liveness.
- Node repo + localnet tooling live in `nyks-core` (`scripts/localnet/{stop,init,start}.sh`,
  `./build/twilightd`). Localnet home is `/tmp/twilight-localnet`; logs in `.../logs`.
- Combined corrections replay globally — when correcting boundaries, reset + replay over the FULL
  indexed range, never a partial slice.
