import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CORESLOT_LIFECYCLE_PROJECTION,
  PROJECTION_STATUS,
} from '../../dist/projections/types.js';
import {
  projectCoreSlotLifecycleHeight,
  projectCoreSlotLifecycleRange,
} from '../../dist/projections/coreslot-lifecycle.js';
import { resetCoreSlotLifecycleProjection } from '../../dist/projections/reset-lifecycle.js';

const TX_HASH = 'LIFECYCLETX';
const OPERATOR = 'twilight17n30thc6ntha6rpjvk46yrwvkd86guy9crevra';
const AUTHORITY = 'twilight1authority0000000000000000000000000000';
const CONSENSUS = 'ABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD';
const CONSENSUS_LOWER = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd';

class MockLifecyclePrisma {
  constructor(options = {}) {
    this.options = options;
    this.transactions = [];
    this.messages = [];
    this.events = [];
    this.lifecycleEvents = new Map();
    this.coreSlotProjections = new Map();
    this.projectionFailures = [];
    this.projectionCursors = new Map();

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
        const typeUrls = new Set(where.typeUrl?.in ?? []);
        return this.messages.filter((message) => {
          if (where.height !== undefined && message.height !== where.height) return false;
          if (txHashes.size > 0 && !txHashes.has(message.txHash)) return false;
          if (where.module !== undefined && message.module !== where.module) return false;
          if (typeUrls.size > 0 && !typeUrls.has(message.typeUrl)) return false;
          return true;
        });
      },
    };
    this.event = {
      findMany: async (args) => {
        const where = args.where ?? {};
        const txHashes = new Set(where.txHash?.in ?? []);
        const eventTypes = new Set(where.type?.in ?? []);
        return this.events.filter((event) => {
          if (where.height !== undefined && event.height !== where.height) return false;
          if (txHashes.size > 0 && !txHashes.has(event.txHash)) return false;
          if (eventTypes.size > 0 && !eventTypes.has(event.type)) return false;
          return true;
        });
      },
    };
    this.coreSlotLifecycleEvent = {
      upsert: async (args) => {
        if (this.options.failOnLifecycleUpsert) throw new Error('lifecycle upsert failed');
        const key = args.where.sourceEventId.toString();
        const existing = this.lifecycleEvents.get(key);
        const next = existing ? { ...existing, ...args.update } : { ...args.create };
        this.lifecycleEvents.set(key, next);
        return next;
      },
      deleteMany: async () => {
        this.lifecycleEvents.clear();
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
    };
    this.projectionFailure = {
      create: async (args) => {
        this.projectionFailures.push({ ...args.data });
        return args.data;
      },
      upsert: async (args) => {
        const key = args.where.failureKey;
        const existingIndex = this.projectionFailures.findIndex((row) => row.failureKey === key);
        const next = existingIndex >= 0
          ? { ...this.projectionFailures[existingIndex], ...args.update }
          : { ...args.create };
        if (existingIndex >= 0) this.projectionFailures[existingIndex] = next;
        else this.projectionFailures.push(next);
        return next;
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

  seedLifecycleCase(kind, overrides = {}) {
    const base = lifecycleBase(kind);
    this.transactions.push(successTx({ height: base.height, ...overrides.tx }));
    this.messages.push(lifecycleMessage(kind, overrides.message));
    this.events.push(lifecycleEvent(kind, overrides.event));
  }

  async $transaction(fn) {
    const clone = this.clone();
    const result = await fn(clone);
    this.transactions = clone.transactions;
    this.messages = clone.messages;
    this.events = clone.events;
    this.lifecycleEvents = clone.lifecycleEvents;
    this.coreSlotProjections = clone.coreSlotProjections;
    this.projectionFailures = clone.projectionFailures;
    this.projectionCursors = clone.projectionCursors;
    return result;
  }

  clone() {
    const clone = new MockLifecyclePrisma(this.options);
    clone.transactions = this.transactions.map((row) => ({ ...row }));
    clone.messages = this.messages.map((row) => ({ ...row }));
    clone.events = this.events.map((row) => ({ ...row }));
    clone.lifecycleEvents = cloneMap(this.lifecycleEvents);
    clone.coreSlotProjections = cloneMap(this.coreSlotProjections);
    clone.projectionFailures = this.projectionFailures.map((row) => ({ ...row }));
    clone.projectionCursors = cloneMap(this.projectionCursors);
    return clone;
  }
}

describe('CoreSlot lifecycle projection', () => {
  it('register message plus coreslot_registered event creates CoreSlotLifecycleEvent', async () => {
    const prisma = new MockLifecyclePrisma();
    prisma.seedLifecycleCase('register');

    const result = await projectCoreSlotLifecycleHeight({
      prisma,
      chainId: 'twilight-test',
      height: 10n,
    });

    assert.equal(result.lifecycleEventsCreated, 1);
    assert.equal(prisma.lifecycleEvents.size, 1);
    const event = prisma.lifecycleEvents.get('10');
    assert.equal(event.eventType, 'coreslot_registered');
    assert.equal(event.sourceMessageId, 1n);
    assert.equal(event.slotId, 1n);
  });

  it('register updates CoreSlotProjection with PENDING, operator, and lowercase consensus address', async () => {
    const prisma = new MockLifecyclePrisma();
    prisma.seedLifecycleCase('register');

    await projectCoreSlotLifecycleHeight({ prisma, chainId: 'twilight-test', height: 10n });

    const projection = prisma.coreSlotProjections.get('1');
    assert.equal(projection.status, 'PENDING');
    assert.equal(projection.operatorAddress, OPERATOR);
    assert.equal(projection.consensusAddress, CONSENSUS_LOWER);
    assert.equal(projection.createdHeight, 10n);
  });

  it('activate updates status ACTIVE and consensusPower', async () => {
    const prisma = new MockLifecyclePrisma();
    prisma.seedLifecycleCase('activate');

    await projectCoreSlotLifecycleHeight({ prisma, chainId: 'twilight-test', height: 11n });

    const projection = prisma.coreSlotProjections.get('1');
    assert.equal(projection.status, 'ACTIVE');
    assert.equal(projection.consensusPower, 1n);
  });

  it('inactivate updates status INACTIVE and power 0', async () => {
    const prisma = new MockLifecyclePrisma();
    prisma.seedLifecycleCase('inactivate');

    await projectCoreSlotLifecycleHeight({ prisma, chainId: 'twilight-test', height: 12n });

    const projection = prisma.coreSlotProjections.get('1');
    assert.equal(projection.status, 'INACTIVE');
    assert.equal(projection.consensusPower, 0n);
  });

  it('suspend updates status SUSPENDED and captures reason/evidenceReference', async () => {
    const prisma = new MockLifecyclePrisma();
    prisma.seedLifecycleCase('suspend');

    await projectCoreSlotLifecycleHeight({ prisma, chainId: 'twilight-test', height: 13n });

    const row = prisma.lifecycleEvents.get('13');
    const projection = prisma.coreSlotProjections.get('1');
    assert.equal(projection.status, 'SUSPENDED');
    assert.equal(row.reason, 'downtime');
    assert.equal(row.evidenceReference, 'evidence://height/12');
  });

  it('remove updates status REMOVED and removedHeight', async () => {
    const prisma = new MockLifecyclePrisma();
    prisma.seedLifecycleCase('remove');

    await projectCoreSlotLifecycleHeight({ prisma, chainId: 'twilight-test', height: 14n });

    const projection = prisma.coreSlotProjections.get('1');
    assert.equal(projection.status, 'REMOVED');
    assert.equal(projection.removedHeight, 14n);
  });

  it('failed tx with lifecycle message does not project state', async () => {
    const prisma = new MockLifecyclePrisma();
    prisma.seedLifecycleCase('activate', { tx: { status: 'failed', code: 7 } });

    await projectCoreSlotLifecycleHeight({ prisma, chainId: 'twilight-test', height: 11n });

    assert.equal(prisma.lifecycleEvents.size, 0);
    assert.equal(prisma.coreSlotProjections.size, 0);
    assert.equal(prisma.projectionFailures.length, 0);
  });

  it('message without matching event creates ProjectionFailure(missing_event)', async () => {
    const prisma = new MockLifecyclePrisma();
    prisma.transactions.push(successTx({ height: 11n }));
    prisma.messages.push(lifecycleMessage('activate'));

    await projectCoreSlotLifecycleHeight({ prisma, chainId: 'twilight-test', height: 11n });

    assert.equal(prisma.lifecycleEvents.size, 0);
    assert.equal(prisma.projectionFailures.length, 1);
    assert.equal(prisma.projectionFailures[0].failureKind, 'missing_event');
  });

  it('event without matching message creates missing_message and event-only lifecycle row', async () => {
    const prisma = new MockLifecyclePrisma();
    prisma.transactions.push(successTx({ height: 11n }));
    prisma.events.push(lifecycleEvent('activate'));

    await projectCoreSlotLifecycleHeight({ prisma, chainId: 'twilight-test', height: 11n });

    assert.equal(prisma.lifecycleEvents.size, 1);
    assert.equal(prisma.lifecycleEvents.get('11').sourceMessageId, null);
    assert.equal(prisma.projectionFailures.length, 1);
    assert.equal(prisma.projectionFailures[0].failureKind, 'missing_message');
  });

  it('two matching events create ambiguous_event and no lifecycle row', async () => {
    const prisma = new MockLifecyclePrisma();
    prisma.transactions.push(successTx({ height: 11n }));
    prisma.messages.push(lifecycleMessage('activate'));
    prisma.events.push(lifecycleEvent('activate'));
    prisma.events.push(lifecycleEvent('activate', { id: 111n }));

    await projectCoreSlotLifecycleHeight({ prisma, chainId: 'twilight-test', height: 11n });

    assert.equal(prisma.lifecycleEvents.size, 0);
    assert.equal(prisma.coreSlotProjections.size, 0);
    assert.equal(prisma.projectionFailures.length, 1);
    assert.equal(prisma.projectionFailures[0].failureKind, 'ambiguous_event');
  });

  it('invalid slot_id creates ProjectionFailure(invalid_slot_id)', async () => {
    const prisma = new MockLifecyclePrisma();
    prisma.transactions.push(successTx({ height: 11n }));
    prisma.events.push(lifecycleEvent('activate', {
      attributesJson: lifecycleAttributes('activate', { slot_id: 'bad' }),
    }));

    await projectCoreSlotLifecycleHeight({ prisma, chainId: 'twilight-test', height: 11n });

    assert.equal(prisma.lifecycleEvents.size, 0);
    assert.equal(prisma.projectionFailures.length, 1);
    assert.equal(prisma.projectionFailures[0].failureKind, 'invalid_slot_id');
  });

  it('invalid consensus_address creates ProjectionFailure(invalid_consensus_address)', async () => {
    const prisma = new MockLifecyclePrisma();
    prisma.seedLifecycleCase('activate', {
      event: { attributesJson: lifecycleAttributes('activate', { consensus_address: 'not-hex' }) },
    });

    await projectCoreSlotLifecycleHeight({ prisma, chainId: 'twilight-test', height: 11n });

    assert.equal(prisma.lifecycleEvents.size, 0);
    assert.equal(prisma.projectionFailures.length, 1);
    assert.equal(prisma.projectionFailures[0].failureKind, 'invalid_consensus_address');
  });

  it('rerunning the same range is idempotent', async () => {
    const prisma = new MockLifecyclePrisma();
    prisma.seedLifecycleCase('activate');

    await projectCoreSlotLifecycleRange({
      prisma,
      chainId: 'twilight-test',
      startHeight: 11n,
      endHeight: 11n,
    });
    await projectCoreSlotLifecycleRange({
      prisma,
      chainId: 'twilight-test',
      startHeight: 11n,
      endHeight: 11n,
    });

    assert.equal(prisma.lifecycleEvents.size, 1);
    assert.equal(prisma.coreSlotProjections.size, 1);
    assert.equal(prisma.projectionFailures.length, 0);
  });

  it('reset deletes lifecycle semantic rows and preserves generic rows', async () => {
    const prisma = new MockLifecyclePrisma();
    prisma.seedLifecycleCase('activate');
    await projectCoreSlotLifecycleHeight({ prisma, chainId: 'twilight-test', height: 11n });

    await resetCoreSlotLifecycleProjection(prisma);

    assert.equal(prisma.lifecycleEvents.size, 0);
    assert.equal(prisma.projectionFailures.length, 0);
    assert.equal(prisma.transactions.length, 1);
    assert.equal(prisma.messages.length, 1);
    assert.equal(prisma.events.length, 1);
  });

  it('lifecycle projection does not clear existing metadataJson', async () => {
    const prisma = new MockLifecyclePrisma();
    prisma.coreSlotProjections.set('1', {
      slotId: 1n,
      metadataJson: { moniker: 'kept' },
      updatedHeight: 10n,
      lastSourceHeight: 10n,
    });
    prisma.seedLifecycleCase('activate');

    await projectCoreSlotLifecycleHeight({ prisma, chainId: 'twilight-test', height: 11n });

    const projection = prisma.coreSlotProjections.get('1');
    assert.deepEqual(projection.metadataJson, { moniker: 'kept' });
    assert.equal(projection.status, 'ACTIVE');
  });

  it('projection cursor does not advance on semantic write failure', async () => {
    const prisma = new MockLifecyclePrisma({ failOnLifecycleUpsert: true });
    prisma.seedLifecycleCase('activate');

    await assert.rejects(
      () => projectCoreSlotLifecycleHeight({ prisma, chainId: 'twilight-test', height: 11n }),
      /lifecycle upsert failed/,
    );

    assert.equal(prisma.lifecycleEvents.size, 0);
    const cursor = prisma.projectionCursors.get(`${CORESLOT_LIFECYCLE_PROJECTION}:twilight-test`);
    assert.equal(cursor.status, PROJECTION_STATUS.haltedError);
    assert.notEqual(cursor.lastProjectedHeight, 11n);
  });
});

function successTx(overrides = {}) {
  return {
    hash: TX_HASH,
    height: overrides.height ?? 11n,
    status: 'success',
    code: 0,
    ...overrides,
  };
}

function lifecycleMessage(kind, overrides = {}) {
  const base = lifecycleBase(kind);
  return {
    id: base.id,
    txHash: TX_HASH,
    height: base.height,
    msgIndex: 0,
    typeUrl: base.typeUrl,
    module: 'coreslot',
    decodedJson: base.decodedJson,
    rawJson: { typeUrl: base.typeUrl },
    ...overrides,
  };
}

function lifecycleEvent(kind, overrides = {}) {
  const base = lifecycleBase(kind);
  return {
    id: base.eventId,
    height: base.height,
    txHash: TX_HASH,
    msgIndex: 0,
    type: base.eventType,
    attributesJson: lifecycleAttributes(kind),
    ...overrides,
  };
}

function lifecycleBase(kind) {
  switch (kind) {
    case 'register':
      return {
        id: 1n,
        eventId: 10n,
        height: 10n,
        typeUrl: '/twilight.coreslot.v1.MsgRegisterCoreSlot',
        eventType: 'coreslot_registered',
        decodedJson: {
          authority: AUTHORITY,
          operator_address: OPERATOR,
          payout_address: 'twilight1payout000000000000000000000000000000',
          metadata: { moniker: 'register-node' },
          consensus_pubkey: { '@type': '/cosmos.crypto.ed25519.PubKey', key: 'AQID' },
        },
      };
    case 'activate':
      return {
        id: 2n,
        eventId: 11n,
        height: 11n,
        typeUrl: '/twilight.coreslot.v1.MsgActivateCoreSlot',
        eventType: 'coreslot_activated',
        decodedJson: { authority: AUTHORITY, slot_id: '1' },
      };
    case 'inactivate':
      return {
        id: 3n,
        eventId: 12n,
        height: 12n,
        typeUrl: '/twilight.coreslot.v1.MsgInactivateCoreSlot',
        eventType: 'coreslot_inactivated',
        decodedJson: { authority_or_operator: AUTHORITY, slot_id: '1', reason: 'maintenance' },
      };
    case 'suspend':
      return {
        id: 4n,
        eventId: 13n,
        height: 13n,
        typeUrl: '/twilight.coreslot.v1.MsgSuspendCoreSlot',
        eventType: 'coreslot_suspended',
        decodedJson: {
          authority: AUTHORITY,
          slot_id: '1',
          reason: 'downtime',
          evidence_reference: 'evidence://height/12',
        },
      };
    case 'remove':
      return {
        id: 5n,
        eventId: 14n,
        height: 14n,
        typeUrl: '/twilight.coreslot.v1.MsgRemoveCoreSlot',
        eventType: 'coreslot_removed',
        decodedJson: { authority: AUTHORITY, slot_id: '1', reason: 'retired' },
      };
    default:
      throw new Error(`Unknown lifecycle fixture kind: ${kind}`);
  }
}

function lifecycleAttributes(kind, overrides = {}) {
  const status = {
    register: ['UNKNOWN', 'PENDING', undefined],
    activate: ['PENDING', 'ACTIVE', '1'],
    inactivate: ['ACTIVE', 'INACTIVE', '0'],
    suspend: ['ACTIVE', 'SUSPENDED', '0'],
    remove: ['SUSPENDED', 'REMOVED', '0'],
  }[kind];
  const attrs = {
    slot_id: '1',
    operator_address: OPERATOR,
    consensus_address: CONSENSUS,
    old_status: status[0],
    new_status: status[1],
    msg_index: '0',
    ...overrides,
  };
  if (status[2] !== undefined) attrs.power = status[2];
  if (kind === 'inactivate') attrs.reason = 'maintenance';
  if (kind === 'suspend') attrs.reason = 'downtime';
  if (kind === 'remove') attrs.reason = 'retired';

  return Object.entries(attrs).map(([key, value]) => ({ key, value, index: true }));
}

function cloneMap(map) {
  return new Map([...map.entries()].map(([key, value]) => [key, { ...value }]));
}

function cursorKey(value) {
  return `${value.projectionName}:${value.chainId}`;
}
