import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURSOR_STATUS } from '../dist/cursor.js';
import { HashMismatchError, ingestHeight } from '../dist/ingest-height.js';
import { withIndexerAdvisoryLock, IndexerLockUnavailableError } from '../dist/advisory-lock.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

function loadFixture(name) {
  return JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8'));
}

function createClient(fixture) {
  const calls = [];
  return {
    calls,
    async getStatus() {
      calls.push(['getStatus']);
      return { latestBlockHeight: fixture.block.height, raw: {} };
    },
    async getBlock(height) {
      calls.push(['getBlock', height]);
      return fixture.block;
    },
    async getBlockResults(height) {
      calls.push(['getBlockResults', height]);
      return fixture.blockResults;
    },
    async getTx() {
      throw new Error('not used by height ingestion');
    },
    async getTxsByHeight(height) {
      calls.push(['getTxsByHeight', height]);
      return fixture.txs;
    },
  };
}

class MockPrisma {
  constructor(options = {}) {
    this.options = options;
    this.blocks = new Map();
    this.transactions = new Map();
    this.messages = new Map();
    this.events = new Map();
    this.accounts = new Map();
    this.decodeFailures = [];
    this.cursors = new Map();
    this.queryRawCalls = [];

    this.block = {
      findUnique: async (args) => this.blocks.get(args.where.height.toString()) ?? null,
      upsert: async (args) => upsertMap(this.blocks, args.where.height.toString(), args),
    };
    this.explorerTransaction = {
      upsert: async (args) => upsertMap(this.transactions, args.where.hash, args),
    };
    this.message = {
      upsert: async (args) => {
        const key = `${args.where.txHash_msgIndex.txHash}:${args.where.txHash_msgIndex.msgIndex}`;
        return upsertMap(this.messages, key, args);
      },
    };
    this.event = {
      upsert: async (args) => {
        if (this.options.failOnEventUpsert) throw new Error('event upsert failed');
        return upsertMap(this.events, args.where.eventKey, args);
      },
    };
    this.account = {
      upsert: async (args) => upsertMap(this.accounts, args.where.address, args),
    };
    this.decodeFailure = {
      create: async (args) => {
        this.decodeFailures.push({ ...args.data });
        return args.data;
      },
    };
    this.indexerCursor = {
      findUnique: async (args) => this.cursors.get(args.where.chainId) ?? null,
      upsert: async (args) => upsertMap(this.cursors, args.where.chainId, args),
      update: async (args) => {
        const existing = this.cursors.get(args.where.chainId) ?? {};
        const next = { ...existing, ...args.data };
        this.cursors.set(args.where.chainId, next);
        return next;
      },
    };
  }

  async $transaction(fn) {
    const clone = this.clone();
    const result = await fn(clone);
    this.blocks = clone.blocks;
    this.transactions = clone.transactions;
    this.messages = clone.messages;
    this.events = clone.events;
    this.accounts = clone.accounts;
    this.decodeFailures = clone.decodeFailures;
    this.cursors = clone.cursors;
    return result;
  }

  async $queryRaw(strings) {
    const query = strings.join('?');
    this.queryRawCalls.push(query);
    if (query.includes('pg_try_advisory_lock')) {
      return [{ acquired: this.options.lockAvailable !== false }];
    }
    return [{ released: true }];
  }

  clone() {
    const clone = new MockPrisma(this.options);
    clone.blocks = cloneMap(this.blocks);
    clone.transactions = cloneMap(this.transactions);
    clone.messages = cloneMap(this.messages);
    clone.events = cloneMap(this.events);
    clone.accounts = cloneMap(this.accounts);
    clone.decodeFailures = [...this.decodeFailures];
    clone.cursors = cloneMap(this.cursors);
    return clone;
  }
}

function upsertMap(map, key, args) {
  const existing = map.get(key);
  const next = existing ? { ...existing, ...args.update } : { ...args.create };
  map.set(key, next);
  return next;
}

function cloneMap(map) {
  return new Map([...map.entries()].map(([key, value]) => [key, { ...value }]));
}

