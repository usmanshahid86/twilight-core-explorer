#!/usr/bin/env bash
# Phase 13d-3 — explorer soak: drive a 4-node localnet to ~2,500 blocks with the full
# explorer-relevant activity mix, then STOP the chain so observed samples reflect a pinned
# height. Chain side only — ingest + projections are scripts/soak/ingest-project.sh.
#
# Hybrid activity mix (bank send was wired into the chain CLI via AutoCLI, PR #3):
#   * account breadth  <- `coreslot update-payout 1 <addr>` over a key pool (each address
#                         lands in a `payout` event attr -> an Account row; cheap, free, no balance).
#   * funded accounts + transfers + a decodable MsgSend <- a handful of real `tx bank send`
#                         operator0 -> pool addresses (transfer/coin_received/coin_spent events;
#                         decodes cleanly IFF the explorer descriptor includes bank Msg types).
#   * tx volume         <- the update-payout/update-metadata loop (free, authority-signed).
#   * balances/claims   <- `rewards claim` directs a slot's reward to its current payout addr.
#   * failed-but-committed txs <- double-claim + claim-while-paused (handlers run at DeliverTx,
#                         so a rejected claim is COMMITTED with code!=0).
#
# Quorum invariant (4 equal-power validators -> >2/3 = 3 signers): never overlap a node-down
# with an oversized active set. The 5th-CoreSlot add/remove and the key-rotation (node2 down)
# run inside P3 with all 4 nodes up; the sparse window (node3 down) runs in P4 on the 4-set.
#
# Reviewed-before-run: drives a live chain. CLI shapes verified against twilight-core build.
set -uo pipefail

# ---- knobs -----------------------------------------------------------------------------------
CHAIN_REPO="${CHAIN_REPO:-/Users/quasar/Github/twilight-core}"
BIN="${BIN:-$CHAIN_REPO/build/twilightd}"
NET="${TWILIGHT_LOCALNET_HOME:-/tmp/twilight-soak}"
CHAIN_ID="${CHAIN_ID:-twilight-soak-1}"
export BIN TWILIGHT_LOCALNET_HOME="$NET" CHAIN_ID

TARGET_HEIGHT="${TARGET_HEIGHT:-2500}"
EPOCH_LENGTH="${EPOCH_LENGTH:-50}"            # genesis rewards epoch length (blocks)
BLOCK_TIME="${BLOCK_TIME:-500ms}"             # timeout_commit per node (default chain value is 5s)
ACCOUNT_POOL="${ACCOUNT_POOL:-80}"            # distinct payout addresses to fan out -> ~this many Accounts
FILLER_EVERY="${FILLER_EVERY:-3}"             # min blocks between filler txs
SPARSE_WINDOW_BLOCKS="${SPARSE_WINDOW_BLOCKS:-150}"   # node3 down span (~1.5x the recent_100 health window)
SLOT5_DOWN_BLOCKS="${SLOT5_DOWN_BLOCKS:-20}"  # let the no-node 5th CoreSlot miss enough to read "down"
CLAIM_EVERY="${CLAIM_EVERY:-3}"               # claim every Nth finalized epoch (rest left unclaimed)
BANK_SENDS="${BANK_SENDS:-25}"                # real `tx bank send` count (funded accts + transfer events + decodable MsgSend)
SEND_AMOUNT="${SEND_AMOUNT:-1000000}"         # utwlt per bank send (operator0 is genesis-funded 1e12)
SUBSIDY="${SUBSIDY:-416190}"

# phase trigger heights (percent of target, so they scale with TARGET_HEIGHT)
P3_AT=$(( TARGET_HEIGHT * 30 / 100 ))
P4_AT=$(( TARGET_HEIGHT * 62 / 100 ))

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing required command: $1" >&2; exit 2; }; }
need curl; need jq
[[ -x "$BIN" ]] || { echo "twilightd not built at $BIN (run the chain repo init once, or set BIN/CHAIN_REPO)" >&2; exit 2; }

LOG="$NET/drive.log"
ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[$(ts)] $*" | tee -a "$LOG"; }

# counters for the end summary
TX_OK=0; TX_FAIL=0; ACCT_TOUCHED=0; CLAIMS=0; EPOCHS_SEEN=0; BANK_OK=0
SPARSE_FROM=0; SPARSE_TO=0; SLOT5_ADD_H=0; SLOT5_REMOVE_H=0
OP0=""               # operator0 bech32 address (genesis-funded bank-send source); set after bring-up
TALLY="$NET/.tx-tally"   # subshell-safe tx outcome tally (submit() appends ok/fail; summary recomputes)

