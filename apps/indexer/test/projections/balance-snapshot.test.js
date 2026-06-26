import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { projectBalanceSnapshot } from '../../dist/projections/balance-snapshot.js';
import { resetBalanceSnapshotProjection } from '../../dist/projections/reset-balance-snapshot.js';
import {
  BALANCE_SNAPSHOT_PROJECTION,
  SUPPLY_SAMPLE_KIND,
} from '../../dist/projections/types.js';

const CHAIN_ID = 'twilight-test';

class MockPrisma {
  constructor(coreSlots = []) {
    this._coreSlots = coreSlots;
    this.balanceSamples = new Map(); // sampleKey -> row
    this.accountBalances = new Map(); // balanceKey -> row
    this.failures = new Map(); // failureKey -> row
    this.cursors = new Map(); // name:chainId -> row

    this.coreSlotProjection = {
      findMany: async () =>
        this._coreSlots.map((s) => ({ operatorAddress: s.operatorAddress ?? null, payoutAddress: s.payoutAddress ?? null })),
    };
    this.rewardsBalanceSample = {
      upsert: async (args) => upsert(this.balanceSamples, args.where.sampleKey, args),
      deleteMany: async (args = {}) => {
        const kind = args.where?.sampleKind;
        for (const [k, v] of this.balanceSamples) {
          if (kind === undefined || v.sampleKind === kind) this.balanceSamples.delete(k);
        }
      },
    };
    this.accountBalanceCurrent = {
      upsert: async (args) => upsert(this.accountBalances, args.where.balanceKey, args),
      deleteMany: async () => this.accountBalances.clear(),
    };
    this.projectionFailure = {
      upsert: async (args) => upsert(this.failures, args.where.failureKey, args),
      deleteMany: async (args = {}) => deleteByProjection(this.failures, args.where?.projectionName),
    };
    this.projectionCursor = {
      upsert: async (args) => {
        const key = `${args.where.projectionName_chainId.projectionName}:${args.where.projectionName_chainId.chainId}`;
        const existing = this.cursors.get(key);
        this.cursors.set(key, existing ? { ...existing, ...args.update } : { ...args.create });
      },
      deleteMany: async (args = {}) => deleteByProjection(this.cursors, args.where?.projectionName, true),
    };
  }
  async $transaction(fn) {
    return fn(this);
  }
}

function upsert(map, key, args) {
  const existing = map.get(key);
  map.set(key, existing ? { ...existing, ...args.update } : { ...args.create });
}
function deleteByProjection(map, projectionName, cursorKey = false) {
  for (const [k, v] of map) {
    const name = cursorKey ? k.split(':')[0] : v.projectionName;
    if (projectionName === undefined || name === projectionName) map.delete(k);
  }
}

class MockClient {
  constructor({ supply = [], balances = {}, fail = false } = {}) {
    this._supply = supply;
    this._balances = balances;
    this._fail = fail;
    this.balanceCalls = [];
  }
  async getSupply() {
    if (this._fail) throw new Error('REST unavailable');
    return this._supply.map((c) => ({ ...c }));
  }
  async getBalances(address) {
    this.balanceCalls.push(address);
    const coins = this._balances[address] ?? [];
    return { raw: { balances: coins } };
  }
}

const cursorOf = (p) => p.cursors.get(`${BALANCE_SNAPSHOT_PROJECTION}:${CHAIN_ID}`);

