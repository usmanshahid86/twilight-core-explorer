#!/usr/bin/env node
// Phase 13d — Release Candidate checklist. Runs each check, prints a PASS/FAIL line, and exits 0
// (RC-green) / 1 (any fail). The verdict is recomputed, never asserted — a green run here IS the gate.
//
// Two tiers:
//   STATIC — the full validation ritual + a contract-conformance API smoke that replays EVERY
//            openapi.json path against the in-memory mock Prisma (no live DB). Runnable anywhere/CI.
//   LIVE   — the same smoke + projection-status against the soak DB (13d-3). Gated behind RC_LIVE=1.
//
// Flags: `--smoke` runs only the API contract smoke (fast dev loop, skips the slow ritual).

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SMOKE_ONLY = process.argv.includes('--smoke');
const SELF_TEST = process.argv.includes('--self-test');
// LIVE tier (13d-3): boots the real server against the soak DB. Opt-in via RC_LIVE=1 +
// API_DATABASE_URL (or DATABASE_URL). Off by default so the static gate stays CI-runnable.
const LIVE = process.env.RC_LIVE === '1';
const results = [];

function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  const tag = pass ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  process.stdout.write(`  ${tag}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}

function runCmd(name, args) {
  const r = spawnSync('npm', args, { cwd: ROOT, encoding: 'utf8' });
  const pass = r.status === 0;
  const tail = (r.stderr || r.stdout || '').trim().split('\n').slice(-2).join(' ');
  record(name, pass, pass ? '' : `exit ${r.status}: ${tail}`.slice(0, 200));
}

if (SELF_TEST) await runSelfTest(); // proves the envelope-category + cursor-walk checks reject mismatches, then exits

if (!SMOKE_ONLY) {
  console.log('\n=== Static checks (validation ritual + contract) ===');
  runCmd('typecheck', ['run', 'typecheck']);
  runCmd('lint (0 errors)', ['run', 'lint']);
  runCmd('tests (all workspaces)', ['test']);
  runCmd('api openapi:check (no drift)', ['--prefix', 'apps/api', 'run', 'openapi:check']);
  runCmd('web openapi:check (no drift)', ['--prefix', 'apps/web', 'run', 'openapi:check']);
  runCmd('static repo guards', ['run', 'test:guards']);
  runCmd('web build', ['--prefix', 'apps/web', 'run', 'build']);
}

console.log('\n=== API contract smoke (every openapi path → declared status + valid envelope) ===');
try {
  await apiSmoke();
} catch (e) {
  record('API contract smoke', false, `crashed: ${e.message}`.slice(0, 160));
}

if (LIVE) {
  console.log('\n=== LIVE tier (RC_LIVE=1): real soak DB — data presence, cursor-walk, projections, freshness ===');
  try {
    await liveTier();
  } catch (e) {
    record('RC_LIVE tier', false, `crashed: ${e.message}`.slice(0, 160));
  }
}

const failed = results.filter((r) => !r.pass);
const verdict = failed.length === 0 ? '\x1b[32mGREEN\x1b[0m' : `\x1b[31mRED (${failed.length} failed)\x1b[0m`;
console.log(`\n=== RC verdict: ${verdict} — ${results.length} checks ===\n`);
process.exit(failed.length === 0 ? 0 : 1);

// ----- API contract smoke -----------------------------------------------------------------------
// Boot the real server with the in-memory mock Prisma, read the published contract, and replay every
// path. The contract is DERIVED from openapi.json (not a hand-list), so a new route is auto-covered.
// A path PASSES if it returns one of its DECLARED statuses with the right envelope ({data}/{error}) —
// 200 or a 404/400 are all conformant; only a 500/undeclared status or a non-envelope body fails.
async function apiSmoke() {
  const build = spawnSync('npm', ['--prefix', 'apps/api', 'run', 'build'], { cwd: ROOT, encoding: 'utf8' });
  if (build.status !== 0) {
    record('api build (for smoke)', false, 'tsc build failed');
    return;
  }

  const { buildServer } = await import(join(ROOT, 'apps/api/dist/server.js'));
  const { MockPrisma, testConfig, block, tx, account, coreSlot } = await import(
    join(ROOT, 'apps/api/test/mock-prisma.js')
  );
  // RC_OPENAPI overrides the contract path (used to negative-test the smoke against a corrupted spec).
  const openapiPath = process.env.RC_OPENAPI || join(ROOT, 'docs/reference/openapi.json');
  const openapi = JSON.parse(readFileSync(openapiPath, 'utf8'));

  // Seed so list + main detail paths return 200; unseeded detail paths return a conformant 404.
  const seed = {
    blocks: [block(1)],
    accounts: [account('twilight1testaddr')],
    coreSlots: [coreSlot(1)],
    txs: [tx('a'.repeat(64), 1, 0)],
  };
  const app = await buildServer({ config: testConfig, prisma: new MockPrisma(seed) });

  const fill = (p) =>
    p
      .replaceAll('{height}', '1')
      .replaceAll('{hash}', 'a'.repeat(64))
      .replaceAll('{slotId}', '1')
      .replaceAll('{address}', 'twilight1testaddr')
      .replaceAll('{epoch}', '1');

  const HTTP = ['get', 'post', 'put', 'delete', 'patch'];
  let replayed = 0;
  for (const [rawPath, methods] of Object.entries(openapi.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!HTTP.includes(method)) continue;
      replayed += 1;
      let res;
      try {
        res = await app.inject({ method: method.toUpperCase(), url: fill(rawPath) + queryFor(op) });
      } catch (e) {
        record(`${method.toUpperCase()} ${rawPath}`, false, `threw: ${e.message}`.slice(0, 140));
        continue;
      }
      const declared = Object.keys(op.responses || {}).map(Number);
      const statusOk = declared.includes(res.statusCode);
      let envelopeOk = false;
      try {
        // Expected envelope is derived from the DECLARED response schema for the actual status, so a
        // declared-vs-actual category mismatch (e.g. a 200 that the spec says is {error}) FAILs.
        const expected = declaredCategory(op, res.statusCode);
        envelopeOk = envelopeConforms(res.json(), expected, rawPath.startsWith('/health'));
      } catch {
        envelopeOk = false;
      }
      const pass = statusOk && envelopeOk;
      record(
        `${method.toUpperCase()} ${rawPath}`,
        pass,
        pass ? '' : `status ${res.statusCode} (declared ${declared.join('/')}); envelope=${envelopeOk}`,
      );
    }
  }
  // Guard against a vacuous green: an empty/broken contract would replay 0 paths and "pass". This API
  // publishes ~32 paths; require a sane floor so a missing/corrupt openapi.json fails loudly.
  record('contract smoke coverage (>= 20 paths)', replayed >= 20, `replayed ${replayed} paths`);
  await app.close();
}

// The actual body must carry the envelope category the CONTRACT declares for that status — not merely
// "has data OR error" (Codex 13d-1 review: that loose check let a 200-declared-{error} pass). The
// expected category comes from declaredCategory(); a mismatch FAILs. Health endpoints have their own shape.
function envelopeConforms(body, expectedCategory, isHealth) {
  if (body === null || typeof body !== 'object') return false;
  if (isHealth) return true;
  return expectedCategory in body;
}

// Derive the declared envelope category for a status from the openapi response schema's properties (this
// spec inlines schemas, so there is no $ref to read): a schema with an `error` property ⇒ `error`;
// otherwise (a `data` property) ⇒ `data`.
function declaredCategory(op, statusCode) {
  const schema = op.responses?.[String(statusCode)]?.content?.['application/json']?.schema ?? {};
  return 'error' in (schema.properties ?? {}) ? 'error' : 'data';
}

// Fill required query params (from the openapi op) so required-query routes (e.g. /search, validator-set)
// get success-path coverage instead of a declared 400. Sample by name; default '1'.
function queryFor(op) {
  const required = (op.parameters || []).filter((p) => p.in === 'query' && p.required);
  if (required.length === 0) return '';
  const sample = (name) => (name === 'q' ? 'test' : '1');
  return `?${required.map((p) => `${p.name}=${encodeURIComponent(sample(p.name))}`).join('&')}`;
}

// ----- LIVE tier (RC_LIVE=1) --------------------------------------------------------------------
// Boots the REAL server against the soak Postgres and checks what the contract tier cannot: that the
// data is actually present, deep cursor pagination is complete + dup-free (== DB count), projections
// left zero unresolved failures, and the indexer freshness/lag status reads truthfully. The api dist
// is already built by apiSmoke() (which runs first); we reuse the permissive testConfig but pass a
// real PrismaClient. Author-time safe — only RUNNING it needs the soak DB.
async function liveTier() {
  const dbUrl = process.env.API_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    record('RC_LIVE db url (API_DATABASE_URL/DATABASE_URL)', false, 'unset — nothing to check against');
    return;
  }
  const { buildServer } = await import(join(ROOT, 'apps/api/dist/server.js'));
  const { testConfig } = await import(join(ROOT, 'apps/api/test/mock-prisma.js'));
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasourceUrl: dbUrl });
  const app = await buildServer({ config: testConfig, prisma });
  const P = '/api/v1';
  const get = (url) => app.inject({ method: 'GET', url });

  try {
    // 1) the core lists are actually populated (200 + non-empty data); keep each list's first item
    //    so detail paths can be exercised with ids that genuinely exist.
    const coreLists = ['/blocks', '/txs', '/accounts', '/coreslots', '/rewards/epochs'];
    const firstItem = {};
    for (const path of coreLists) {
      const res = await get(P + path);
      const body = res.statusCode === 200 ? res.json() : {};
      const data = Array.isArray(body.data) ? body.data : [];
      firstItem[path] = data[0];
      record(`live list ${path} (200 + non-empty)`, res.statusCode === 200 && data.length > 0,
        `status ${res.statusCode}, ${data.length} rows`);
    }

    // 2) detail paths for real ids (derived from the lists, so no model-name guessing) -> 200.
    const details = [
      ['/blocks', (it) => `${P}/blocks/${it.height}`],
      ['/txs', (it) => `${P}/txs/${it.hash}`],
      ['/coreslots', (it) => `${P}/coreslots/${it.slotId}`],
      ['/accounts', (it) => `${P}/accounts/${it.address}`],
    ];
    for (const [listPath, toDetail] of details) {
      const it = firstItem[listPath];
      if (!it) { record(`live detail from ${listPath}`, false, 'no list item to derive an id'); continue; }
      const url = toDetail(it);
      const res = await get(url);
      record(`live detail ${url.replace(P, '')}`, res.statusCode === 200, `status ${res.statusCode}`);
    }

    // 3) deep cursor-walk integrity: follow nextCursor to exhaustion — complete + dup-free, and the
    //    walked count must equal the DB row count (proves pagination skips/duplicates nothing).
    const walks = [
      ['/blocks', 'height', () => prisma.block.count()],
      ['/txs', 'hash', () => prisma.explorerTransaction.count()],
    ];
    for (const [path, key, counter] of walks) {
      try {
        const walked = await walkList(app, P + path, key);
        const dbCount = Number(await counter());
        record(`cursor-walk ${path} complete (walked == DB)`, walked === dbCount,
          `walked ${walked} vs DB ${dbCount}`);
      } catch (e) {
        record(`cursor-walk ${path}`, false, e.message.slice(0, 140));
      }
    }

    // 4) projections left ZERO unresolved failures + the indexer status reads truthfully.
    const sres = await get(`${P}/status`);
    const s = sres.statusCode === 200 ? (sres.json().data ?? {}) : {};
    record('live status: 0 unresolved ProjectionFailure', s.projectionFailures?.unresolvedCount === 0,
      `unresolvedCount=${s.projectionFailures?.unresolvedCount}`);
    // freshnessSeconds/lagBlocks are nested under data.indexer (the IndexerStatus object), not top-level.
    record('live status: indexer present + freshness/lag fields',
      s.indexer != null && 'freshnessSeconds' in s.indexer && 'lagBlocks' in s.indexer,
      `indexer=${s.indexer != null} freshnessSeconds=${s.indexer?.freshnessSeconds} lagBlocks=${s.indexer?.lagBlocks}`);
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

// Walk a keyset-paginated list to exhaustion via page.nextCursor, returning the distinct-item count.
// Throws on a duplicate id (pagination overlap) or a non-terminating walk (cursor that never clears).
async function walkList(app, path, key, maxPages = 100000) {
  const seen = new Set();
  let cursor = null;
  let pages = 0;
  for (;;) {
    const url = path + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : '');
    const res = await app.inject({ method: 'GET', url });
    if (res.statusCode !== 200) throw new Error(`${path} page ${pages} -> ${res.statusCode}`);
    const body = res.json();
    for (const item of body.data ?? []) {
      const k = item?.[key] != null ? String(item[key]) : JSON.stringify(item);
      if (seen.has(k)) throw new Error(`duplicate ${key}=${k} on ${path}`);
      seen.add(k);
    }
    pages += 1;
    cursor = body.page?.nextCursor ?? null;
    if (!cursor) break;
    if (pages > maxPages) throw new Error(`${path} cursor walk did not terminate (> ${maxPages} pages)`);
  }
  return seen.size;
}

// Falsification self-test (`--self-test`): prove the envelope-category check REJECTS the mismatches the
// review flagged (a 2xx {error}, a 4xx {data}). A gate that can't be shown to fail can't be trusted.
async function runSelfTest() {
  // [body, declaredCategory, isHealth, expected]
  const cases = [
    [{ data: [] }, 'data', false, true],
    [{ error: {} }, 'data', false, false], // spec says data, body has error → reject
    [{ data: [] }, 'error', false, false], // spec says error, body has data → reject (Codex's exact case)
    [{ error: {} }, 'error', false, true],
    [null, 'data', false, false],
    [{ status: 'live' }, 'data', true, true], // health shape bypass
  ];
  // declaredCategory must read the inlined schema's properties correctly.
  const mk = (props) => ({ responses: { 200: { content: { 'application/json': { schema: { properties: props } } } } } });
  const catCases = [
    [mk({ error: {} }), 200, 'error'],
    [mk({ data: {} }), 200, 'data'],
  ];
  let ok = true;
  for (const [b, cat, h, exp] of cases) {
    const got = envelopeConforms(b, cat, h);
    if (got !== exp) {
      ok = false;
      console.log(`  self-test FAIL: body=${JSON.stringify(b)} declared=${cat} → ${got}, expected ${exp}`);
    }
  }
  for (const [op, status, exp] of catCases) {
    const got = declaredCategory(op, status);
    if (got !== exp) {
      ok = false;
      console.log(`  self-test FAIL: declaredCategory ${status} → ${got}, expected ${exp}`);
    }
  }

  // Cursor-walk integrity (the LIVE tier's core): a clean two-page walk returns the distinct count and
  // terminates; a duplicate id across pages MUST throw (so a paginate-overlap can't silently pass).
  const mockApp = (pages) => { let i = 0; return { inject: async () => ({ statusCode: 200, json: () => pages[i++] }) }; };
  try {
    const n = await walkList(mockApp([
      { data: [{ height: '3' }, { height: '2' }], page: { nextCursor: 'c1' } },
      { data: [{ height: '1' }], page: { nextCursor: null } },
    ]), '/x', 'height');
    if (n !== 3) { ok = false; console.log(`  self-test FAIL: walkList counted ${n}, expected 3`); }
  } catch (e) {
    ok = false; console.log(`  self-test FAIL: walkList threw on a valid walk: ${e.message}`);
  }
  let dupThrew = false;
  try {
    await walkList(mockApp([
      { data: [{ height: '2' }], page: { nextCursor: 'c1' } },
      { data: [{ height: '2' }], page: { nextCursor: null } }, // duplicate id across pages
    ]), '/x', 'height');
  } catch { dupThrew = true; }
  if (!dupThrew) { ok = false; console.log('  self-test FAIL: walkList did not reject a duplicate id'); }

  console.log(ok ? 'envelope-category + cursor-walk self-test: PASS' : 'self-test: FAIL');
  process.exit(ok ? 0 : 1);
}
