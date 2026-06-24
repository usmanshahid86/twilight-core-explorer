import assert from 'node:assert/strict';
import { before, beforeEach, after, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { CURSOR_STATUS } from '../dist/cursor.js';
import { HashMismatchError, ingestHeight } from '../dist/ingest-height.js';
import { withIndexerAdvisoryLock } from '../dist/advisory-lock.js';

const shouldRun = process.env.RUN_INTEGRATION_TESTS === '1';
const here = dirname(fileURLToPath(import.meta.url));

if (!shouldRun) {
  it('skips Postgres integration tests unless RUN_INTEGRATION_TESTS=1', { skip: true }, () => {});
} else {
  describe('ingestHeight with real Prisma/Postgres', () => {
    let prisma;

    before(() => {
      const datasourceUrl = process.env.TEST_DATABASE_URL;
      assert.ok(datasourceUrl, 'TEST_DATABASE_URL is required');
      assert.match(datasourceUrl, /_test/, 'TEST_DATABASE_URL must point to a _test database');
      prisma = new PrismaClient({
        datasources: {
          db: { url: datasourceUrl },
        },
      });
    });

    beforeEach(async () => {
      await clearDatabase(prisma);
    });

    after(async () => {
      await prisma?.$disconnect();
    });

    it('writes empty block, block_results events, and cursor success', async () => {
      const fixture = loadFixture('empty-block.json');
      const result = await ingestHeight({
        chainId: 'twilight-test',
        height: 10n,
        latestChainHeight: 12n,
        client: createClient(fixture),
        prisma,
      });

      assert.equal(result.eventCount, 2);
      assert.equal(await prisma.block.count(), 1);
      assert.equal(await prisma.event.count(), 2);
      assert.equal(await prisma.explorerTransaction.count(), 0);

      const cursor = await prisma.indexerCursor.findUnique({
        where: { chainId: 'twilight-test' },
      });
      assert.equal(cursor.lastIndexedHeight, 10n);
      assert.equal(cursor.lastIndexedHash, 'BLOCK10');
      assert.equal(cursor.latestChainHeight, 12n);
      assert.equal(cursor.status, CURSOR_STATUS.idle);
    });

    it('writes tx block rows, messages, events, accounts, and cursor success', async () => {
      const fixture = loadFixture('tx-block.json');
      await ingestHeight({
        chainId: 'twilight-test',
        height: 11n,
        client: createClient(fixture),
        prisma,
      });

      assert.equal(await prisma.block.count(), 1);
      assert.equal(await prisma.explorerTransaction.count(), 1);
      assert.equal(await prisma.message.count(), 2);
      assert.equal(await prisma.event.count(), 4);
      assert.equal(await prisma.account.count(), 4);

      const unknownMessage = await prisma.message.findUnique({
        where: { txHash_msgIndex: { txHash: 'TX11', msgIndex: 1 } },
      });
      assert.equal(unknownMessage.module, null);
      assert.equal(unknownMessage.typeName, 'MsgMystery');

      const cursor = await prisma.indexerCursor.findUnique({
        where: { chainId: 'twilight-test' },
      });
      assert.equal(cursor.lastIndexedHeight, 11n);
      assert.equal(cursor.status, CURSOR_STATUS.idle);
    });

    it('re-ingests idempotently without duplicating durable rows', async () => {
      const fixture = loadFixture('tx-block.json');
      const client = createClient(fixture);

      await ingestHeight({ chainId: 'twilight-test', height: 11n, client, prisma });
      await ingestHeight({ chainId: 'twilight-test', height: 11n, client, prisma });

      assert.equal(await prisma.block.count(), 1);
      assert.equal(await prisma.explorerTransaction.count(), 1);
      assert.equal(await prisma.message.count(), 2);
      assert.equal(await prisma.event.count(), 4);
    });

    it('halts on hash mismatch without overwriting the existing block', async () => {
      const fixture = loadFixture('empty-block.json');
      await ingestHeight({
        chainId: 'twilight-test',
        height: 10n,
        client: createClient(fixture),
        prisma,
      });

      const changedFixture = structuredClone(fixture);
      changedFixture.block.hash = 'DIFFERENT10';
      changedFixture.block.raw.result.block_id.hash = 'DIFFERENT10';

      await assert.rejects(
        () => ingestHeight({
          chainId: 'twilight-test',
          height: 10n,
          client: createClient(changedFixture),
          prisma,
        }),
        HashMismatchError,
      );

      const block = await prisma.block.findUnique({ where: { height: 10n } });
      const cursor = await prisma.indexerCursor.findUnique({
        where: { chainId: 'twilight-test' },
      });

      assert.equal(block.hash, 'BLOCK10');
      assert.equal(cursor.status, CURSOR_STATUS.haltedHashMismatch);
      assert.match(cursor.error, /Hash mismatch/);
    });

    it('does not advance cursor when a height source call fails', async () => {
      const fixture = loadFixture('tx-block.json');
      const client = createClient(fixture, { failTxsByHeight: true });

      await assert.rejects(
        () => ingestHeight({ chainId: 'twilight-test', height: 11n, client, prisma }),
        /tx source failed/,
      );

      assert.equal(await prisma.block.count(), 0);
      assert.equal(await prisma.explorerTransaction.count(), 0);

      const cursor = await prisma.indexerCursor.findUnique({
        where: { chainId: 'twilight-test' },
      });
      assert.equal(cursor.status, CURSOR_STATUS.haltedError);
      assert.equal(cursor.lastIndexedHeight, 10n);
      assert.match(cursor.error, /tx source failed/);
    });

    it('acquires and releases the advisory lock against Postgres', async () => {
      const result = await withIndexerAdvisoryLock(prisma, async () => 'locked');
      assert.equal(result, 'locked');
    });
  });
}

function loadFixture(name) {
  return JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8'));
}

function createClient(fixture, options = {}) {
  return {
    async getStatus() {
      return { latestBlockHeight: fixture.block.height, raw: {} };
    },
    async getBlock() {
      return fixture.block;
    },
    async getBlockResults() {
      if (options.failBlockResults) throw new Error('block_results source failed');
      return fixture.blockResults;
    },
    async getTx() {
      throw new Error('not used by height ingestion');
    },
    async getTxsByHeight() {
      if (options.failTxsByHeight) throw new Error('tx source failed');
      return fixture.txs;
    },
  };
}

async function clearDatabase(prisma) {
  await prisma.decodeFailure.deleteMany();
  await prisma.event.deleteMany();
  await prisma.message.deleteMany();
  await prisma.explorerTransaction.deleteMany();
  await prisma.account.deleteMany();
  await prisma.block.deleteMany();
  await prisma.indexerCursor.deleteMany();
}
