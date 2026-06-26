import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildServer } from '../dist/server.js';
import {
  MockPrisma,
  testConfig,
  epoch,
  slotReward,
  claim,
  rewardsBalance,
  paramsChange,
  treasuryPayment,
  coreSlot,
} from './mock-prisma.js';

const build = (data) => buildServer({ config: testConfig, prisma: new MockPrisma(data) });

describe('rewards epochs', () => {
  it('lists epochNumber DESC with rewardSemantics + keyset pagination', async () => {
    const app = await build({ epochs: [epoch(1), epoch(2), epoch(3)] });
    const res = await app.inject({ url: '/api/v1/rewards/epochs?limit=2' });
    assert.deepEqual(res.json().data.map((e) => e.epochNumber), ['3', '2']);
    assert.equal(res.json().data[0].rewardSemantics, 'aggregate_projection');
    assert.ok(res.json().page.nextCursor);
    const res2 = await app.inject({
      url: `/api/v1/rewards/epochs?limit=2&cursor=${encodeURIComponent(res.json().page.nextCursor)}`,
    });
    assert.deepEqual(res2.json().data.map((e) => e.epochNumber), ['1']);
    assert.equal(res2.json().page.nextCursor, null);
    await app.close();
  });

  it('detail by epoch; include=raw; 404 missing; 400 invalid_epoch; int64 overflow 400', async () => {
    const app = await build({ epochs: [epoch(5)] });
    const ok = await app.inject({ url: '/api/v1/rewards/epochs/5' });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().data.epochNumber, '5');
    assert.equal(ok.json().data.raw, undefined);
    const raw = await app.inject({ url: '/api/v1/rewards/epochs/5?include=raw' });
    assert.deepEqual(raw.json().data.raw, { epoch: 5 });
    assert.equal((await app.inject({ url: '/api/v1/rewards/epochs/999' })).statusCode, 404);
    const bad = await app.inject({ url: '/api/v1/rewards/epochs/abc' });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.json().error.code, 'invalid_epoch');
    assert.equal((await app.inject({ url: '/api/v1/rewards/epochs/9223372036854775808' })).statusCode, 400);
    await app.close();
  });
});

describe('coreslot rewards', () => {
  it('400 invalid_slot_id, 404 missing slot, 200 empty existing slot', async () => {
    const app = await build({ coreSlots: [coreSlot(2)] });
    assert.equal((await app.inject({ url: '/api/v1/coreslots/abc/rewards' })).json().error.code, 'invalid_slot_id');
    assert.equal((await app.inject({ url: '/api/v1/coreslots/999/rewards' })).statusCode, 404);
    const empty = await app.inject({ url: '/api/v1/coreslots/2/rewards' });
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(empty.json().data, []);
    await app.close();
  });

  it('returns slot rewards with observed-claim caveat fields', async () => {
    const app = await build({
      coreSlots: [coreSlot(2)],
      slotRewards: [slotReward(2, 1), slotReward(2, 2, { claimed: true, claimedAtHeight: 100n, claimTxHash: 'TX' })],
    });
    const res = await app.inject({ url: '/api/v1/coreslots/2/rewards' });
    assert.deepEqual(res.json().data.map((r) => r.epochNumber), ['2', '1']);
    const item = res.json().data[0];
    assert.equal(item.claimed, true);
    assert.equal(item.claimedAtHeight, '100');
    assert.equal(item.productionClaimReadiness, 'gated_by_phase_7_2');
    assert.equal(item.claimSemantics, 'projection_observed_not_live_claimable');
    await app.close();
  });
});

describe('rewards claims', () => {
  it('orders height/id DESC, composite cursor, history-only caveat, slotId filter', async () => {
    const app = await build({ claims: [claim(1, 2, 10), claim(2, 2, 10), claim(3, 3, 11)] });
    const res = await app.inject({ url: '/api/v1/rewards/claims?limit=2' });
    assert.deepEqual(res.json().data.map((c) => c.id), ['3', '2']); // h11/id3, h10/id2
    assert.equal(res.json().data[0].productionClaimReadiness, 'gated_by_phase_7_2');
    assert.equal(res.json().data[0].claimSemantics, 'event_history_only');
    const res2 = await app.inject({
      url: `/api/v1/rewards/claims?limit=2&cursor=${encodeURIComponent(res.json().page.nextCursor)}`,
    });
    assert.deepEqual(res2.json().data.map((c) => c.id), ['1']);
    const f = await app.inject({ url: '/api/v1/rewards/claims?slotId=3' });
    assert.deepEqual(f.json().data.map((c) => c.id), ['3']);
    await app.close();
  });

  it('rejects an out-of-int64 slotId filter with 400', async () => {
    const app = await build({ claims: [] });
    const res = await app.inject({ url: '/api/v1/rewards/claims?slotId=9223372036854775808' });
    assert.equal(res.statusCode, 400);
    await app.close();
  });
});