# ---- chain helpers ---------------------------------------------------------------------------
rpc_url()  { echo "tcp://127.0.0.1:$((26657 + $1 * 100))"; }
http_url() { echo "http://127.0.0.1:$((26657 + $1 * 100))"; }
latest_height() { curl -fsS "$(http_url "${1:-0}")/status" 2>/dev/null | jq -r '.result.sync_info.latest_block_height|tonumber' 2>/dev/null || echo 0; }
current_epoch() { "$BIN" rewards-query epoch-info --node "$(rpc_url 0)" --output json 2>/dev/null | jq -r '.state.current_epoch|tonumber' 2>/dev/null || echo 0; }
wait_height() { local t="$1" d=$((SECONDS + ${2:-180})); while ((SECONDS < d)); do (($(latest_height 0) >= t)) && return 0; sleep 1; done; return 1; }

wait_tx_code() { # hash -> DeliverTx code (or not_included)
  local hash="$1" d=$((SECONDS + 30)) r
  while ((SECONDS < d)); do
    r="$(curl -fsS "$(http_url 0)/tx?hash=0x$hash" 2>/dev/null || true)"
    if [[ -n "$r" ]] && jq -e '.result.tx_result' >/dev/null 2>&1 <<<"$r"; then
      jq -r '.result.tx_result.code // 0' <<<"$r"; return 0
    fi
    sleep 1
  done
  echo "not_included"
}

# submit <node> <from_key> <cmd...> ; tallies TX_OK / TX_FAIL ; echoes the resolved code
submit() {
  local node="$1" from="$2"; shift 2
  local out code hash
  out="$("$BIN" "$@" --from "$from" --keyring-backend test --home "$NET/node$node" \
        --chain-id "$CHAIN_ID" --node "$(rpc_url 0)" --gas 600000 --fees 0utwlt \
        --broadcast-mode sync --output json -y 2>/dev/null || true)"
  code="$(jq -r '.code // 1' <<<"$out" 2>/dev/null || echo 1)"
  hash="$(jq -r '.txhash // ""' <<<"$out" 2>/dev/null || echo "")"
  # submit() is usually called via $(...) (a subshell), so increment a FILE not a var — counter writes
  # to a parent var would be lost. The end summary recomputes TX_OK/TX_FAIL from $TALLY.
  if [[ "$code" != "0" || -z "$hash" ]]; then echo fail >>"$TALLY"; echo "rejected:$code"; return; fi
  code="$(wait_tx_code "$hash")"
  if [[ "$code" == "0" ]]; then echo ok >>"$TALLY"; else echo fail >>"$TALLY"; fi
  echo "$code"
}
auth()  { submit 0 operator0 "$@"; }   # normal authority (operator0 @ node0)
emerg() { submit 1 operator1 "$@"; }   # emergency authority (operator1 @ node1)

stop_node()  { [[ -f "$NET/node$1.pid" ]] && { kill "$(cat "$NET/node$1.pid")" 2>/dev/null || true; rm -f "$NET/node$1.pid"; }; }
start_node() { "$BIN" start --home "$NET/node$1" --minimum-gas-prices 0utwlt --log_no_color >>"$NET/logs/node$1.log" 2>&1 & echo "$!" >"$NET/node$1.pid"; }

