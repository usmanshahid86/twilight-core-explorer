import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildServer } from '../dist/server.js';
import { MockPrisma, testConfig, account } from './mock-prisma.js';

const build = (data) => buildServer({ config: testConfig, prisma: new MockPrisma(data) });

describe('accounts list', () => {
  it('lists address ASC and paginates via cursor (N+1)', async () => {
    const app = await build({
      accounts: [account('twilight1c'), account('twilight1a'), account('twilight1b')],
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/accounts?limit=2' });
    assert.deepEqual(res.json().data.map((a) => a.address), ['twilight1a', 'twilight1b']);
    assert.ok(res.json().page.nextCursor);

    const res2 = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts?limit=2&cursor=${encodeURIComponent(res.json().page.nextCursor)}`,
    });
    assert.deepEqual(res2.json().data.map((a) => a.address), ['twilight1c']);
    assert.equal(res2.json().page.nextCursor, null);
    await app.close();
  });

  it('emits nextCursor:null on a full final page', async () => {
    const app = await build({ accounts: [account('twilight1a'), account('twilight1b')] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/accounts?limit=2' });
    assert.equal(res.json().data.length, 2);
    assert.equal(res.json().page.nextCursor, null);
    await app.close();
  });

  it('filters by accountKind', async () => {
    const app = await build({
      accounts: [account('twilight1a', { accountKind: 'base' }), account('twilight1b', { accountKind: 'module' })],
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/accounts?accountKind=module' });
    assert.deepEqual(res.json().data.map((a) => a.address), ['twilight1b']);
    await app.close();
  });

  it('rejects an out-of-range limit with 400', async () => {
    const app = await build({ accounts: [] });
    assert.equal((await app.inject({ url: '/api/v1/accounts?limit=0' })).statusCode, 400);
    await app.close();
  });

  it('rejects malformed account cursors with 400 invalid_cursor', async () => {
    const app = await build({ accounts: [] });
    const enc = (s) => Buffer.from(s, 'utf8').toString('base64url');
    const cases = [
      '@@@', // not base64url
      '', // empty cursor / encoded empty part
      enc(''), // explicitly-encoded empty part
      enc('notanaddress'), // valid base64url but not an account address
      enc('cosmos1abc'), // wrong bech32 prefix
    ];
    for (const cursor of cases) {
      const res = await app.inject({ url: `/api/v1/accounts?cursor=${encodeURIComponent(cursor)}` });
      assert.equal(res.statusCode, 400, `cursor=${JSON.stringify(cursor)} should be 400`);
      assert.equal(res.json().error.code, 'invalid_cursor');
    }
    await app.close();
  });

  it('accepts a valid emitted account cursor', async () => {
    const app = await build({ accounts: [account('twilight1a'), account('twilight1b'), account('twilight1c')] });
    const first = await app.inject({ url: '/api/v1/accounts?limit=1' });
    const next = first.json().page.nextCursor;
    assert.ok(next);
    const res = await app.inject({ url: `/api/v1/accounts?limit=1&cursor=${encodeURIComponent(next)}` });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().data.map((a) => a.address), ['twilight1b']);
    await app.close();
  });
});

describe('account detail', () => {
  it('returns identity/activity only (no balance), raw excluded by default', async () => {
    const app = await build({ accounts: [account('twilight1a')] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/accounts/twilight1a' });
    assert.equal(res.statusCode, 200);
    const d = res.json().data;
    assert.deepEqual(Object.keys(d).sort(), [
      'accountKind',
      'address',
      'firstSeenHeight',
      'lastSeenHeight',
      'txCount',
    ]);
    assert.equal(d.firstSeenHeight, '10');
    assert.equal(d.lastSeenHeight, '20');
    assert.equal(d.txCount, 3);
    assert.equal(d.balance, undefined); // never a balance field
    await app.close();
  });

  it('include=raw adds rawAccountJson', async () => {
    const app = await build({ accounts: [account('twilight1a')] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/accounts/twilight1a?include=raw' });
    assert.deepEqual(res.json().data.raw, { address: 'twilight1a' });
    await app.close();
  });

  it('returns 404 for an unknown address', async () => {
    const app = await build({ accounts: [] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/accounts/twilight1zzz' });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error.code, 'not_found');
    await app.close();
  });
});
