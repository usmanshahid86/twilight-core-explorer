import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildServer } from '../dist/server.js';
import { MockPrisma, testConfig, block, tx, account, coreSlot } from './mock-prisma.js';

const build = (data) => buildServer({ config: testConfig, prisma: new MockPrisma(data) });
const HEX_A = 'A'.repeat(64);
const HEX_B = 'B'.repeat(64);

describe('search', () => {
  it('resolves a numeric query to a block reference', async () => {
    const app = await build({ blocks: [block(42, { hash: HEX_A })] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=42' });
    assert.deepEqual(res.json().data, [{ type: 'block', height: '42', hash: HEX_A }]);
    await app.close();
  });

  it('resolves a 64-hex block hash (case-insensitively) to a block reference', async () => {
    const app = await build({ blocks: [block(42, { hash: HEX_A })] });
    const res = await app.inject({ method: 'GET', url: `/api/v1/search?q=${HEX_A.toLowerCase()}` });
    assert.deepEqual(res.json().data, [{ type: 'block', height: '42', hash: HEX_A }]);
    await app.close();
  });

  it('resolves a 64-hex tx hash to a transaction reference', async () => {
    const app = await build({ txs: [tx(HEX_B, 9, 0)] });
    const res = await app.inject({ method: 'GET', url: `/api/v1/search?q=${HEX_B}` });
    assert.deepEqual(res.json().data, [{ type: 'transaction', hash: HEX_B, height: '9' }]);
    await app.close();
  });

  it('returns both refs when a 64-hex matches a block hash and a tx hash', async () => {
    const app = await build({ blocks: [block(1, { hash: HEX_A })], txs: [tx(HEX_A, 1, 0)] });
    const res = await app.inject({ method: 'GET', url: `/api/v1/search?q=${HEX_A}` });
    const types = res.json().data.map((r) => r.type).sort();
    assert.deepEqual(types, ['block', 'transaction']);
    await app.close();
  });

  it('resolves a bech32 address to an account reference', async () => {
    const app = await build({ accounts: [account('twilight1abc')] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=twilight1abc' });
    assert.deepEqual(res.json().data, [{ type: 'account', address: 'twilight1abc' }]);
    await app.close();
  });

  it('returns empty data for an unresolvable query', async () => {
    const app = await build({});
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=zzz' });
    assert.deepEqual(res.json().data, []);
    await app.close();
  });

  it('rejects an empty q with 400 invalid_query', async () => {
    const app = await build({});
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=' });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'invalid_query');
    await app.close();
  });

  it('rejects a whitespace-only q with 400 invalid_query', async () => {
    const app = await build({});
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=%20%20' });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'invalid_query');
    await app.close();
  });

  // ---- 9c CoreSlot reference extensions ----

  it('a numeric query returns both block and coreslot references', async () => {
    const app = await build({ blocks: [block(2, { hash: HEX_A })], coreSlots: [coreSlot(2)] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=2' });
    const types = res.json().data.map((r) => r.type).sort();
    assert.deepEqual(types, ['block', 'coreslot']);
    assert.ok(res.json().data.find((r) => r.type === 'coreslot' && r.slotId === '2'));
    await app.close();
  });

  it('a 40-hex consensus address resolves to a coreslot reference (role consensus)', async () => {
    const app = await build({ coreSlots: [coreSlot(3, { consensusAddress: 'a'.repeat(40) })] });
    const res = await app.inject({ method: 'GET', url: `/api/v1/search?q=${'A'.repeat(40)}` });
    assert.deepEqual(res.json().data, [{ type: 'coreslot', slotId: '3', role: 'consensus' }]);
    await app.close();
  });

  it('an operator bech32 address returns account + coreslot operator-role references', async () => {
    const app = await build({
      accounts: [account('twilight1op7')],
      coreSlots: [coreSlot(7, { operatorAddress: 'twilight1op7' })],
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=twilight1op7' });
    const types = res.json().data.map((r) => r.type).sort();
    assert.deepEqual(types, ['account', 'coreslot']);
    assert.ok(res.json().data.find((r) => r.type === 'coreslot' && r.role === 'operator' && r.slotId === '7'));
    await app.close();
  });
});