describe('rewards balances', () => {
  it('excludes supply by default; includes via ?sampleKind=supply', async () => {
    const app = await build({
      rewardsBalances: [
        rewardsBalance(1, 'module_balance'),
        rewardsBalance(2, 'supply'),
        rewardsBalance(3, 'cumulative_emitted'),
      ],
    });
    const def = await app.inject({ url: '/api/v1/rewards/balances' });
    assert.deepEqual(def.json().data.map((b) => b.sampleKind).sort(), ['cumulative_emitted', 'module_balance']);
    assert.equal(def.json().data[0].source, 'sampled');
    const sup = await app.inject({ url: '/api/v1/rewards/balances?sampleKind=supply' });
    assert.deepEqual(sup.json().data.map((b) => b.sampleKind), ['supply']);
    await app.close();
  });
});

describe('rewards params + treasury', () => {
  it('params id DESC + changeType filter', async () => {
    const app = await build({
      paramsChanges: [paramsChange(1, { changeType: 'queued' }), paramsChange(2, { changeType: 'activated' })],
    });
    assert.deepEqual((await app.inject({ url: '/api/v1/rewards/params' })).json().data.map((p) => p.id), ['2', '1']);
    const f = await app.inject({ url: '/api/v1/rewards/params?changeType=queued' });
    assert.deepEqual(f.json().data.map((p) => p.id), ['1']);
    await app.close();
  });

  it('treasury id DESC', async () => {
    const app = await build({ treasuryPayments: [treasuryPayment(1), treasuryPayment(2)] });
    const res = await app.inject({ url: '/api/v1/rewards/treasury-payments' });
    assert.deepEqual(res.json().data.map((t) => t.id), ['2', '1']);
    assert.equal(res.json().data[0].amount, '42');
    await app.close();
  });
});

// Per-endpoint cursor + final-page coverage (mirrors the acceptance checklist literally, even though
// all routes share the hardened cursor helpers).
describe('rewards list endpoints — pagination edge cases', () => {
  const cases = [
    { name: 'epochs', url: '/api/v1/rewards/epochs', data: { epochs: [epoch(1), epoch(2)] } },
    {
      name: 'coreslot rewards',
      url: '/api/v1/coreslots/2/rewards',
      data: { coreSlots: [coreSlot(2)], slotRewards: [slotReward(2, 1), slotReward(2, 2)] },
    },
    { name: 'claims', url: '/api/v1/rewards/claims', data: { claims: [claim(1, 2, 10), claim(2, 2, 11)] } },
    {
      name: 'balances',
      url: '/api/v1/rewards/balances',
      data: { rewardsBalances: [rewardsBalance(1, 'module_balance'), rewardsBalance(2, 'cumulative_emitted')] },
    },
    { name: 'params', url: '/api/v1/rewards/params', data: { paramsChanges: [paramsChange(1), paramsChange(2)] } },
    {
      name: 'treasury-payments',
      url: '/api/v1/rewards/treasury-payments',
      data: { treasuryPayments: [treasuryPayment(1), treasuryPayment(2)] },
    },
  ];

  for (const c of cases) {
    it(`${c.name}: malformed cursor -> 400 invalid_cursor`, async () => {
      const app = await build(c.data);
      const res = await app.inject({ url: `${c.url}?cursor=@@@` });
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().error.code, 'invalid_cursor');
      await app.close();
    });

    it(`${c.name}: full final page emits nextCursor:null`, async () => {
      const app = await build(c.data);
      const res = await app.inject({ url: `${c.url}?limit=2` });
      assert.equal(res.json().data.length, 2);
      assert.equal(res.json().page.nextCursor, null);
      await app.close();
    });
  }
});
