import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CORESLOT_METADATA_EVENT_TYPE,
  CORESLOT_METADATA_PROJECTION,
  CORESLOT_METADATA_TYPE_URL,
  PROJECTION_STATUS,
} from '../../dist/projections/types.js';
import {
  projectCoreSlotMetadataHeight,
  projectCoreSlotMetadataRange,
} from '../../dist/projections/coreslot-metadata.js';
import { resetCoreSlotMetadataProjection } from '../../dist/projections/reset.js';

const TX_HASH = '2BF1A0557CBBA9FAB26671E471BDEC36A24A823032FFC91AF529092655E78A81';
const OPERATOR = 'twilight17n30thc6ntha6rpjvk46yrwvkd86guy9crevra';

class MockProjectionPrisma {
  constructor(options = {}) {
    this.options = options;
    this.transactions = [];
    this.messages = [];
    this.events = [];
    this.metadataChanges = new Map();
    this.coreSlotProjections = new Map();
    this.projectionFailures = [];
    this.projectionCursors = new Map();
    this.genericRowsTouched = { transactions: this.transactions };

    this.explorerTransaction = {
      findMany: async (args) => {
        const where = args.where ?? {};
        return this.transactions.filter((transaction) => {
          if (where.height !== undefined && transaction.height !== where.height) return false;
          return transaction.status === 'success' || transaction.code === 0;
        });
      },
    };
    this.message = {
      findMany: async (args) => {
        const where = args.where ?? {};
        const txHashes = new Set(where.txHash?.in ?? []);
        return this.messages.filter((message) => {
          if (where.height !== undefined && message.height !== where.height) return false;
          if (txHashes.size > 0 && !txHashes.has(message.txHash)) return false;
          if (where.module !== undefined && message.module !== where.module) return false;
          if (where.typeUrl !== undefined && message.typeUrl !== where.typeUrl) return false;
          return true;
        });
      },
    };
    this.event = {
      findMany: async (args) => {
        const where = args.where ?? {};
        const txHashes = new Set(where.txHash?.in ?? []);
        return this.events.filter((event) => {
          if (where.height !== undefined && event.height !== where.height) return false;
          if (txHashes.size > 0 && !txHashes.has(event.txHash)) return false;
          if (where.type !== undefined && event.type !== where.type) return false;
          return true;
        });
      },
    };
    this.coreSlotMetadataChange = {
      upsert: async (args) => {
        if (this.options.failOnMetadataUpsert) throw new Error('metadata upsert failed');
        const key = args.where.sourceMessageId.toString();
        const existing = this.metadataChanges.get(key);
        const next = existing ? { ...existing, ...args.update } : { ...args.create };
        this.metadataChanges.set(key, next);
        return next;
      },
      deleteMany: async () => {
        this.metadataChanges.clear();
        return { count: 0 };
      },
    };
    this.coreSlotProjection = {
      upsert: async (args) => {
        const key = args.where.slotId.toString();
        const existing = this.coreSlotProjections.get(key);
        const next = existing ? { ...existing, ...args.update } : { ...args.create };
        this.coreSlotProjections.set(key, next);
        return next;
      },
      deleteMany: async () => {
        this.coreSlotProjections.clear();
        return { count: 0 };
      },
    };
    this.projectionFailure = {
      create: async (args) => {
        this.projectionFailures.push({ ...args.data });
        return args.data;
      },
      deleteMany: async (args) => {
        const where = args.where ?? {};
        const before = this.projectionFailures.length;
        this.projectionFailures = this.projectionFailures.filter((failure) => {
          if (where.projectionName !== undefined && failure.projectionName !== where.projectionName) {
            return true;
          }
          if (where.sourceHeight !== undefined && failure.sourceHeight !== where.sourceHeight) {
            return true;
          }
          if (where.resolved !== undefined && failure.resolved !== where.resolved) {
            return true;
          }
          return false;
        });
        return { count: before - this.projectionFailures.length };
      },
    };
    this.projectionCursor = {
      upsert: async (args) => {
        const key = cursorKey(args.where.projectionName_chainId ?? args.create);
        const existing = this.projectionCursors.get(key);
        const next = existing ? { ...existing, ...args.update } : { ...args.create };
        this.projectionCursors.set(key, next);
        return next;
      },
      deleteMany: async (args) => {
        const where = args.where ?? {};
        for (const [key, cursor] of [...this.projectionCursors.entries()]) {
          if (cursor.projectionName === where.projectionName) this.projectionCursors.delete(key);
        }
        return { count: 0 };
      },
    };
  }

