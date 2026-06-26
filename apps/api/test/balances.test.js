import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildServer } from '../dist/server.js';
import { MockPrisma, testConfig, supplySample, accountBalance } from './mock-prisma.js';

const build = (data) => buildServer({ config: testConfig, prisma: new MockPrisma(data) });

describe('supply', () => {
  it('returns latest sampled supply with source + sampledAtHeight; amounts strings', async () => {
    const app = await build({
      rewardsBalances: [
        supplySample('utwlt', '2000000000000', 3196n, { id: 1n }),
        supplySample('uother', '5', 3196n, { id: 2n }),
      ],
    });
    const res = await app.inject({ url: '/api/v1/supply' });
    assert.equal(res.statusCode, 200);
    const d = res.json().data;
    assert.equal(d.sampledAtHeight, '3196');
    assert.equal(d.source, 'sampled');
    const utwlt = d.supply.find((c) => c.denom === 'utwlt');
    assert.equal(utwlt.amount, '2000000000000');
    assert.equal(typeof utwlt.amount, 'string');
    await app.close();
  });

  it('?height exact + ?denom filter; 404 at a height with no sample', async () => {
    const app = await build({ rewardsBalances: [supplySample('utwlt', '100', 3196n, { id: 1n })] });
    const h = await app.inject({ url: '/api/v1/supply?height=3196&denom=utwlt' });
    assert.equal(h.statusCode, 200);
    assert.equal(h.json().data.supply.length, 1);
    assert.equal(h.json().data.sampledAtHeight, '3196');
    assert.equal((await app.inject({ url: '/api/v1/supply?height=1' })).statusCode, 404);
    await app.close();
  });

  it('404 when no supply sample exists', async () => {
    const app = await build({ rewardsBalances: [] });
    assert.equal((await app.inject({ url: '/api/v1/supply' })).statusCode, 404);
    await app.close();
  });

  it('rejects an out-of-int64 height with 400', async () => {
    const app = await build({ rewardsBalances: [] });
    assert.equal((await app.inject({ url: '/api/v1/supply?height=9223372036854775808' })).statusCode, 400);
    await app.close();
  });
});

describe('account balances', () => {
  it('sampled account -> sampled:true with balances + sampledAtHeight', async () => {
    const app = await build({
      accountBalances: [accountBalance('twilight1a', 'utwlt', '700'), accountBalance('twilight1a', 'uother', '3')],
    });
    const res = await app.inject({ url: '/api/v1/accounts/twilight1a/balances' });
    const d = res.json().data;
    assert.equal(d.sampled, true);
    assert.equal(d.sampledAtHeight, '3196');
    assert.equal(d.source, 'sampled');
    assert.deepEqual(d.balances.map((b) => b.denom).sort(), ['uother', 'utwlt']);
    await app.close();
  });

  it('mixed-height rows -> only the latest sampledAtHeight is returned (internally consistent)', async () => {
    // 'ustale' kept its older height because it dropped out of the height-3196 snapshot; the response
    // must report a single height (3196) and must NOT leak the stale height-3000 coin under it.
    const app = await build({
      accountBalances: [
        accountBalance('twilight1a', 'utwlt', '700', { sampledAtHeight: 3196n }),
        accountBalance('twilight1a', 'uother', '3', { sampledAtHeight: 3196n }),
        accountBalance('twilight1a', 'ustale', '9', { sampledAtHeight: 3000n }),
      ],
    });
    const d = (await app.inject({ url: '/api/v1/accounts/twilight1a/balances' })).json().data;
    assert.equal(d.sampled, true);
    assert.equal(d.sampledAtHeight, '3196');
    assert.deepEqual(d.balances.map((b) => b.denom).sort(), ['uother', 'utwlt']);
    assert.ok(!d.balances.some((b) => b.denom === 'ustale'));
    await app.close();
  });

  it('unsampled account -> sampled:false, sampledAtHeight:null, balances:[] (no fabricated zero)', async () => {
    const app = await build({ accountBalances: [] });
    const res = await app.inject({ url: '/api/v1/accounts/twilight1unknown/balances' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().data.sampled, false);
    assert.equal(res.json().data.sampledAtHeight, null);
    assert.deepEqual(res.json().data.balances, []);
    await app.close();
  });
});
