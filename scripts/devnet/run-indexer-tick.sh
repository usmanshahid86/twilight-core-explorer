#!/usr/bin/env bash
# run-indexer-tick.sh — the forward-incremental engine, in one of three MODES:
#   MODE=ingest   ingest cursor+1…tip (the chain → canonical rows)
#   MODE=project  advance every projection (canonical rows → semantic projections + snapshots)
#   MODE=all      ingest then project, in one pass (default; fine when ingest keeps pace)
#
# Why split ingest from project: the FIRST backfill of a large chain is one long ingest. If projections
# only ran AFTER it (MODE=all), the semantic UI would stay empty until the whole backfill finished. Run
# them as TWO cadenced loops instead — ingest races ahead, the projector follows — and the UI fills in
# PROGRESSIVELY. The two use independent ProjectionCursors and advisory locks, so they're safe to run
# concurrently. This also matches the AWS shape (separate ingest task vs projection cadence).
#
# Each step is cursor-resume + advisory-locked → only ever processes NEW data; a crashed/overlapping run
# is safe to repeat. No global `set -e`: a single projection failing is transient (retried next tick) and
# must not abort the pipeline; only a failed ingest short-circuits an ingest tick.
#
#   one pass:  MODE=project COMET_RPC_URL=… REST_URL=… CHAIN_ID=twilight-devnet-1 DATABASE_URL=… \
#              scripts/devnet/run-indexer-tick.sh
#   loop:      MODE=ingest TICK_LOOP=true TICK_INTERVAL_SECONDS=15 …  scripts/devnet/run-indexer-tick.sh
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

: "${DATABASE_URL:?set DATABASE_URL (Prisma form, e.g. postgres://…?schema=public)}"
# the explorer config requires http(s):// — the chain CLI emits tcp://. Accept either, normalize.
export COMET_RPC_URL="$(sed -E 's#^tcp://#http://#' <<<"${COMET_RPC_URL:-http://127.0.0.1:26657}")"
export REST_URL="${REST_URL:-http://127.0.0.1:1317}"
MODE="${MODE:-all}"
INTERVAL="${TICK_INTERVAL_SECONDS:-20}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing required command: $1" >&2; exit 2; }; }
need curl; need jq; need npm

status_json() { curl -fsS --max-time 10 "$COMET_RPC_URL/status" 2>/dev/null; }
tip() { status_json | jq -r '.result.sync_info.latest_block_height' 2>/dev/null; }

# CHAIN_ID must MATCH the node or the indexer's chain-id guard aborts ingest (an unset CHAIN_ID
# silently defaults to twilight-localnet-1). Resolve it from the node when not set explicitly.
if [[ -z "${CHAIN_ID:-}" ]]; then
  CHAIN_ID="$(status_json | jq -r '.result.node_info.network' 2>/dev/null)"
  if [[ -n "$CHAIN_ID" && "$CHAIN_ID" != null ]]; then export CHAIN_ID
  else echo "could not resolve CHAIN_ID from $COMET_RPC_URL — set it explicitly" >&2; exit 2; fi
fi
export CHAIN_ID

# ── ingest: cursor+1…tip. The FIRST run backfills genesis…tip (the one long run); later runs are
#    incremental. A failed ingest just retries next tick (cursor-resume).
ingest_tick() {
  local TIP; TIP="$(tip)"
  if ! [[ "$TIP" =~ ^[0-9]+$ ]]; then echo "WARN: no chain tip from $COMET_RPC_URL — skip ingest tick"; return 0; fi
  echo "== ingest tick: chain_id=$CHAIN_ID tip=$TIP =="
  npm --prefix apps/indexer run start || echo "WARN: ingest failed (retry next tick)"
}

# ── project: advance every projection over whatever has been ingested so far (runbook §6 order, forward
#    cursor, NO reset). Snapshots are OBSERVED samples → they query a live node pinned to the tip and
#    need REST up; if the tip can't be read we skip ONLY the snapshots (the rest still advances).
project_tick() {
  local TIP; TIP="$(tip)"; [[ "$TIP" =~ ^[0-9]+$ ]] || TIP=""
  echo "== project tick (tip=${TIP:-unknown}) =="
  P() { echo "-- project:$1"; npm --prefix apps/indexer run "project:$1" || echo "WARN: project:$1 failed (retry next tick)"; }

  # CoreSlot semantics: the SIX individual forward-incremental projectors in the load-bearing order —
  # NOT the combined `project:coreslot-semantic` CLI (reset-only full rebuild; aborts a non-reset run
  # without START_HEIGHT). On the first pass (empty cursor → startHeight 1) the metadata + temporal-map
  # projectors seed the genesis CoreSlots automatically (shouldSeedGenesis when startHeight <= 1).
  P coreslot-metadata
  P coreslot-lifecycle
  P coreslot-payout
  P coreslot-params
  P coreslot-key-rotation
  P coreslot-temporal-map
  P block-signatures
  P operator-signing-evidence
  P coreslot-liveness
  P coreslot-liveness-summary
  P coreslot-health
  P proposer-attribution

  # rewards: process new claims FIRST, then snapshot+reconcile (clears transient missing_reward_records),
  # then balance snapshot.
  P rewards
  if [[ -n "$TIP" ]]; then
    SAMPLE_HEIGHT="$TIP" P rewards-snapshot
    SAMPLE_HEIGHT="$TIP" P balance-snapshot
  else
    echo "WARN: skipping rewards/balance snapshots — need a live SAMPLE_HEIGHT (tip unreadable)"
  fi
}

run_once() {
  case "$MODE" in
    ingest)  ingest_tick ;;
    project) project_tick ;;
    all)     ingest_tick; project_tick ;;
    *) echo "unknown MODE=$MODE (use ingest|project|all)" >&2; exit 2 ;;
  esac
}

if [[ "${TICK_LOOP:-false}" == "true" || "${1:-}" == "--loop" ]]; then
  echo "== run-indexer-tick: MODE=$MODE, LOOP every ${INTERVAL}s (Ctrl-C / docker stop to halt) =="
  while true; do run_once; sleep "$INTERVAL"; done
else
  run_once
fi
