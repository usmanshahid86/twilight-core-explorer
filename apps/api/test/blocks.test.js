import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildServer } from '../dist/server.js';
import { MockPrisma, testConfig, block } from './mock-prisma.js';

const build = (data) => buildServer({ config: testConfig, prisma: new MockPrisma(data) });

describe('blocks list', () => {
  it('lists newest-first and paginates via an opaque cursor', async () => {
    const app = await build({ blocks: [block(1), block(2), block(3)] });

    const res = await app.inject({ method: 'GET', url: '/api/v1/blocks?limit=2' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(body.data.map((b) => b.height), ['3', '2']);
    assert.equal(body.page.limit, 2);
    assert.ok(body.page.nextCursor);

    const res2 = await app.inject({
      method: 'GET',
      url: `/api/v1/blocks?limit=2&cursor=${encodeURIComponent(body.page.nextCursor)}`,
    });
    assert.deepEqual(res2.json().data.map((b) => b.height), ['1']);
    assert.equal(res2.json().page.nextCursor, null); // last page
    await app.close();
  });

  it('emits nextCursor on a full page when more rows exist', async () => {
    const app = await build({ blocks: [block(1), block(2), block(3)] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/blocks?limit=2' });
    assert.deepEqual(res.json().data.map((b) => b.height), ['3', '2']);
    assert.ok(res.json().page.nextCursor, 'more rows remain -> nextCursor present');
    await app.close();
  });

  it('emits nextCursor:null on a full final page with no extra row', async () => {
    // exactly `limit` rows and nothing beyond — must NOT dangle a cursor to an empty page
    const app = await build({ blocks: [block(1), block(2)] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/blocks?limit=2' });
    assert.deepEqual(res.json().data.map((b) => b.height), ['2', '1']);
    assert.equal(res.json().page.nextCursor, null);
    await app.close();
  });

  it('emits nextCursor:null on a non-full page', async () => {
    const app = await build({ blocks: [block(1)] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/blocks?limit=2' });
    assert.deepEqual(res.json().data.map((b) => b.height), ['1']);
    assert.equal(res.json().page.nextCursor, null);
    await app.close();
  });

  it('rejects an out-of-range limit with 400 invalid_query', async () => {
    const app = await build({ blocks: [] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/blocks?limit=500' });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'invalid_query');
    await app.close();
  });

  it('rejects a malformed cursor with 400 invalid_cursor', async () => {
    const app = await build({ blocks: [block(1)] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/blocks?cursor=not-a-cursor' });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'invalid_cursor');
    await app.close();
  });

  it('rejects include=raw on the list endpoint with 400 invalid_query (raw is detail-only)', async () => {
    const app = await build({ blocks: [block(1)] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/blocks?include=raw' });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'invalid_query');
    await app.close();
  });

  it('attaches proposer attribution when materialized, null when absent', async () => {
    const app = await build({
      blocks: [block(10, { proposerAddress: 'AABB' }), block(11, { proposerAddress: 'CCDD' })],
      attributions: [
        {
          height: 10n,
          proposerAddress: 'aabb',
          rawProposerAddress: 'AABB',
          slotId: 3n,
          operatorAddress: 'twilight1op',
          attributionStatus: 'attributed',
        },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/blocks?limit=10' });
    const byHeight = Object.fromEntries(res.json().data.map((b) => [b.height, b.proposer]));
    assert.equal(byHeight['10'].attributionStatus, 'attributed');
    assert.equal(byHeight['10'].slotId, '3');
    assert.equal(byHeight['10'].operatorAddress, 'twilight1op');
    assert.equal(byHeight['11'].attributionStatus, null);
    assert.equal(byHeight['11'].slotId, null);
    assert.equal(byHeight['11'].rawAddress, 'CCDD');
    await app.close();
  });
});

describe('block detail', () => {
  it('returns a block by height', async () => {
    const app = await build({ blocks: [block(7)] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/blocks/7' });
    assert.equal(res.statusCode, 200);
    const d = res.json().data;
    assert.equal(d.height, '7');
    assert.equal(d.appHash, 'app');
    assert.equal(d.raw, undefined); // no raw without include=raw
    await app.close();
  });

  it('returns 404 not_found for a missing block', async () => {
    const app = await build({ blocks: [] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/blocks/999' });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error.code, 'not_found');
    await app.close();
  });

  it('includes raw only on detail when include=raw', async () => {
    const app = await build({ blocks: [block(7)] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/blocks/7?include=raw' });
    assert.deepEqual(res.json().data.raw, { height: 7 });
    await app.close();
  });

  it('rejects a non-numeric height with 400 invalid_height', async () => {
    const app = await build({ blocks: [] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/blocks/abc' });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'invalid_height');
    await app.close();
  });

  it('serializes heights as JSON strings, never numbers', async () => {
    const app = await build({ blocks: [block(42)] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/blocks/42' });
    assert.equal(typeof res.json().data.height, 'string');
    assert.match(res.payload, /"height":"42"/);
    await app.close();
  });
});
