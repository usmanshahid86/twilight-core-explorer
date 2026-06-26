import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildServer } from '../dist/server.js';
import { MockPrisma, testConfig } from './mock-prisma.js';

const build = (data) => buildServer({ config: testConfig, prisma: new MockPrisma(data) });

describe('status', () => {
  it('reports indexer lag + freshness from a populated IndexerCursor', async () => {
    const app = await build({
      indexerCursor: {
        chainId: 'twilight-localnet-1',
        lastIndexedHeight: 3196n,
        latestChainHeight: 3200n,
        status: 'idle',
        lastIndexedHash: 'abc',
        updatedAt: new Date(),
        error: null,
      },
      projectionCursors: [
        {
          projectionName: 'proposer_attribution_v1',
          lastProjectedHeight: 3196n,
          status: 'idle',
          updatedAt: new Date(),
          error: null,
        },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/status' });
    assert.equal(res.statusCode, 200);
    const d = res.json().data;
    assert.equal(d.chainId, 'twilight-localnet-1');
    assert.equal(d.indexer.lastIndexedHeight, '3196');
    assert.equal(d.indexer.latestChainHeight, '3200');
    assert.equal(d.indexer.lagBlocks, '4');
    assert.equal(typeof d.indexer.freshnessSeconds, 'number');
    assert.equal(d.projections[0].projectionName, 'proposer_attribution_v1');
    assert.deepEqual(d.projectionFailures, { unresolvedCount: 0, byProjection: [] });
    await app.close();
  });

  it('returns indexer:null + chainId:null when the DB is empty', async () => {
    const app = await build({ indexerCursor: null });
    const res = await app.inject({ method: 'GET', url: '/api/v1/status' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().data.indexer, null);
    assert.equal(res.json().data.chainId, null);
    assert.deepEqual(res.json().data.projections, []);
    await app.close();
  });

  it('reports null lag when latestChainHeight is unknown', async () => {
    const app = await build({
      indexerCursor: {
        chainId: 'c',
        lastIndexedHeight: 10n,
        latestChainHeight: null,
        status: 'idle',
        lastIndexedHash: null,
        updatedAt: new Date(),
        error: null,
      },
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/status' });
    assert.equal(res.json().data.indexer.latestChainHeight, null);
    assert.equal(res.json().data.indexer.lagBlocks, null);
    await app.close();
  });

  it('aggregates unresolved projection failures by projection', async () => {
    const app = await build({
      failures: [
        { projectionName: 'coreslot_health_v1', resolved: false },
        { projectionName: 'coreslot_health_v1', resolved: false },
        { projectionName: 'rewards_semantic_v1', resolved: true },
      ],
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/status' });
    const f = res.json().data.projectionFailures;
    assert.equal(f.unresolvedCount, 2);
    assert.deepEqual(f.byProjection, [{ projectionName: 'coreslot_health_v1', count: 2 }]);
    await app.close();
  });
});
