#!/usr/bin/env bash
# Phase 13d-3 — explorer soak: ingest the driven range + rebuild every projection in the
# load-bearing order, then sanity-check. Run from the explorer repo AFTER drive-localnet.sh,
# with the soak chain STILL RUNNING (the rewards/balance snapshots query a live node, pinned
# to the end height). Pairs with scripts/soak/drive-localnet.sh.
#
#   COMET_RPC_URL=tcp://127.0.0.1:26657 REST_URL=http://127.0.0.1:1317 \
#   DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public \
#   TWILIGHT_LOCALNET_HOME=/tmp/twilight-soak  scripts/soak/ingest-project.sh
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

: "${DATABASE_URL:?set DATABASE_URL (Prisma form, e.g. postgres://...?schema=public)}"
export COMET_RPC_URL="${COMET_RPC_URL:-http://127.0.0.1:26657}"
# the explorer config requires http(s):// — the chain CLI uses tcp://. Normalize so either is accepted.
export COMET_RPC_URL="$(sed -E 's#^tcp://#http://#' <<<"$COMET_RPC_URL")"
export REST_URL="${REST_URL:-http://127.0.0.1:1317}"
NET="${TWILIGHT_LOCALNET_HOME:-/tmp/twilight-soak}"
RESET_DB="${RESET_DB:-false}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing required command: $1" >&2; exit 2; }; }
need curl; need jq

# End height: explicit env > the file the drive wrote > current tip. The snapshots PIN to it.
http_rpc="$(sed -E 's#^tcp://#http://#' <<<"$COMET_RPC_URL")"
tip() { curl -fsS "$http_rpc/status" 2>/dev/null | jq -r '.result.sync_info.latest_block_height|tonumber' 2>/dev/null || echo 0; }
# CHAIN_ID must MATCH the node or the indexer's chain-id guard aborts ingest. Derive it from the node
# (node_info.network) unless set explicitly, so it can't drift from whatever chain-id the drive created.
export CHAIN_ID="${CHAIN_ID:-$(curl -fsS "$http_rpc/status" 2>/dev/null | jq -r '.result.node_info.network' 2>/dev/null)}"
[[ -n "$CHAIN_ID" && "$CHAIN_ID" != null ]] || { echo "could not resolve CHAIN_ID from $http_rpc — set it explicitly" >&2; exit 2; }
END_HEIGHT="${END_HEIGHT:-$( [[ -f "$NET/soak-end-height.txt" ]] && cat "$NET/soak-end-height.txt" || tip )}"
[[ "$END_HEIGHT" =~ ^[0-9]+$ && "$END_HEIGHT" -gt 0 ]] || { echo "could not resolve END_HEIGHT" >&2; exit 2; }
export SAMPLE_HEIGHT="$END_HEIGHT"
echo "== soak ingest+project: chain_id=$CHAIN_ID end_height=$END_HEIGHT rpc=$COMET_RPC_URL rest=$REST_URL =="

# psql form of the URL (strip Prisma ?schema=...), used only for the optional sanity block.
PG="${PG:-$(sed -E 's#\?.*$##' <<<"$DATABASE_URL")}"
psql_q() { command -v psql >/dev/null 2>&1 && psql "$PG" -tAc "$1" 2>/dev/null; }

# Fail loudly on a real failure of a critical step. (No global `set -e`: the happy path is unchanged;
# these guards only fire on a failure the validated run never produced — so adding them needs no re-run.)
die() { echo "FATAL: $*" >&2; exit 1; }

if [[ "$RESET_DB" == "true" ]]; then
  # RESET_DB must actually reset — psql_q is best-effort (no-op without psql), so require psql here and
  # use a failing-on-error drop, or db:deploy would run against a dirty schema and mislead the soak.
  command -v psql >/dev/null 2>&1 || die "RESET_DB=true needs psql on PATH to drop/recreate the schema"
  echo "== RESET_DB: dropping + recreating public schema =="
  psql "$PG" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null || die "schema reset (DROP/CREATE) failed"
  npm run db:deploy || die "db:deploy failed after reset"
fi

echo "== build (db:generate + workspaces) =="
npm run db:generate || die "db:generate failed"
npm --prefix apps/indexer run build || die "indexer build failed"

