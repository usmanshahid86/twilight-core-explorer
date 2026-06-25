import assert from 'node:assert/strict';
import { before, beforeEach, after, describe, it } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { ingestRewardsSnapshot } from '../../dist/projections/rewards-snapshot.js';

// Real-Postgres coverage for the bug class that the in-memory mock cannot catch: upserting a
// RewardsBalanceSample whose address/moduleName are NULL (e.g. cumulative_emitted). The old
// nullable compound @@unique could not be used as a Prisma upsert selector; the sampleKey
// fix is exercised here against an actual database.
const shouldRun = process.env.RUN_INTEGRATION_TESTS === '1';

if (!shouldRun) {
  it('skips rewards snapshot Postgres integration unless RUN_INTEGRATION_TESTS=1', { skip: true }, () => {});
} else {
  describe('ingestRewardsSnapshot with real Prisma/Postgres', () => {
    let prisma;

    before(() => {
      const url = process.env.TEST_DATABASE_URL;
      assert.ok(url, 'TEST_DATABASE_URL is required');
      assert.match(url, /_test/, 'TEST_DATABASE_URL must point to a _test database');
      prisma = new PrismaClient({ datasources: { db: { url } } });
    });

    beforeEach(async () => {
      await prisma.rewardsBalanceSample.deleteMany();
      await prisma.slotRewardProjection.deleteMany();
      await prisma.projectionCursor.deleteMany({ where: { projectionName: 'rewards_snapshot_v1' } });
    });

    after(async () => {
      await prisma?.$disconnect();
    });

    const client = {
      getSlotRewards: async () => ({ raw: { rewards: [], pagination: { next_key: '' } } }),
      getModuleBalances: async () => ({
        raw: { balances: [{ denom: 'utwlt', amount: '999', module_name: 'rewards' }] },
      }),
      // null address + null moduleName — the previously-failing case.
      getCumulativeEmitted: async () => ({ raw: { amount: '5000', denom: 'utwlt' } }),
    };

    it('upserts a null-address cumulative sample and is idempotent on re-sample', async () => {
      const args = { prisma, client, chainId: 'twilight-test', height: 200n, slotIds: [] };

      const first = await ingestRewardsSnapshot(args);
      assert.equal(first.balanceSamples, 2);

      const second = await ingestRewardsSnapshot(args);
      assert.equal(second.balanceSamples, 2);

      const total = await prisma.rewardsBalanceSample.count();
      assert.equal(total, 2, 'samples deduped by sampleKey across re-sampling');

      const cumulative = await prisma.rewardsBalanceSample.findFirst({
        where: { sampleKind: 'cumulative_emitted' },
      });
      assert.ok(cumulative, 'null-address cumulative sample was written');
      assert.equal(cumulative.address, null);
      assert.equal(cumulative.amount, '5000');
    });
  });
}
