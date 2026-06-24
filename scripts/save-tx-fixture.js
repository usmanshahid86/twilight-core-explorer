import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const cometRpcUrl = process.env.COMET_RPC_URL ?? 'http://localhost:26657';
const height = process.env.HEIGHT;
const txIndex = Number(process.env.TX_INDEX ?? '0');
const expectedTypeUrl = process.env.EXPECTED_TYPE_URL;
const output = process.env.OUTPUT ??
  'packages/decoder/test/fixtures/coreslot-update-metadata-tx.json';

if (!height) {
  console.error('HEIGHT is required');
  process.exit(2);
}

const response = await fetch(`${cometRpcUrl}/block?height=${encodeURIComponent(height)}`);
if (!response.ok) {
  throw new Error(`CometBFT /block failed: ${response.status} ${response.statusText}`);
}

const block = await response.json();
const txs = block?.result?.block?.data?.txs;
const rawTxBase64 = Array.isArray(txs) ? txs[txIndex] : undefined;
if (typeof rawTxBase64 !== 'string') {
  throw new Error(`No tx at height ${height} index ${txIndex}`);
}

const hash = createHash('sha256').update(Buffer.from(rawTxBase64, 'base64')).digest('hex').toUpperCase();
const fixture = {
  height: height.toString(),
  hash,
  rawTxBase64,
  expectedTypeUrl,
};

mkdirSync(dirname(resolve(output)), { recursive: true });
writeFileSync(output, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote ${output}`);
console.log(`height=${height} txIndex=${txIndex} hash=${hash}`);