# ---- bring-up --------------------------------------------------------------------------------
bringup() {
  log "bring-up: init 4-node localnet at $NET (chain $CHAIN_ID)"
  "$CHAIN_REPO/scripts/localnet/stop.sh" >/dev/null 2>&1 || true
  rm -rf "$NET"
  # init.sh runs `go build` WITHOUT cd-ing into the chain repo, so it resolves the main module from the
  # CALLER's CWD. Invoke it with CWD inside the chain repo (else "cannot find main module") and ABORT on
  # failure — otherwise the genesis-tune loop runs against node configs init never created.
  ( cd "$CHAIN_REPO" && ./scripts/localnet/init.sh ) || { log "FATAL: chain localnet init failed"; exit 1; }
  [[ -f "$NET/node0/config/genesis.json" ]] || { log "FATAL: init produced no node configs at $NET"; exit 1; }
  mkdir -p "$NET/logs"
  for n in 0 1 2 3; do
    local g="$NET/node$n/config/genesis.json" c="$NET/node$n/config/config.toml" tmp
    tmp="$g.tmp"
    jq --arg e "$EPOCH_LENGTH" '
      .app_state.rewards.params.epoch_length_blocks = $e
      | .app_state.rewards.current_epoch_config.epoch_length_blocks = $e' "$g" >"$tmp" && mv "$tmp" "$g"
    sed -i.bak "s#^timeout_commit = .*#timeout_commit = \"$BLOCK_TIME\"#" "$c" && rm -f "$c.bak"
  done
  # Observed-sample projections (rewards/balance snapshots) read REST on node0; it is OFF by
  # default in init.sh, so enable it (+ swagger) before start. RPC alone is enough for ingest.
  local A="$NET/node0/config/app.toml"
  sed -i.bak '/^\[api\]/,/^\[/ s/^enable = false/enable = true/; /^\[api\]/,/^\[/ s/^swagger = false/swagger = true/' "$A" && rm -f "$A.bak"
  : >"$LOG"
  log "tuned: epoch_length=$EPOCH_LENGTH timeout_commit=$BLOCK_TIME emission/epoch=$((EPOCH_LENGTH*SUBSIDY)) per_slot=$(((EPOCH_LENGTH*SUBSIDY)/4))"
  "$CHAIN_REPO/scripts/localnet/start.sh"
  trap '"$CHAIN_REPO/scripts/localnet/stop.sh" >/dev/null 2>&1 || true' EXIT
  wait_height 2 || { log "FATAL: chain did not reach height 2"; exit 1; }
  log "chain live at height $(latest_height 0)"
}

