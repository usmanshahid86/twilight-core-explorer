import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildServer } from '../dist/server.js';
import { MockPrisma, testConfig } from './mock-prisma.js';

const build = (data) => buildServer({ config: testConfig, prisma: new MockPrisma(data) });

describe('projections diagnostics', () => {
  it('returns each cursor with an unresolved-failure breakdown by kind', async () => {
    const app = await build({
      projectionCursors: [
        { projectionName: 'coreslot_health_v1', lastProjectedHeight: 3196n, status: 'idle', updatedAt: new Date(), error: null },
        { projectionName: 'rewards_semantic_v1', lastProjectedHeight: 3000n, status: 'idle', updatedAt: new Date(), error: null },
      ],
      failures: [
        { projectionName: 'coreslot_health_v1', failureKind: 'corrupt_summary', resolved: false },
        { projectionName: 'coreslot_health_v1', failureKind: 'corrupt_summary', resolved: false },
        { projectionName: 'coreslot_health_v1', failureKind: 'incomplete', resolved: false },
        { projectionName: 'coreslot_health_v1', failureKind: 'old', resolved: true },
      ],
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/projections' });
    assert.equal(res.statusCode, 200);
    const byName = Object.fromEntries(res.json().data.map((p) => [p.projectionName, p]));

    assert.equal(byName['coreslot_health_v1'].lastProjectedHeight, '3196');
    assert.equal(byName['coreslot_health_v1'].unresolvedFailures.count, 3);
    const kinds = Object.fromEntries(
      byName['coreslot_health_v1'].unresolvedFailures.byKind.map((k) => [k.failureKind, k.count]),
    );
    assert.deepEqual(kinds, { corrupt_summary: 2, incomplete: 1 });

    assert.equal(byName['rewards_semantic_v1'].unresolvedFailures.count, 0);
    assert.deepEqual(byName['rewards_semantic_v1'].unresolvedFailures.byKind, []);
    await app.close();
  });
});