describe('ingestHeight', () => {
  it('stores an empty block and mandatory block_results events', async () => {
    const fixture = loadFixture('empty-block.json');
    const client = createClient(fixture);
    const prisma = new MockPrisma();

    const result = await ingestHeight({
      chainId: 'twilight-test',
      height: 10n,
      latestChainHeight: 12n,
      client,
      prisma,
    });

    assert.equal(result.txCount, 0);
    assert.equal(result.eventCount, 2);
    assert.equal(prisma.blocks.size, 1);
    assert.equal(prisma.events.size, 2);
    assert.deepEqual(client.calls.map((call) => call[0]), [
      'getBlock',
      'getBlockResults',
      'getTxsByHeight',
    ]);
    assert.equal(prisma.cursors.get('twilight-test').lastIndexedHeight, 10n);
  });

  it('stores transaction, messages, tx events, accounts, and block_results events', async () => {
    const fixture = loadFixture('tx-block.json');
    const client = createClient(fixture);
    const prisma = new MockPrisma();

    const result = await ingestHeight({
      chainId: 'twilight-test',
      height: 11n,
      client,
      prisma,
    });

    assert.equal(result.txCount, 1);
    assert.equal(result.messageCount, 2);
    assert.equal(result.eventCount, 4);
    assert.equal(prisma.transactions.size, 1);
    assert.equal(prisma.messages.size, 2);
    assert.equal(prisma.events.size, 4);
    assert.equal(prisma.accounts.has('twilight1sender0000000000000000000000000000'), true);
    assert.equal(prisma.accounts.has('twilight1recipient00000000000000000000000000'), true);

    const unknownMessage = prisma.messages.get('TX11:1');
    assert.equal(unknownMessage.module, null);
    assert.equal(unknownMessage.decodeError, null);
  });

  it('is idempotent when the same height is ingested again', async () => {
    const fixture = loadFixture('tx-block.json');
    const client = createClient(fixture);
    const prisma = new MockPrisma();

    await ingestHeight({ chainId: 'twilight-test', height: 11n, client, prisma });
    await ingestHeight({ chainId: 'twilight-test', height: 11n, client, prisma });

    assert.equal(prisma.blocks.size, 1);
    assert.equal(prisma.transactions.size, 1);
    assert.equal(prisma.messages.size, 2);
    assert.equal(prisma.events.size, 4);
  });

  it('halts on block hash mismatch and does not overwrite the stored block', async () => {
    const fixture = loadFixture('empty-block.json');
    const prisma = new MockPrisma();
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

    assert.equal(prisma.blocks.get('10').hash, 'BLOCK10');
    assert.equal(prisma.cursors.get('twilight-test').status, CURSOR_STATUS.haltedHashMismatch);
  });

  it('does not advance cursor when transactional writes fail', async () => {
    const fixture = loadFixture('tx-block.json');
    const client = createClient(fixture);
    const prisma = new MockPrisma({ failOnEventUpsert: true });

    await assert.rejects(
      () => ingestHeight({ chainId: 'twilight-test', height: 11n, client, prisma }),
      /event upsert failed/,
    );

    assert.equal(prisma.blocks.size, 0);
    assert.equal(prisma.transactions.size, 0);
    assert.equal(prisma.cursors.get('twilight-test').status, CURSOR_STATUS.haltedError);
    assert.notEqual(prisma.cursors.get('twilight-test').lastIndexedHeight, 11n);
  });

  it('calls getBlockResults for every indexed height', async () => {
    const fixture = loadFixture('empty-block.json');
    const client = createClient(fixture);
    const prisma = new MockPrisma();

    await ingestHeight({ chainId: 'twilight-test', height: 10n, client, prisma });

    assert.equal(
      client.calls.some((call) => call[0] === 'getBlockResults' && call[1] === 10n),
      true,
    );
  });

  it('stores finalize_block_events with distinct idempotent event keys', async () => {
    const base = loadFixture('empty-block.json');
    const finalizeBlockEvents = [
      {
        type: 'coreslot_key_rotated',
        attributes: [
          { key: 'slot_id', value: '4', index: true },
          {
            key: 'operator_address',
            value: 'twilight10c2jwy9vnhvtznflfr9urt87l34vrat7hfqsqq',
            index: true,
          },
          { key: 'old_consensus_address', value: 'f060bf2347c76488a0390285e3b9ef3a44ec7d23', index: true },
          { key: 'new_consensus_address', value: 'fa90d27eb73b75fed0fc7587d95da6537dc76f23', index: true },
          { key: 'power', value: '1', index: true },
          { key: 'effective_height', value: '3582', index: true },
          { key: 'mode', value: 'EndBlock', index: true },
        ],
      },
      {
        type: 'coreslot_validator_update_emitted',
        attributes: [
          { key: 'slot_id', value: '4', index: true },
          {
            key: 'operator_address',
            value: 'twilight10c2jwy9vnhvtznflfr9urt87l34vrat7hfqsqq',
            index: true,
          },
          { key: 'consensus_address', value: 'f060bf2347c76488a0390285e3b9ef3a44ec7d23', index: true },
          { key: 'power', value: '0', index: true },
          { key: 'height', value: '3582', index: true },
          { key: 'mode', value: 'EndBlock', index: true },
        ],
      },
      {
        type: 'coreslot_validator_update_emitted',
        attributes: [
          { key: 'slot_id', value: '4', index: true },
          {
            key: 'operator_address',
            value: 'twilight10c2jwy9vnhvtznflfr9urt87l34vrat7hfqsqq',
            index: true,
          },
          { key: 'consensus_address', value: 'fa90d27eb73b75fed0fc7587d95da6537dc76f23', index: true },
          { key: 'power', value: '1', index: true },
          { key: 'height', value: '3582', index: true },
          { key: 'mode', value: 'EndBlock', index: true },
        ],
      },
    ];
    const fixture = structuredClone(base);
    fixture.block.height = '3582';
    fixture.block.hash = 'BLOCK3582';
    fixture.block.raw.result.block.header.height = '3582';
    fixture.block.raw.result.block_id.hash = 'BLOCK3582';
    fixture.blockResults = {
      height: '3582',
      beginBlockEvents: [{ type: 'phase_collision', attributes: [] }],
      endBlockEvents: [{ type: 'phase_collision', attributes: [] }],
      finalizeBlockEvents,
      txResults: [],
      raw: { result: { finalize_block_events: finalizeBlockEvents, txs_results: null } },
    };

    const client = createClient(fixture);
    const prisma = new MockPrisma();

    await ingestHeight({ chainId: 'twilight-test', height: 3582n, client, prisma });
    await ingestHeight({ chainId: 'twilight-test', height: 3582n, client, prisma });

    assert.equal(prisma.events.size, 5);
    assert.ok(prisma.events.has('3582:begin_block:none:0'));
    assert.ok(prisma.events.has('3582:end_block:none:0'));
    assert.ok(prisma.events.has('3582:finalize_block:none:0'));
    assert.equal(prisma.events.get('3582:finalize_block:none:0').type, 'coreslot_key_rotated');

    const finalizeEvents = [...prisma.events.values()].filter(
      (event) => event.phase === 'finalize_block',
    );
    assert.equal(
      finalizeEvents.filter((event) => event.type === 'coreslot_validator_update_emitted').length,
      2,
    );
  });

  it('decodes fallback raw tx bytes into Message rows', async () => {
    const fixture = loadFixture('empty-block.json');
    const rawTxFixture = JSON.parse(
      readFileSync(
        join(repoRoot, 'packages/decoder/test/fixtures/coreslot-update-metadata-tx.json'),
        'utf8',
      ),
    );
    const txFixture = structuredClone(fixture);
    txFixture.block.height = rawTxFixture.height;
    txFixture.block.hash = 'BLOCK120';
    txFixture.block.raw.result.block.header.height = rawTxFixture.height;
    txFixture.block.raw.result.block_id.hash = 'BLOCK120';
    txFixture.txs = [{
      hash: rawTxFixture.hash,
      height: rawTxFixture.height,
      code: 0,
      rawTxBase64: rawTxFixture.rawTxBase64,
      raw: {
        txhash: rawTxFixture.hash,
        height: rawTxFixture.height,
        code: 0,
        events: [],
        tx: { body: { messages: [] } },
        raw_tx_base64: rawTxFixture.rawTxBase64,
      },
    }];

    const prisma = new MockPrisma();
    const result = await ingestHeight({
      chainId: 'twilight-test',
      height: 120n,
      client: createClient(txFixture),
      prisma,
    });

    assert.equal(result.txCount, 1);
    assert.equal(result.messageCount, 1);
    assert.equal(prisma.decodeFailures.length, 0);

    const message = prisma.messages.get(`${rawTxFixture.hash}:0`);
    assert.equal(message.typeUrl, rawTxFixture.expectedTypeUrl);
    assert.equal(message.module, 'coreslot');
    assert.equal(message.typeName, 'MsgUpdateOperatorMetadata');
    assert.ok(message.decodedJson);
  });

  it('records fallback decode failures without halting ingestion', async () => {
    const fixture = loadFixture('empty-block.json');
    const badTxFixture = structuredClone(fixture);
    badTxFixture.block.height = '121';
    badTxFixture.block.hash = 'BLOCK121';
    badTxFixture.block.raw.result.block.header.height = '121';
    badTxFixture.block.raw.result.block_id.hash = 'BLOCK121';
    badTxFixture.txs = [{
      hash: 'BADTX',
      height: '121',
      code: 0,
      rawTxBase64: Buffer.from([1, 2, 3, 4]).toString('base64'),
      raw: {
        txhash: 'BADTX',
        height: '121',
        code: 0,
        events: [],
        tx: { body: { messages: [] } },
        raw_tx_base64: Buffer.from([1, 2, 3, 4]).toString('base64'),
      },
    }];

    const prisma = new MockPrisma();
    const result = await ingestHeight({
      chainId: 'twilight-test',
      height: 121n,
      client: createClient(badTxFixture),
      prisma,
    });

    assert.equal(result.txCount, 1);
    assert.equal(result.messageCount, 0);
    assert.equal(prisma.decodeFailures.length, 1);
    assert.equal(prisma.decodeFailures[0].failureKind, 'tx_raw_decode');
    assert.equal(prisma.cursors.get('twilight-test').status, CURSOR_STATUS.idle);
  });
});

