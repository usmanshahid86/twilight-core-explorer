#!/usr/bin/env bash
set -euo pipefail

CHAIN_ID="${CHAIN_ID:-twilight-localnet-1}"
COMET_RPC_URL="${COMET_RPC_URL:-http://localhost:26657}"
REST_URL="${REST_URL:-http://localhost:1317}"
DATABASE_URL="${DATABASE_URL:-postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public}"
REQUEST_TIMEOUT_MS="${REQUEST_TIMEOUT_MS:-10000}"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 2
  }
}

need curl
need node
need npm

json_get() {
  curl -fsS --max-time 8 "$1"
}

http_code() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$1" 2>/dev/null
}

extract_latest_height() {
  node -e '
    let data = "";
    process.stdin.on("data", (chunk) => data += chunk);
    process.stdin.on("end", () => {
      const parsed = JSON.parse(data);
      const height = parsed?.result?.sync_info?.latest_block_height;
      if (!height) process.exit(1);
      console.log(height);
    });
  '
}

assert_code() {
  local label="$1" url="$2" expected="$3" code
  code="$(http_code "$url")"
  if [[ "$code" != "$expected" ]]; then
    echo "FAIL $label -> $code (expected $expected): $url" >&2
    exit 1
  fi
  echo "ok   $label -> $code"
}

assert_rpc_json() {
  local label="$1" url="$2"
  json_get "$url" >/dev/null
  echo "ok   $label"
}

echo "== Twilight explorer local ingestion smoke =="
echo "CHAIN_ID=$CHAIN_ID"
echo "COMET_RPC_URL=$COMET_RPC_URL"
echo "REST_URL=$REST_URL"
echo "DATABASE_URL=$DATABASE_URL"

echo
echo "== endpoint checks =="
status_json="$(json_get "$COMET_RPC_URL/status")"
latest_height="$(printf '%s' "$status_json" | extract_latest_height)"
assert_rpc_json "CometBFT /block latest" "$COMET_RPC_URL/block"
assert_rpc_json "CometBFT /block_results latest" "$COMET_RPC_URL/block_results"
assert_code "REST node_info" "$REST_URL/cosmos/base/tendermint/v1beta1/node_info" "200"
assert_code "REST bank supply" "$REST_URL/cosmos/bank/v1beta1/supply" "200"

if [[ -n "${START_HEIGHT:-}" ]]; then
  start_height="$START_HEIGHT"
else
  start_height="$latest_height"
  if ((start_height > 5)); then
    start_height=$((start_height - 4))
  else
    start_height=1
  fi
fi

end_height="${END_HEIGHT:-$latest_height}"

if ((end_height < start_height)); then
  echo "END_HEIGHT ($end_height) must be >= START_HEIGHT ($start_height)" >&2
  exit 1
fi

echo
echo "== tx REST height query check =="
tx_query_code="$(http_code "$REST_URL/cosmos/tx/v1beta1/txs?query=tx.height%3D${end_height}")"
if [[ "$tx_query_code" != "200" ]]; then
  echo "FAIL tx REST query by height -> $tx_query_code" >&2
  exit 1
fi
echo "ok   REST tx query by height -> $tx_query_code"

echo
echo "== database migration =="
DATABASE_URL="$DATABASE_URL" npm run db:deploy

echo
echo "== build indexer =="
npm --prefix apps/indexer run build

echo
echo "== ingest range ${start_height}..${end_height} =="
CHAIN_ID="$CHAIN_ID" \
COMET_RPC_URL="$COMET_RPC_URL" \
REST_URL="$REST_URL" \
DATABASE_URL="$DATABASE_URL" \
REQUEST_TIMEOUT_MS="$REQUEST_TIMEOUT_MS" \
START_HEIGHT="$start_height" \
END_HEIGHT="$end_height" \
npm --prefix apps/indexer start

echo
echo "== re-ingest same range for idempotency =="
CHAIN_ID="$CHAIN_ID" \
COMET_RPC_URL="$COMET_RPC_URL" \
REST_URL="$REST_URL" \
DATABASE_URL="$DATABASE_URL" \
REQUEST_TIMEOUT_MS="$REQUEST_TIMEOUT_MS" \
START_HEIGHT="$start_height" \
END_HEIGHT="$end_height" \
npm --prefix apps/indexer start

echo
echo "== database counts =="
counts_json="$(DATABASE_URL="$DATABASE_URL" node scripts/db-counts.js)"
printf '%s\n' "$counts_json"

CHAIN_ID="$CHAIN_ID" EXPECTED_END_HEIGHT="$end_height" node -e '
  const data = JSON.parse(process.argv[1]);
  const counts = data.counts;
  const cursors = data.cursors;
  const expectedEnd = BigInt(process.env.EXPECTED_END_HEIGHT);
  const cursor = cursors.find((row) => row.chainId === process.env.CHAIN_ID);
  if (!cursor) throw new Error(`missing cursor for ${process.env.CHAIN_ID}`);
  if (BigInt(cursor.lastIndexedHeight) < expectedEnd) {
    throw new Error(`cursor height ${cursor.lastIndexedHeight} < expected ${expectedEnd}`);
  }
  if (counts.Block < 1) throw new Error("expected at least one Block row");
  if (counts.Event < 1) throw new Error("expected at least one Event row");
  if (counts.ExplorerTransaction < 1) {
    throw new Error("expected at least one tx row; produce a localnet tx and rerun with a range containing that height");
  }
' "$counts_json"

echo
echo "PASS local ingestion smoke ${start_height}..${end_height}"
