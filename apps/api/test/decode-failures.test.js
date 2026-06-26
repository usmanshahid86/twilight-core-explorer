import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildServer } from '../dist/server.js';
import { MockPrisma, testConfig, decodeFailure } from './mock-prisma.js';

const build = (data) => buildServer({ config: testConfig, prisma: new MockPrisma(data) });

describe('decode-failures', () => {
  it('lists unresolved by default, id DESC, paginated (N+1)', async () => {
    const app = await build({
      decodeFailures: [
        decodeFailure(1),
        decodeFailure(2),
        decodeFailure(3),
        decodeFailure(4, { resolved: true, resolvedAt: new Date('2026-06-26T01:00:00.000Z') }),
      ],
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/decode-failures?limit=2' });
    assert.deepEqual(res.json().data.map((d) => d.id), ['3', '2']); // resolved #4 excluded, id desc
    assert.ok(res.json().page.nextCursor);

    const res2 = await app.inject({
      method: 'GET',
      url: `/api/v1/decode-failures?limit=2&cursor=${encodeURIComponent(res.json().page.nextCursor)}`,
    });
    assert.deepEqual(res2.json().data.map((d) => d.id), ['1']);
    assert.equal(res2.json().page.nextCursor, null);
    await app.close();
  });

  it('never exposes raw payloads', async () => {
    const app = await build({ decodeFailures: [decodeFailure(1)] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/decode-failures' });
    const item = res.json().data[0];
    assert.equal(item.rawJson, undefined);
    assert.equal(item.rawBase64, undefined);
    assert.equal(item.failureKind, 'unknown_message_type');
    assert.equal(item.id, '1');
    assert.equal(item.height, '5');
    await app.close();
  });

  it('filters by failureKind and can include resolved', async () => {
    const app = await build({
      decodeFailures: [
        decodeFailure(1, { failureKind: 'a' }),
        decodeFailure(2, { failureKind: 'b', resolved: true }),
      ],
    });
    const resA = await app.inject({ method: 'GET', url: '/api/v1/decode-failures?failureKind=a' });
    assert.deepEqual(resA.json().data.map((d) => d.id), ['1']);
    const resResolved = await app.inject({ method: 'GET', url: '/api/v1/decode-failures?resolved=true' });
    assert.deepEqual(resResolved.json().data.map((d) => d.id), ['2']);
    await app.close();
  });

  it('rejects a bad cursor with 400', async () => {
    const app = await build({ decodeFailures: [] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/decode-failures?cursor=@@@' });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'invalid_cursor');
    await app.close();
  });
});