describe('withIndexerAdvisoryLock', () => {
  it('releases the advisory lock after successful work', async () => {
    const prisma = new MockPrisma();
    const result = await withIndexerAdvisoryLock(prisma, async () => 'ok');

    assert.equal(result, 'ok');
    assert.equal(prisma.queryRawCalls.some((query) => query.includes('pg_try_advisory_lock')), true);
    assert.equal(prisma.queryRawCalls.some((query) => query.includes('pg_advisory_unlock')), true);
  });

  it('fails clearly when another indexer holds the advisory lock', async () => {
    const prisma = new MockPrisma({ lockAvailable: false });
    await assert.rejects(
      () => withIndexerAdvisoryLock(prisma, async () => 'nope'),
      IndexerLockUnavailableError,
    );
  });
});

describe('static route guards', () => {
  it('keeps unsupported standard module routes out of indexer source', () => {
    const modules = ['staking', 'gov', 'mint', 'distribution'];
    const forbidden = modules.map((moduleName) => `/cosmos/${moduleName}`);
    const offenders = [];

    for (const file of walkFiles(join(repoRoot, 'apps/indexer/src'))) {
      const text = readFileSync(file, 'utf8');
      for (const route of forbidden) {
        if (text.includes(route)) offenders.push(relative(repoRoot, file));
      }
    }

    assert.deepEqual(offenders, []);
  });
});

function walkFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walkFiles(fullPath, files);
    } else if (stat.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}