  seedSuccessfulMetadataCase() {
    this.transactions.push(successTx());
    this.messages.push(metadataMessage());
    this.events.push(metadataEvent());
  }

  async $transaction(fn) {
    const clone = this.clone();
    const result = await fn(clone);
    this.transactions = clone.transactions;
    this.messages = clone.messages;
    this.events = clone.events;
    this.metadataChanges = clone.metadataChanges;
    this.coreSlotProjections = clone.coreSlotProjections;
    this.projectionFailures = clone.projectionFailures;
    this.projectionCursors = clone.projectionCursors;
    return result;
  }

  clone() {
    const clone = new MockProjectionPrisma(this.options);
    clone.transactions = this.transactions.map((row) => ({ ...row }));
    clone.messages = this.messages.map((row) => ({ ...row }));
    clone.events = this.events.map((row) => ({ ...row }));
    clone.metadataChanges = cloneMap(this.metadataChanges);
    clone.coreSlotProjections = cloneMap(this.coreSlotProjections);
    clone.projectionFailures = this.projectionFailures.map((row) => ({ ...row }));
    clone.projectionCursors = cloneMap(this.projectionCursors);
    return clone;
  }
}

describe('CoreSlot metadata projection', () => {
  it('creates CoreSlotMetadataChange for a successful message and matching event', async () => {
    const prisma = new MockProjectionPrisma();
    prisma.seedSuccessfulMetadataCase();

    const result = await projectCoreSlotMetadataHeight({
      prisma,
      chainId: 'twilight-test',
      height: 120n,
    });

    assert.equal(result.changesCreated, 1);
    assert.equal(prisma.metadataChanges.size, 1);
    const change = prisma.metadataChanges.get('1');
    assert.equal(change.slotId, 1n);
    assert.equal(change.operatorAddress, OPERATOR);
    assert.deepEqual(change.metadataJson, { moniker: 'explorer-smoke-1782273257' });
    assert.equal(change.sourceEventId, 10n);
  });

  it('updates CoreSlotProjection metadata from a confirmed message and event pair', async () => {
    const prisma = new MockProjectionPrisma();
    prisma.seedSuccessfulMetadataCase();

    await projectCoreSlotMetadataHeight({ prisma, chainId: 'twilight-test', height: 120n });

    const projection = prisma.coreSlotProjections.get('1');
    assert.equal(projection.operatorAddress, OPERATOR);
    assert.deepEqual(projection.metadataJson, { moniker: 'explorer-smoke-1782273257' });
    assert.equal(projection.updatedHeight, 120n);
    assert.equal(projection.lastSourceMessageId, 1n);
    assert.equal(projection.lastSourceEventId, 10n);
  });

  it('does not project failed transactions', async () => {
    const prisma = new MockProjectionPrisma();
    prisma.transactions.push({ ...successTx(), status: 'failed', code: 7 });
    prisma.messages.push(metadataMessage());
    prisma.events.push(metadataEvent());

    await projectCoreSlotMetadataHeight({ prisma, chainId: 'twilight-test', height: 120n });

    assert.equal(prisma.metadataChanges.size, 0);
    assert.equal(prisma.coreSlotProjections.size, 0);
    assert.equal(prisma.projectionFailures.length, 0);
  });

  it('records missing_event when a metadata message has no matching effect event', async () => {
    const prisma = new MockProjectionPrisma();
    prisma.transactions.push(successTx());
    prisma.messages.push(metadataMessage());

    await projectCoreSlotMetadataHeight({ prisma, chainId: 'twilight-test', height: 120n });

    assert.equal(prisma.metadataChanges.size, 0);
    assert.equal(prisma.projectionFailures.length, 1);
    assert.equal(prisma.projectionFailures[0].failureKind, 'missing_event');
  });

  it('records missing_message when a metadata event has no matching message', async () => {
    const prisma = new MockProjectionPrisma();
    prisma.transactions.push(successTx());
    prisma.events.push(metadataEvent());

    await projectCoreSlotMetadataHeight({ prisma, chainId: 'twilight-test', height: 120n });

    assert.equal(prisma.metadataChanges.size, 0);
    assert.equal(prisma.projectionFailures.length, 1);
    assert.equal(prisma.projectionFailures[0].failureKind, 'missing_message');
  });

  it('records ambiguous_event when two events match one metadata message', async () => {
    const prisma = new MockProjectionPrisma();
    prisma.transactions.push(successTx());
    prisma.messages.push(metadataMessage());
    prisma.events.push(metadataEvent());
    prisma.events.push({ ...metadataEvent(), id: 11n });

    await projectCoreSlotMetadataHeight({ prisma, chainId: 'twilight-test', height: 120n });

    assert.equal(prisma.metadataChanges.size, 0);
    assert.equal(prisma.coreSlotProjections.size, 0);
    assert.equal(prisma.projectionFailures.length, 1);
    assert.equal(prisma.projectionFailures[0].failureKind, 'ambiguous_event');
  });

  it('records missing_required_payload when decoded metadata payload is incomplete', async () => {
    const prisma = new MockProjectionPrisma();
    prisma.transactions.push(successTx());
    prisma.messages.push(metadataMessage({ decodedJson: { slot_id: '1', operator: OPERATOR } }));
    prisma.events.push(metadataEvent());

    await projectCoreSlotMetadataHeight({ prisma, chainId: 'twilight-test', height: 120n });

    assert.equal(prisma.metadataChanges.size, 0);
    assert.equal(prisma.projectionFailures.length, 2);
    assert.equal(prisma.projectionFailures[0].failureKind, 'missing_required_payload');
    assert.equal(prisma.projectionFailures[1].failureKind, 'missing_message');
  });

  it('is idempotent when rerunning the same range', async () => {
    const prisma = new MockProjectionPrisma();
    prisma.seedSuccessfulMetadataCase();

    await projectCoreSlotMetadataRange({
      prisma,
      chainId: 'twilight-test',
      startHeight: 120n,
      endHeight: 120n,
    });
    await projectCoreSlotMetadataRange({
      prisma,
      chainId: 'twilight-test',
      startHeight: 120n,
      endHeight: 120n,
    });

    assert.equal(prisma.metadataChanges.size, 1);
    assert.equal(prisma.coreSlotProjections.size, 1);
    assert.equal(prisma.projectionFailures.length, 0);
  });

  it('reset deletes only CoreSlot metadata projection rows and preserves generic rows', async () => {
    const prisma = new MockProjectionPrisma();
    prisma.seedSuccessfulMetadataCase();
    await projectCoreSlotMetadataHeight({ prisma, chainId: 'twilight-test', height: 120n });
    prisma.projectionFailures.push({
      projectionName: CORESLOT_METADATA_PROJECTION,
      sourceHeight: 120n,
      failureKind: 'missing_event',
    });

    await resetCoreSlotMetadataProjection(prisma);

    assert.equal(prisma.metadataChanges.size, 0);
    assert.equal(prisma.coreSlotProjections.size, 0);
    assert.equal(prisma.projectionFailures.length, 0);
    assert.equal(prisma.transactions.length, 1);
    assert.equal(prisma.messages.length, 1);
    assert.equal(prisma.events.length, 1);
  });

  it('does not advance projection cursor when semantic writes fail', async () => {
    const prisma = new MockProjectionPrisma({ failOnMetadataUpsert: true });
    prisma.seedSuccessfulMetadataCase();

    await assert.rejects(
      () => projectCoreSlotMetadataHeight({ prisma, chainId: 'twilight-test', height: 120n }),
      /metadata upsert failed/,
    );

    assert.equal(prisma.metadataChanges.size, 0);
    const cursor = prisma.projectionCursors.get(`${CORESLOT_METADATA_PROJECTION}:twilight-test`);
    assert.equal(cursor.status, PROJECTION_STATUS.haltedError);
    assert.notEqual(cursor.lastProjectedHeight, 120n);
  });
});

