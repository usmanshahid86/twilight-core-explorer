import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildServer } from '../dist/server.js';
import { MockPrisma, testConfig, tx, msg, evt, block } from './mock-prisma.js';

const build = (data) => buildServer({ config: testConfig, prisma: new MockPrisma(data) });

describe('txs list', () => {
  it('lists newest-first (height desc, index desc) and paginates via a composite cursor', async () => {
    const app = await build({
      txs: [tx('A', 10, 0), tx('B', 10, 1), tx('C', 11, 0)],
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/txs?limit=2' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(body.data.map((t) => t.hash), ['C', 'B']); // 11/0, then 10/1
    assert.ok(body.page.nextCursor);

    const res2 = await app.inject({
      method: 'GET',
      url: `/api/v1/txs?limit=2&cursor=${encodeURIComponent(body.page.nextCursor)}`,
    });
    assert.deepEqual(res2.json().data.map((t) => t.hash), ['A']); // 10/0
    assert.equal(res2.json().page.nextCursor, null);
    await app.close();
  });

  it('emits nextCursor:null on a full final page (N+1 lookahead)', async () => {
    const app = await build({ txs: [tx('A', 1, 0), tx('B', 2, 0)] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/txs?limit=2' });
    assert.equal(res.json().data.length, 2);
    assert.equal(res.json().page.nextCursor, null);
    await app.close();
  });

  it('filters by exact height', async () => {
    const app = await build({ txs: [tx('A', 1, 0), tx('B', 2, 0), tx('C', 2, 1)] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/txs?height=2' });
    assert.deepEqual(res.json().data.map((t) => t.hash), ['C', 'B']);
    await app.close();
  });

  it('filters by status', async () => {
    const app = await build({
      txs: [
        tx('A', 3, 0, { status: 'success' }),
        tx('B', 2, 0, { status: 'failed', code: 5 }),
        tx('C', 1, 0, { status: 'success' }),
      ],
    });
    const ok = await app.inject({ method: 'GET', url: '/api/v1/txs?status=success' });
    assert.deepEqual(ok.json().data.map((t) => t.hash), ['A', 'C']);
    const failed = await app.inject({ method: 'GET', url: '/api/v1/txs?status=failed' });
    assert.deepEqual(failed.json().data.map((t) => t.hash), ['B']);
    await app.close();
  });

  it('rejects bad limit / bad cursor with 400', async () => {
    const app = await build({ txs: [] });
    assert.equal((await app.inject({ url: '/api/v1/txs?limit=999' })).statusCode, 400);
    assert.equal((await app.inject({ url: '/api/v1/txs?cursor=@@@' })).statusCode, 400);
    await app.close();
  });

  it('serializes height + gas as strings, never raw on list', async () => {
    const app = await build({ txs: [tx('A', 7, 0)] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/txs' });
    const item = res.json().data[0];
    assert.equal(item.height, '7');
    assert.equal(item.gasUsed, '80000');
    assert.equal(item.raw, undefined);
    assert.equal(item.rawTx, undefined);
    await app.close();
  });
});

describe('tx detail', () => {
  it('returns tx with materialized messages, events, block time; raw excluded by default', async () => {
    const app = await build({
      txs: [tx('A', 7, 0)],
      blocks: [block(7)],
      messages: [msg('A', 0), msg('A', 1)],
      events: [evt('A', 0), evt('A', 1)],
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/txs/A' });
    assert.equal(res.statusCode, 200);
    const d = res.json().data;
    assert.equal(d.hash, 'A');
    assert.equal(d.time, '2026-06-26T00:00:00.000Z');
    assert.equal(d.messages.length, 2);
    assert.equal(d.messages[0].msgIndex, 0);
    assert.equal(d.messages[0].raw, undefined); // no message raw without include=raw
    assert.equal(d.events.length, 2);
    assert.equal(d.raw, undefined);
    assert.ok(d.fee);
    await app.close();
  });

  it('include=raw adds tx raw + message raw', async () => {
    const app = await build({ txs: [tx('A', 7, 0)], blocks: [block(7)], messages: [msg('A', 0)] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/txs/A?include=raw' });
    const d = res.json().data;
    assert.deepEqual(d.raw.tx, { tx: 'A' });
    assert.deepEqual(d.messages[0].raw, { raw: 0 });
    await app.close();
  });

  it('returns 404 for an unknown hash', async () => {
    const app = await build({ txs: [] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/txs/NOPE' });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error.code, 'not_found');
    await app.close();
  });
});
