import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Enforces the DB-only-consumer boundary: the web app may only reach the Phase 9 API via the typed
// client. No DB, config-loading, chain RPC/REST, or raw node http(s) anywhere. Scans source + the
// package manifest + app config so a forbidden dependency or import can't slip in unnoticed.
const ROOT = process.cwd(); // apps/web
const SRC = join(ROOT, 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const sourceFiles = walk(SRC).filter(
  (f) =>
    /\.(ts|tsx)$/.test(f) &&
    !f.includes(join('lib', 'api', 'generated')) &&
    !/\.test\.(ts|tsx)$/.test(f),
);

const configFiles = ['package.json', 'next.config.js', 'tsconfig.json']
  .map((f) => join(ROOT, f))
  .filter((f) => existsSync(f));

const scanFiles = [...sourceFiles, ...configFiles];

// Substrings that must never appear in app source / manifest / config.
const FORBIDDEN = [
  '@twilight-explorer/db',
  '@twilight-explorer/config',
  '@twilight-explorer/chain-client',
  'chain-client',
  'loadConfig',
  'DATABASE_URL',
  "from 'pg'",
  'from "pg"',
  'node-fetch',
  'undici',
  'node:http',
  'node:https',
  ':26657',
  ':1317',
  '/cosmos/',
  '/twilight/coreslot/',
  '/twilight/rewards/',
];

describe('web stays a DB-only API consumer', () => {
  it('uses no DB / config / chain / RPC / node-http modules (src + package.json + config)', () => {
    const hits: string[] = [];
    for (const file of scanFiles) {
      const src = readFileSync(file, 'utf8');
      for (const needle of FORBIDDEN) {
        if (src.includes(needle)) hits.push(`${file} :: ${needle}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('only the typed API client performs fetch()', () => {
    const clientPath = join('lib', 'api', 'client.ts');
    const offenders = sourceFiles.filter(
      (f) => !f.endsWith(clientPath) && /\bfetch\s*\(/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