describe('balance snapshot projection', () => {
  it('writes a RewardsBalanceSample("supply") per denom with the correct sampleKey/amount/height', async () => {
    const prisma = new MockPrisma([]);
    const client = new MockClient({
      supply: [
        { denom: 'utwlt', amount: '1000000' },
        { denom: 'uother', amount: '42' },
      ],
    });
    const result = await projectBalanceSnapshot({ prisma, client, chainId: CHAIN_ID, height: 100n });

    assert.equal(result.supplyRows, 2);
    const utwlt = prisma.balanceSamples.get('100:supply:-:-:utwlt');
    assert.ok(utwlt);
    assert.equal(utwlt.sampleKind, SUPPLY_SAMPLE_KIND);
    assert.equal(utwlt.amount, '1000000');
    assert.equal(utwlt.height, 100n);
    assert.equal(utwlt.address, null);
    assert.equal(typeof utwlt.amount, 'string');
    assert.ok(prisma.balanceSamples.get('100:supply:-:-:uother'));
    assert.equal(cursorOf(prisma).status, 'idle');
    assert.equal(cursorOf(prisma).lastProjectedHeight, 100n);
  });

  it('skips malformed supply coins (empty denom/amount) instead of persisting junk rows', async () => {
    const prisma = new MockPrisma([]);
    const client = new MockClient({
      supply: [
        { denom: 'utwlt', amount: '1000000' },
        { denom: '', amount: '5' }, // malformed -> skipped
        { denom: 'ubad', amount: '' }, // malformed -> skipped
      ],
    });
    const result = await projectBalanceSnapshot({ prisma, client, chainId: CHAIN_ID, height: 100n });
    assert.equal(result.supplyRows, 1);
    assert.equal(prisma.balanceSamples.size, 1);
    assert.ok(prisma.balanceSamples.has('100:supply:-:-:utwlt'));
    assert.equal(prisma.balanceSamples.has('100:supply:-:-:'), false); // no trailing-colon junk key
  });

  it('supply rerun at the same height is idempotent (upsert by sampleKey, amount refreshed)', async () => {
    const prisma = new MockPrisma([]);
    await projectBalanceSnapshot({
      prisma,
      client: new MockClient({ supply: [{ denom: 'utwlt', amount: '1000000' }] }),
      chainId: CHAIN_ID,
      height: 100n,
    });
    await projectBalanceSnapshot({
      prisma,
      client: new MockClient({ supply: [{ denom: 'utwlt', amount: '1000500' }] }),
      chainId: CHAIN_ID,
      height: 100n,
    });
    assert.equal(prisma.balanceSamples.size, 1);
    assert.equal(prisma.balanceSamples.get('100:supply:-:-:utwlt').amount, '1000500');
  });

  it('upserts AccountBalanceCurrent per address+denom for the bounded operator/payout set only', async () => {
    const prisma = new MockPrisma([
      { operatorAddress: 'twilight1op', payoutAddress: 'twilight1pay' },
      { operatorAddress: 'twilight1op', payoutAddress: 'twilight1op' }, // dupes collapse
      { operatorAddress: null, payoutAddress: null }, // ignored
    ]);
    const client = new MockClient({
      supply: [{ denom: 'utwlt', amount: '5' }],
      balances: {
        twilight1op: [{ denom: 'utwlt', amount: '700' }, { denom: 'uother', amount: '3' }],
        twilight1pay: [{ denom: 'utwlt', amount: '200' }],
      },
    });
    const result = await projectBalanceSnapshot({ prisma, client, chainId: CHAIN_ID, height: 50n });

    assert.deepEqual([...client.balanceCalls].sort(), ['twilight1op', 'twilight1pay']); // distinct, non-null
    assert.equal(result.accountRows, 3);
    assert.equal(prisma.accountBalances.get('twilight1op:utwlt').amount, '700');
    assert.equal(prisma.accountBalances.get('twilight1op:uother').amount, '3'); // multi-denom stored
    assert.equal(prisma.accountBalances.get('twilight1pay:utwlt').amount, '200');
    assert.equal(prisma.accountBalances.get('twilight1op:utwlt').sampledAtHeight, 50n);
    assert.equal(prisma.accountBalances.get('twilight1op:utwlt').source, 'sampled');
  });

  it('latest account sample wins (rerun at a higher height refreshes amount + sampledAtHeight)', async () => {
    const prisma = new MockPrisma([{ operatorAddress: 'twilight1op', payoutAddress: null }]);
    await projectBalanceSnapshot({
      prisma,
      client: new MockClient({ supply: [], balances: { twilight1op: [{ denom: 'utwlt', amount: '700' }] } }),
      chainId: CHAIN_ID,
      height: 50n,
    });
    await projectBalanceSnapshot({
      prisma,
      client: new MockClient({ supply: [], balances: { twilight1op: [{ denom: 'utwlt', amount: '900' }] } }),
      chainId: CHAIN_ID,
      height: 80n,
    });
    assert.equal(prisma.accountBalances.size, 1);
    const row = prisma.accountBalances.get('twilight1op:utwlt');
    assert.equal(row.amount, '900');
    assert.equal(row.sampledAtHeight, 80n);
  });

  it('on chain read failure writes NO rows and records a ProjectionFailure + halted cursor', async () => {
    const prisma = new MockPrisma([{ operatorAddress: 'twilight1op', payoutAddress: null }]);
    const result = await projectBalanceSnapshot({
      prisma,
      client: new MockClient({ fail: true }),
      chainId: CHAIN_ID,
      height: 100n,
    });
    assert.equal(result.failed, true);
    assert.equal(prisma.balanceSamples.size, 0); // no guessed/partial rows
    assert.equal(prisma.accountBalances.size, 0);
    assert.equal(prisma.failures.size, 1);
    const failure = [...prisma.failures.values()][0];
    assert.equal(failure.failureKind, 'balance_snapshot_chain_read_failed');
    assert.equal(failure.projectionName, BALANCE_SNAPSHOT_PROJECTION);
    assert.equal(cursorOf(prisma).status, 'halted_error');
  });

  it('reset deletes only AccountBalanceCurrent + supply samples + balance_snapshot cursor/failures', async () => {
    const prisma = new MockPrisma([]);
    // seed: a supply sample + a module_balance sample (must survive) + account rows + cursor + failure
    prisma.balanceSamples.set('100:supply:-:-:utwlt', { sampleKind: 'supply', amount: '1' });
    prisma.balanceSamples.set('100:module_balance:-:rewards:utwlt', { sampleKind: 'module_balance', amount: '2' });
    prisma.accountBalances.set('twilight1op:utwlt', { amount: '700' });
    prisma.failures.set('k', { projectionName: BALANCE_SNAPSHOT_PROJECTION });
    prisma.failures.set('k2', { projectionName: 'rewards_snapshot_v1' }); // must survive
    prisma.cursors.set(`${BALANCE_SNAPSHOT_PROJECTION}:${CHAIN_ID}`, { status: 'idle' });
    prisma.cursors.set(`rewards_snapshot_v1:${CHAIN_ID}`, { status: 'idle' }); // must survive

    await resetBalanceSnapshotProjection(prisma);

    assert.equal(prisma.accountBalances.size, 0);
    assert.equal(prisma.balanceSamples.has('100:supply:-:-:utwlt'), false); // supply gone
    assert.equal(prisma.balanceSamples.has('100:module_balance:-:rewards:utwlt'), true); // module preserved
    assert.equal(prisma.failures.has('k'), false);
    assert.equal(prisma.failures.has('k2'), true); // other projection's failure preserved
    assert.equal(prisma.cursors.has(`${BALANCE_SNAPSHOT_PROJECTION}:${CHAIN_ID}`), false);
    assert.equal(prisma.cursors.has(`rewards_snapshot_v1:${CHAIN_ID}`), true); // other cursor preserved
  });
});