echo "== ingest 1..$END_HEIGHT =="
START_HEIGHT=1 END_HEIGHT="$END_HEIGHT" npm --prefix apps/indexer run start || die "ingest 1..$END_HEIGHT failed"

# Rebuildable semantic projections (runbook Part D order). RESET_PROJECTION=true rebuilds each.
proj() { echo "-- project:$1"; RESET_PROJECTION=true npm --prefix apps/indexer run "project:$1" || die "projection $1 failed"; }
proj coreslot-semantic            # metadata(+genesis CoreSlot identity seed)->lifecycle->payout->params->key_rotation->temporal_map(+genesis window seed)
proj block-signatures
proj operator-signing-evidence
proj coreslot-liveness
proj coreslot-liveness-summary
proj coreslot-health
proj proposer-attribution

# Rewards — load-bearing 7.2 order. The reset wipes the co-owned SlotRewardProjection, so the
# snapshot must repopulate it BEFORE the replay reconciles claims (claimTxHash / clears
# missing_reward_records). Snapshots are observed samples -> need a LIVE node pinned to SAMPLE_HEIGHT.
# Rewards claim reconciliation is snapshot-dependent: applyClaim marks claims against the OBSERVED
# SlotRewardProjection rows, so on a fresh rebuild those rows must exist BEFORE the semantic pass.
# Run the snapshot FIRST, then a SINGLE non-reset rewards pass reconciles every claim on first
# processing -> zero missing_reward_records. A reset on the rewards pass would wipe the co-owned
# snapshot rows, so it must NOT reset here. (13d-3 finding: the old reset->snapshot->replay order left
# the replay a cursor no-op — the cursor was already at the tip — so claims were never re-reconciled
# and the transient failures lingered as unresolved.)
echo "-- rewards-snapshot (live sample @ $SAMPLE_HEIGHT) — populates SlotRewardProjection FIRST"
npm --prefix apps/indexer run project:rewards-snapshot || die "rewards-snapshot failed"
echo "-- rewards (single pass, NO reset — reconciles claims against the snapshot rows)"
npm --prefix apps/indexer run project:rewards || die "rewards projection failed"
echo "-- balance-snapshot (live sample @ $SAMPLE_HEIGHT)"
npm --prefix apps/indexer run project:balance-snapshot || die "balance-snapshot failed"

# ---- sanity (optional; needs psql) -----------------------------------------------------------
echo; echo "== sanity =="
if command -v psql >/dev/null 2>&1; then
  echo "block contiguous (expect t)      : $(psql_q 'select (max(height)-min(height)+1)=count(*) from "Block";')"
  echo "blocks / txs / accounts          : $(psql_q 'select count(*) from "Block";') / $(psql_q 'select count(*) from "ExplorerTransaction";') / $(psql_q 'select count(*) from "Account";')"
  echo "tx status (success/failed)       : $(psql_q $'select status||\':\'||count(*) from "ExplorerTransaction" group by status order by status;' | paste -sd' ' -)"
  echo "genesis windows @ h1 (expect 4)  : $(psql_q $'select count(*) from "CoreSlotConsensusWindow" where "openedByKind"=\'genesis\' and "effectiveFromHeight"=1;')"
  echo "health snapshots                 : $(psql_q $'select "healthStatus"||\':\'||count(*) from "CoreSlotHealthSnapshot" group by "healthStatus" order by "healthStatus";' | paste -sd' ' -)"
  echo "reward epochs / claimed          : $(psql_q 'select count(*) from "RewardEpochProjection";') / $(psql_q $'select count(*) from "SlotRewardProjection" where claimed=true;')"
  unresolved="$(psql_q $'select coalesce(string_agg("projectionName"||\'=\'||c,\', \'),\'(none)\') from (select "projectionName",count(*) c from "ProjectionFailure" where resolved=false group by 1) s;')"
  echo "UNRESOLVED ProjectionFailure     : ${unresolved:-(none)}    <-- MUST be (none)"
else
  echo "(psql not found — skipping DB sanity; run the runbook Part F checks manually)"
fi

echo; echo "== done. next: RC_LIVE=1 API_DATABASE_URL=$DATABASE_URL npm run rc-check =="