# generate the payout-address pool (addresses only; txs are signed by operator0)
gen_pool() {
  POOL=()
  log "generating $ACCOUNT_POOL payout-pool keys"
  for ((k=0; k<ACCOUNT_POOL; k++)); do
    local a
    a="$("$BIN" keys add "soak-acct-$k" --keyring-backend test --home "$NET/node0" --output json 2>/dev/null | jq -r '.address' 2>/dev/null)"
    [[ "$a" == twilight1* ]] && POOL+=("$a")
  done
  log "pool ready: ${#POOL[@]} addresses"
  (( ${#POOL[@]} > 0 )) || { log "FATAL: payout pool empty — 'keys add' produced no addresses"; exit 1; }
}

# ---- P1 filler -------------------------------------------------------------------------------
acct_i=0; bank_i=0; last_filler_h=0; tick_n=0
filler_tick() {
  local h="$1"
  (( h - last_filler_h < FILLER_EVERY )) && return
  last_filler_h="$h"
  if (( acct_i < ${#POOL[@]} )); then
    # account breadth: each new payout address -> an Account row (cheap, free, no balance)
    auth coreslot update-payout 1 "${POOL[$acct_i]}" >/dev/null
    ACCT_TOUCHED=$((ACCT_TOUCHED+1)); acct_i=$((acct_i+1))
  elif (( bank_i < BANK_SENDS )) && (( bank_i < ${#POOL[@]} )) && [[ -n "$OP0" ]]; then
    # fund a subset with a REAL bank send: transfer/coin_received/coin_spent events + a
    # decodable cosmos.bank MsgSend (clean-decodes iff the explorer descriptor carries bank Msg)
    local code; code="$(submit 0 operator0 tx bank send "$OP0" "${POOL[$bank_i]}" "${SEND_AMOUNT}utwlt")"
    [[ "$code" == "0" ]] && BANK_OK=$((BANK_OK+1)) || log "bank send -> ${POOL[$bank_i]:0:14}.. code $code"
    bank_i=$((bank_i+1))
  else
    tick_n=$((tick_n+1))
    auth coreslot update-metadata 1 "soak-tick-$tick_n" >/dev/null
  fi
}

# ---- P2 rewards (fired on each epoch boundary) -----------------------------------------------
prev_epoch=0; did_double=0; did_pause=0
on_epoch_boundary() {
  local finalized="$1"
  (( finalized < 1 )) && return
  EPOCHS_SEEN=$finalized
  (( finalized % CLAIM_EVERY != 0 )) && return            # leave most epochs unclaimed
  local slot=$(( (finalized / CLAIM_EVERY - 1) % 4 + 1 )) # rotate the claimed slot 1..4
  local code; code="$(emerg rewards claim "$slot" "$finalized" "$finalized")"
  if [[ "$code" == "0" ]]; then
    CLAIMS=$((CLAIMS+1)); log "claim slot $slot epoch $finalized: ok"
  else
    log "claim slot $slot epoch $finalized: code $code"; return
  fi
  # one committed FAILED tx via double-claim of a just-claimed epoch
  if (( did_double == 0 )); then
    did_double=1
    local d; d="$(emerg rewards claim "$slot" "$finalized" "$finalized")"
    log "double-claim slot $slot epoch $finalized -> code $d (expected != 0, committed failed tx)"
  fi
  # one committed FAILED tx via claim-while-paused, on a fresh unclaimed epoch
  if (( did_pause == 0 )) && (( finalized >= 2*CLAIM_EVERY )); then
    did_pause=1
    emerg rewards pause --claims >/dev/null
    local pc; pc="$(emerg rewards claim 2 1 1)"
    log "paused-claim slot 2 epoch 1 -> code $pc (expected != 0)"
    emerg rewards resume --claims >/dev/null
  fi
}

# ---- P3 lifecycle / authority depth (all 4 nodes up; set peaks at 5 then back to 4) ----------
run_p3() {
  log "P3 lifecycle/authority depth @ height $(latest_height 0)"
  # metadata / payout / params on slot 1 (no validator-set effect)
  auth coreslot update-metadata 1 "explorer-soak-p3" >/dev/null
  auth coreslot update-payout 1 "${POOL[0]:-$(jq -r '.address' "$NET/operator0.json")}" >/dev/null
  "$BIN" coreslot-query params --node "$(rpc_url 0)" --output json 2>/dev/null | jq '.params
    | .slot_voting_power|=tonumber | .min_active_slots|=tonumber | .activation_delay_blocks|=tonumber
    | .key_rotation_delay_blocks|=tonumber | .removal_delay_blocks|=tonumber
    | .consensus_key_reuse_lockout|=tonumber | .max_active_slots=101' >"$NET/params.json" 2>/dev/null
  [[ -s "$NET/params.json" ]] && auth coreslot update-params "$NET/params.json" >/dev/null

  # inactivate -> activate slot 4 (validator-set close/reopen at +2; set 4->3->4, no node down)
  auth coreslot inactivate 4 "soak-maintenance" >/dev/null; sleep 4
  auth coreslot activate 4 >/dev/null; sleep 4
  # emergency suspend -> activate slot 4 (ACTIVE->SUSPENDED->ACTIVE)
  emerg coreslot suspend 4 "soak-evidence" "soak-incident-001" >/dev/null; sleep 4
  auth coreslot activate 4 >/dev/null; sleep 4

  # key rotation on slot 3 (+ node2 key swap & restart) — node2 briefly down, set stays 4
  local kout newpub newkey
  kout="$("$CHAIN_REPO/scripts/localnet/gen-consensus-key.sh" "soak-rot-node2" 2>/dev/null)"
  newpub="$(cut -f1 <<<"$kout")"; newkey="$(cut -f2 <<<"$kout")"
  if [[ -n "$newpub" && -f "$newkey" ]]; then
    auth coreslot rotate-key 3 "$newpub" >/dev/null
    stop_node 2; sleep 2
    cp "$newkey" "$NET/node2/config/priv_validator_key.json"   # leave priv_validator_state.json
    start_node 2
    log "rotated slot 3 key; node2 restarted with new key"
    sleep 6
  else
    log "WARN: gen-consensus-key failed; skipped slot-3 rotation"
  fi

  # add a 5th CoreSlot with NO backing node -> it misses every block (down detection), then remove
  local op5 pub5
  op5="$("$BIN" keys add soak-op5 --keyring-backend test --home "$NET/node0" --output json 2>/dev/null | jq -r '.address')"
  pub5="$("$CHAIN_REPO/scripts/localnet/gen-consensus-key.sh" "soak-slot5" 2>/dev/null | cut -f1)"
  if [[ "$op5" == twilight1* && -n "$pub5" ]]; then
    auth coreslot register "$op5" "$op5" "$pub5" "soak-core5" >/dev/null
    auth coreslot activate 5 >/dev/null
    SLOT5_ADD_H="$(latest_height 0)"
    log "registered+activated slot 5 (no node) @ $SLOT5_ADD_H; letting it miss ~$SLOT5_DOWN_BLOCKS blocks"
    wait_height $((SLOT5_ADD_H + SLOT5_DOWN_BLOCKS)) || true
    auth coreslot inactivate 5 "soak-decommission" >/dev/null; sleep 4
    auth coreslot remove 5 "soak-decommission" >/dev/null
    SLOT5_REMOVE_H="$(latest_height 0)"
    log "removed slot 5 @ $SLOT5_REMOVE_H (set back to 4)"
  else
    log "WARN: could not build slot-5 inputs; skipped add/remove"
  fi
}

# ---- main ------------------------------------------------------------------------------------
if [[ "${RESUME:-off}" != "on" ]]; then bringup; else mkdir -p "$NET/logs"; trap '"$CHAIN_REPO/scripts/localnet/stop.sh" >/dev/null 2>&1 || true' EXIT; fi
gen_pool
OP0="$(jq -r '.address' "$NET/operator0.json" 2>/dev/null)"   # genesis-funded bank-send source
[[ "$OP0" == twilight1* ]] || log "WARN: operator0 address unresolved — bank sends will be skipped"
: >"$TALLY"   # fresh tx tally for this run

log "drive start: target=$TARGET_HEIGHT P3@$P3_AT P4@$P4_AT sparse_window=$SPARSE_WINDOW_BLOCKS"
did_p3=0; p4_state=0; p4_down_start=0
while :; do
  h="$(latest_height 0)"
  (( h >= TARGET_HEIGHT )) && break

  # P2: claim handling on epoch advance (handle multi-advance)
  ep="$(current_epoch)"
  while (( prev_epoch < ep )); do on_epoch_boundary "$prev_epoch"; prev_epoch=$((prev_epoch+1)); done

  # P3: one-shot lifecycle/authority depth
  if (( did_p3 == 0 )) && (( h >= P3_AT )); then run_p3; did_p3=1; continue; fi

  # P4: sparse liveness window — only after P3 (clean 4-set), only node3 down
  if (( did_p3 == 1 )) && (( p4_state == 0 )) && (( h >= P4_AT )); then
    stop_node 3; p4_down_start="$h"; SPARSE_FROM="$h"; p4_state=1
    log "P4 sparse window: stopped node3 @ $h; down for ~$SPARSE_WINDOW_BLOCKS blocks"
  fi
  if (( p4_state == 1 )) && (( h >= p4_down_start + SPARSE_WINDOW_BLOCKS )); then
    start_node 3; SPARSE_TO="$h"; p4_state=2
    log "P4 sparse window: restarted node3 @ $h (down ~$((h - p4_down_start)) blocks)"
  fi

  filler_tick "$h"
  sleep 1
done

FINAL_H="$(latest_height 0)"
TX_OK=$(grep -c '^ok' "$TALLY" 2>/dev/null); TX_OK=${TX_OK:-0}        # subshell-safe recompute
TX_FAIL=$(grep -c '^fail' "$TALLY" 2>/dev/null); TX_FAIL=${TX_FAIL:-0}
# Leave the chain RUNNING — the observed-sample projections (rewards/balance snapshots) query a
# live node, pinned to this end height (Phase 7.2 F4). Record it so ingest-project pins the same.
echo "$FINAL_H" >"$NET/soak-end-height.txt"
trap - EXIT
log "reached target height $FINAL_H — chain LEFT RUNNING for pinned-height sampling (end height -> $NET/soak-end-height.txt)"

cat <<EOF | tee -a "$LOG"

==================== SOAK DRIVE COMPLETE ====================
  chain id            : $CHAIN_ID   home: $NET
  end height (pinned) : $FINAL_H   (target $TARGET_HEIGHT)  -> $NET/soak-end-height.txt
  epoch length        : $EPOCH_LENGTH blocks   epochs finalized: ~$EPOCHS_SEEN
  txs                 : ok=$TX_OK  failed(committed/rejected)=$TX_FAIL
  accounts fanned out : $ACCT_TOUCHED distinct payout addresses
  bank sends (ok)     : $BANK_OK (funded accts + transfer events + MsgSend)
  reward claims (ok)  : $CLAIMS
  5th CoreSlot        : added@$SLOT5_ADD_H removed@$SLOT5_REMOVE_H
  sparse window (n3)  : down $SPARSE_FROM..$SPARSE_TO
  chain               : STILL RUNNING (RPC http://127.0.0.1:26657, REST http://127.0.0.1:1317)
  next (explorer repo): COMET_RPC_URL=http://127.0.0.1:26657 REST_URL=http://127.0.0.1:1317 \\
                          TWILIGHT_LOCALNET_HOME=$NET scripts/soak/ingest-project.sh
  when done           : $CHAIN_REPO/scripts/localnet/stop.sh
============================================================
EOF
