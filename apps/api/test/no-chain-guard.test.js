// Static guard: apps/api must be DB-only with NO outbound network. Fails on chain-client / config
// imports, http clients, global fetch(, gRPC, and RPC/REST route or port markers anywhere in src,
// and on a chain-client dependency in package.json. Mirrors the indexer's static-route-guard tests.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url));
const PKG_PATH = fileURLToPath(new URL('../package.json', import.meta.url));

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const FORBIDDEN = [
  { label: 'chain-client', re: /chain-client/ },
  { label: 'packages/config import', re: /from ['"]@twilight-explorer\/config['"]/ },
  { label: 'loadConfig usage', re: /loadConfig\s*\(/ },
  { label: 'node-fetch', re: /node-fetch/ },
  { label: 'undici', re: /undici/ },
  { label: 'http(s) client import', re: /from ['"](node:)?https?['"]/ },
  { label: 'gRPC', re: /grpc/i },
  { label: 'global fetch(', re: /(^|[^.\w])fetch\s*\(/ },
  { label: 'CometBFT RPC port 26657', re: /26657/ },
  { label: 'Cosmos REST port 1317', re: /1317/ },
  { label: 'cosmos route', re: /\/cosmos\// },
  { label: 'twilight chain route', re: /\/twilight\// },
  { label: 'block_results', re: /block_results/ },
];

describe('no-chain / no-outbound-network guard', () => {
  it('apps/api/src contains no chain transport or outbound network usage', () => {
    for (const file of walk(SRC_DIR)) {
      const text = readFileSync(file, 'utf8');
      for (const { label, re } of FORBIDDEN) {
        assert.ok(!re.test(text), `forbidden pattern [${label}] found in ${file}`);
      }
    }
  });

  it('apps/api/package.json declares no chain-client dependency', () => {
    const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    assert.ok(
      !Object.keys(deps).some((d) => d.includes('chain-client') || d.includes('config')),
      'apps/api must not depend on chain-client or packages/config',
    );
  });
});
