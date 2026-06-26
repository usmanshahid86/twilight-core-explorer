import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildServer } from '../dist/server.js';
import { MockPrisma, testConfig, consensusWindow, networkRisk } from './mock-prisma.js';

const build = (data) => buildServer({ config: testConfig, prisma: new MockPrisma(data) });

describe('network proposers', () => {
  it('aggregates attributed blocks per slot, sorted desc; ignores unattributed', async () => {
    const app = await build({
      attributions: [
        { height: 1n, slotId: 1n, operatorAddress: 'op1', attributionStatus: 'attributed' },
        { height: 2n, slotId: 1n, operatorAddress: 'op1', attributionStatus: 'attributed' },
        { height: 3n, slotId: 2n, operatorAddress: 'op2', attributionStatus: 'attributed' },
        { height: 4n, slotId: null, operatorAddress: null, attributionStatus: 'unmapped_validator' },
      ],
    });
    const res = await app.inject({ url: '/api/v1/network/proposers' });
    assert.deepEqual(res.json().data, [
      { slotId: '1', operatorAddress: 'op1', blocksProposed: 2 },
      { slotId: '2', operatorAddress: 'op2', blocksProposed: 1 },
    ]);
    await app.close();
  });
});

describe('network validator-set', () => {
  it('returns windows active at the height (effectiveFrom <= h < effectiveTo|null)', async () => {
    const app = await build({
      windows: [
        consensusWindow(1, 1, 5, 100), // active [5,100)
        consensusWindow(2, 2, 100, null), // active [100, inf)
        consensusWindow(3, 3, 200, null), // not yet active at 150
      ],
    });
    const res = await app.inject({ url: '/api/v1/network/validator-set?height=150' });
    assert.deepEqual(res.json().data.map((m) => m.slotId), ['2']);
    await app.close();
  });

  it('includes a window whose effectiveTo equals nothing and excludes effectiveTo==height', async () => {
    const app = await build({
      windows: [
        consensusWindow(1, 1, 5, 100), // [5,100): at height 100 -> excluded (to == height)
        consensusWindow(2, 2, 5, null), // [5, inf): included
      ],
    });
    const res = await app.inject({ url: '/api/v1/network/validator-set?height=100' });
    assert.deepEqual(res.json().data.map((m) => m.slotId), ['2']);
    await app.close();
  });

  it('400 when height is missing or non-numeric', async () => {
    const app = await build({});
    assert.equal((await app.inject({ url: '/api/v1/network/validator-set' })).statusCode, 400);
    assert.equal((await app.inject({ url: '/api/v1/network/validator-set?height=abc' })).statusCode, 400);
    await app.close();
  });
});

describe('network liveness-risk', () => {
  it('returns the current snapshot with status strings verbatim', async () => {
    const app = await build({ networkRisk: networkRisk({ haltRiskLevel: 'warning', haltRiskReason: 'one down' }) });
    const res = await app.inject({ url: '/api/v1/network/liveness-risk' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().data.haltRiskLevel, 'warning');
    assert.equal(res.json().data.haltRiskReason, 'one down');
    assert.equal(res.json().data.availablePowerBps, 10000);
    await app.close();
  });

  it('404 when no snapshot exists', async () => {
    const app = await build({});
    const res = await app.inject({ url: '/api/v1/network/liveness-risk' });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error.code, 'not_found');
    await app.close();
  });
});
