import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Enforces the DB-only-consumer boundary: the web app may only reach the Phase 9 API via the typed
// client. No DB, chain RPC/REST, or stray fetch() calls anywhere else.
const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const sourceFiles = walk(SRC).filter(
  (f) =>
    /\.(ts|tsx)$/.test(f) &&
    !f.includes(`${join('lib', 'api', 'generated')}`) &&
    !/\.test\.(ts|tsx)$/.test(f),
);

describe('web stays a DB-only API consumer', () => {
  it('imports no DB / chain / RPC modules', () => {
    const forbidden = [
      '@twilight-explorer/db',
      "from 'pg'",
      'from "pg"',
      'chain-client',
      'node-fetch',
      'undici',
      ':26657',
      ':1317',
      '/cosmos/',
      '/twilight/coreslot/',
      '/twilight/rewards/',
    ];
    const hits: string[] = [];
    for (const file of sourceFiles) {
      const src = readFileSync(file, 'utf8');
      for (const needle of forbidden) {
        if (src.includes(needle)) hits.push(`${file} :: ${needle}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('only the API client performs fetch()', () => {
    const clientPath = join('lib', 'api', 'client.ts');
    const offenders = sourceFiles.filter(
      (f) => !f.endsWith(clientPath) && /\bfetch\s*\(/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