function successTx() {
  return {
    hash: TX_HASH,
    height: 120n,
    status: 'success',
    code: 0,
  };
}

function metadataMessage(overrides = {}) {
  return {
    id: 1n,
    txHash: TX_HASH,
    height: 120n,
    msgIndex: 0,
    typeUrl: CORESLOT_METADATA_TYPE_URL,
    module: 'coreslot',
    decodedJson: {
      slot_id: '1',
      operator: OPERATOR,
      metadata: { moniker: 'explorer-smoke-1782273257' },
    },
    rawJson: { typeUrl: CORESLOT_METADATA_TYPE_URL },
    ...overrides,
  };
}

function metadataEvent(overrides = {}) {
  return {
    id: 10n,
    height: 120n,
    txHash: TX_HASH,
    msgIndex: 0,
    type: CORESLOT_METADATA_EVENT_TYPE,
    attributesJson: [
      { key: 'slot_id', value: '1', index: true },
      { key: 'operator_address', value: OPERATOR, index: true },
      { key: 'msg_index', value: '0', index: true },
    ],
    ...overrides,
  };
}

function cloneMap(map) {
  return new Map([...map.entries()].map(([key, value]) => [key, { ...value }]));
}

function cursorKey(value) {
  return `${value.projectionName}:${value.chainId}`;
}
