import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CORESLOT_PARAMS_PROJECTION,
  CORESLOT_PAYOUT_PROJECTION,
} from '../../dist/projections/types.js';
import {
  projectCoreSlotPayoutHeight,
  projectCoreSlotPayoutRange,
} from '../../dist/projections/coreslot-payout.js';
import {
  projectCoreSlotParamsHeight,
  projectCoreSlotParamsRange,
} from '../../dist/projections/coreslot-params.js';
import { resetCoreSlotPayoutProjection } from '../../dist/projections/reset-payout.js';
import { resetCoreSlotParamsProjection } from '../../dist/projections/reset-params.js';

const TX_HASH = 'PAYOUTPARAMSTX';
const OPERATOR = 'twilight17n30thc6ntha6rpjvk46yrwvkd86guy9crevra';
const PAYOUT = 'twilight1payout000000000000000000000000000000';
const AUTHORITY = 'twilight1authority0000000000000000000000000000';

class MockChangePrisma {
  constructor() {
    this.transactions = [];
    this.messages = [];
    this.events = [];
    this.payoutChanges = new Map();
    this.parameterChanges = new Map();
    this.metadataChanges = new Map();
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
    this.coreSlotPayoutChange = {
      upsert: async (args) => {
        const key = args.where.sourceMessageId.toString();
        const existing = this.payoutChanges.get(key);
        const next = existing ? { ...existing, ...args.update } : { ...args.create };
        this.payoutChanges.set(key, next);
        return next;
      },
      deleteMany: async () => {
        this.payoutChanges.clear();
        return { count: 0 };
      },
    };
    this.coreSlotParameterChange = {
      upsert: async (args) => {
        const key = args.where.sourceMessageId.toString();
        const existing = this.parameterChanges.get(key);
        const next = existing ? { ...existing, ...args.update } : { ...args.create };
        this.parameterChanges.set(key, next);
        return next;
      },
      deleteMany: async () => {
        this.parameterChanges.clear();
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

  seedPayoutCase(overrides = {}) {
    this.transactions.push(successTx(overrides.tx));
    this.messages.push(payoutMessage(overrides.message));
    this.events.push(payoutEvent(overrides.event));
  }

  seedParamsCase(overrides = {}) {
    this.transactions.push(successTx({ height: 31n, ...overrides.tx }));
    this.messages.push(paramsMessage(overrides.message));
    this.events.push(paramsEvent(overrides.event));
  }

  async $transaction(fn) {
    const clone = this.clone();
    const result = await fn(clone);
    this.transactions = clone.transactions;
    this.messages = clone.messages;
    this.events = clone.events;
    this.payoutChanges = clone.payoutChanges;
    this.parameterChanges = clone.parameterChanges;
    this.metadataChanges = clone.metadataChanges;
    this.lifecycleEvents = clone.lifecycleEvents;
    this.coreSlotProjections = clone.coreSlotProjections;
    this.projectionFailures = clone.projectionFailures;
    this.projectionCursors = clone.projectionCursors;
    return result;
  }

  clone() {
    const clone = new MockChangePrisma();
    clone.transactions = this.transactions.map((row) => ({ ...row }));
    clone.messages = this.messages.map((row) => ({ ...row }));
    clone.events = this.events.map((row) => ({ ...row }));
    clone.payoutChanges = cloneMap(this.payoutChanges);
    clone.parameterChanges = cloneMap(this.parameterChanges);
    clone.metadataChanges = cloneMap(this.metadataChanges);
    clone.lifecycleEvents = cloneMap(this.lifecycleEvents);
    clone.coreSlotProjections = cloneMap(this.coreSlotProjections);
    clone.projectionFailures = this.projectionFailures.map((row) => ({ ...row }));
    clone.projectionCursors = cloneMap(this.projectionCursors);
    return clone;
  }
}

describe('CoreSlot payout projection', () => {
  it('payout message plus matching event creates CoreSlotPayoutChange', async () => {
    const prisma = new MockChangePrisma();
    prisma.seedPayoutCase();

    const result = await projectCoreSlotPayoutHeight({
      prisma,
      chainId: 'twilight-test',
      height: 30n,
    });

    assert.equal(result.changesCreated, 1);
    assert.equal(prisma.payoutChanges.size, 1);
    const change = prisma.payoutChanges.get('20');
    assert.equal(change.slotId, 1n);
    assert.equal(change.operatorAddress, OPERATOR);
    assert.equal(change.newPayoutAddress, PAYOUT);
    assert.equal(change.sourceEventId, 200n);
  });

  it('payout message plus matching event updates CoreSlotProjection payoutAddress', async () => {
    const prisma = new MockChangePrisma();
    prisma.seedPayoutCase();

    await projectCoreSlotPayoutHeight({ prisma, chainId: 'twilight-test', height: 30n });

    const projection = prisma.coreSlotProjections.get('1');
    assert.equal(projection.payoutAddress, PAYOUT);
    assert.equal(projection.lastSourceMessageId, 20n);
    assert.equal(projection.lastSourceEventId, 200n);
  });

  it('payout projection preserves metadataJson and lifecycle-owned fields', async () => {
    const prisma = new MockChangePrisma();
    prisma.coreSlotProjections.set('1', {
      slotId: 1n,
      metadataJson: { moniker: 'kept' },
      status: 'ACTIVE',
      consensusAddress: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
      consensusPower: 1n,
      updatedHeight: 29n,
      lastSourceHeight: 29n,
    });
    prisma.seedPayoutCase();

    await projectCoreSlotPayoutHeight({ prisma, chainId: 'twilight-test', height: 30n });

    const projection = prisma.coreSlotProjections.get('1');
    assert.deepEqual(projection.metadataJson, { moniker: 'kept' });
    assert.equal(projection.status, 'ACTIVE');
    assert.equal(projection.consensusPower, 1n);
    assert.equal(projection.payoutAddress, PAYOUT);
  });

  it('failed tx with payout message does not project', async () => {
    const prisma = new MockChangePrisma();
    prisma.seedPayoutCase({ tx: { status: 'failed', code: 7 } });

    await projectCoreSlotPayoutHeight({ prisma, chainId: 'twilight-test', height: 30n });

    assert.equal(prisma.payoutChanges.size, 0);
    assert.equal(prisma.coreSlotProjections.size, 0);
    assert.equal(prisma.projectionFailures.length, 0);
  });

  it('payout message without matching event creates missing_event', async () => {
    const prisma = new MockChangePrisma();
    prisma.transactions.push(successTx());
    prisma.messages.push(payoutMessage());

    await projectCoreSlotPayoutHeight({ prisma, chainId: 'twilight-test', height: 30n });

    assert.equal(prisma.payoutChanges.size, 0);
    assert.equal(prisma.projectionFailures.length, 1);
    assert.equal(prisma.projectionFailures[0].failureKind, 'missing_event');
    assert.ok(prisma.projectionFailures[0].failureKey);
  });

  it('payout event without matching message creates missing_message and no payout change', async () => {
    const prisma = new MockChangePrisma();
    prisma.transactions.push(successTx());
    prisma.events.push(payoutEvent());

    await projectCoreSlotPayoutHeight({ prisma, chainId: 'twilight-test', height: 30n });

    assert.equal(prisma.payoutChanges.size, 0);
    assert.equal(prisma.projectionFailures.length, 1);
    assert.equal(prisma.projectionFailures[0].failureKind, 'missing_message');
  });

  it('two matching payout events create ambiguous_event and no projection', async () => {
    const prisma = new MockChangePrisma();
    prisma.transactions.push(successTx());
    prisma.messages.push(payoutMessage());
    prisma.events.push(payoutEvent());
    prisma.events.push(payoutEvent({ id: 201n }));

    await projectCoreSlotPayoutHeight({ prisma, chainId: 'twilight-test', height: 30n });

    assert.equal(prisma.payoutChanges.size, 0);
    assert.equal(prisma.coreSlotProjections.size, 0);
    assert.equal(prisma.projectionFailures.length, 1);
    assert.equal(prisma.projectionFailures[0].failureKind, 'ambiguous_event');
  });

  it('missing new_payout_address creates missing_required_payload', async () => {
    const prisma = new MockChangePrisma();
    prisma.transactions.push(successTx());
    prisma.messages.push(payoutMessage({ decodedJson: { slot_id: '1', operator: OPERATOR } }));
    prisma.events.push(payoutEvent());

    await projectCoreSlotPayoutHeight({ prisma, chainId: 'twilight-test', height: 30n });

    assert.equal(prisma.payoutChanges.size, 0);
    assert.equal(prisma.projectionFailures[0].failureKind, 'missing_required_payload');
  });

  it('invalid slot_id creates invalid_slot_id', async () => {
    const prisma = new MockChangePrisma();
    prisma.transactions.push(successTx());
    prisma.messages.push(payoutMessage({ decodedJson: payoutDecoded({ slot_id: 'bad' }) }));
    prisma.events.push(payoutEvent());

    await projectCoreSlotPayoutHeight({ prisma, chainId: 'twilight-test', height: 30n });

    assert.equal(prisma.payoutChanges.size, 0);
    assert.equal(prisma.projectionFailures[0].failureKind, 'invalid_slot_id');
  });

  it('invalid payout address creates invalid_payout_address', async () => {
    const prisma = new MockChangePrisma();
    prisma.transactions.push(successTx());
    prisma.messages.push(payoutMessage({
      decodedJson: payoutDecoded({ new_payout_address: 'not-a-twilight-address' }),
    }));
    prisma.events.push(payoutEvent());

    await projectCoreSlotPayoutHeight({ prisma, chainId: 'twilight-test', height: 30n });

    assert.equal(prisma.payoutChanges.size, 0);
    assert.equal(prisma.projectionFailures[0].failureKind, 'invalid_payout_address');
  });

  it('rerunning payout range is idempotent for changes and unresolved failures', async () => {
    const prisma = new MockChangePrisma();
    prisma.transactions.push(successTx());
    prisma.messages.push(payoutMessage());

    await projectCoreSlotPayoutRange({
      prisma,
      chainId: 'twilight-test',
      startHeight: 30n,
      endHeight: 30n,
    });
    await projectCoreSlotPayoutRange({
      prisma,
      chainId: 'twilight-test',
      startHeight: 30n,
      endHeight: 30n,
    });

    assert.equal(prisma.payoutChanges.size, 0);
    assert.equal(prisma.projectionFailures.length, 1);
    assert.equal(prisma.projectionFailures[0].failureKind, 'missing_event');
  });

  it('payout reset deletes payout rows and preserves generic and unrelated semantic rows', async () => {
    const prisma = new MockChangePrisma();
    prisma.seedPayoutCase();
    prisma.metadataChanges.set('m1', { id: 'm1' });
    prisma.lifecycleEvents.set('l1', { id: 'l1' });
    await projectCoreSlotPayoutHeight({ prisma, chainId: 'twilight-test', height: 30n });

    await resetCoreSlotPayoutProjection(prisma);

    assert.equal(prisma.payoutChanges.size, 0);
    assert.equal(prisma.transactions.length, 1);
    assert.equal(prisma.messages.length, 1);
    assert.equal(prisma.events.length, 1);
    assert.equal(prisma.metadataChanges.size, 1);
    assert.equal(prisma.lifecycleEvents.size, 1);
    assert.equal(prisma.coreSlotProjections.size, 1);
  });
});

describe('CoreSlot params projection', () => {
  it('params message plus matching event creates CoreSlotParameterChange', async () => {
    const prisma = new MockChangePrisma();
    prisma.seedParamsCase();

    const result = await projectCoreSlotParamsHeight({
      prisma,
      chainId: 'twilight-test',
      height: 31n,
    });

    assert.equal(result.changesCreated, 1);
    assert.equal(prisma.parameterChanges.size, 1);
    const change = prisma.parameterChanges.get('30');
    assert.equal(change.authority, AUTHORITY);
    assert.equal(change.sourceEventId, 300n);
  });

  it('params payload is stored as paramsJson', async () => {
    const prisma = new MockChangePrisma();
    prisma.seedParamsCase();

    await projectCoreSlotParamsHeight({ prisma, chainId: 'twilight-test', height: 31n });

    const change = prisma.parameterChanges.get('30');
    assert.deepEqual(change.paramsJson, { max_slots: '10', min_reward_weight: '1' });
  });

  it('failed tx with params message does not project', async () => {
    const prisma = new MockChangePrisma();
    prisma.seedParamsCase({ tx: { status: 'failed', code: 7 } });

    await projectCoreSlotParamsHeight({ prisma, chainId: 'twilight-test', height: 31n });

    assert.equal(prisma.parameterChanges.size, 0);
    assert.equal(prisma.projectionFailures.length, 0);
  });

  it('params message without matching event creates missing_event', async () => {
    const prisma = new MockChangePrisma();
    prisma.transactions.push(successTx({ height: 31n }));
    prisma.messages.push(paramsMessage());

    await projectCoreSlotParamsHeight({ prisma, chainId: 'twilight-test', height: 31n });

    assert.equal(prisma.parameterChanges.size, 0);
    assert.equal(prisma.projectionFailures.length, 1);
    assert.equal(prisma.projectionFailures[0].failureKind, 'missing_event');
    assert.ok(prisma.projectionFailures[0].failureKey);
  });

  it('params event without matching message creates missing_message and no params change', async () => {
    const prisma = new MockChangePrisma();
    prisma.transactions.push(successTx({ height: 31n }));
    prisma.events.push(paramsEvent());

    await projectCoreSlotParamsHeight({ prisma, chainId: 'twilight-test', height: 31n });

    assert.equal(prisma.parameterChanges.size, 0);
    assert.equal(prisma.projectionFailures.length, 1);
    assert.equal(prisma.projectionFailures[0].failureKind, 'missing_message');
  });

  it('two matching params events create ambiguous_event and no projection', async () => {
    const prisma = new MockChangePrisma();
    prisma.transactions.push(successTx({ height: 31n }));
    prisma.messages.push(paramsMessage());
    prisma.events.push(paramsEvent());
    prisma.events.push(paramsEvent({ id: 301n }));

    await projectCoreSlotParamsHeight({ prisma, chainId: 'twilight-test', height: 31n });

    assert.equal(prisma.parameterChanges.size, 0);
    assert.equal(prisma.projectionFailures.length, 1);
    assert.equal(prisma.projectionFailures[0].failureKind, 'ambiguous_event');
  });

  it('missing params payload creates invalid_params_payload', async () => {
    const prisma = new MockChangePrisma();
    prisma.transactions.push(successTx({ height: 31n }));
    prisma.messages.push(paramsMessage({ decodedJson: { authority: AUTHORITY } }));
    prisma.events.push(paramsEvent());

    await projectCoreSlotParamsHeight({ prisma, chainId: 'twilight-test', height: 31n });

    assert.equal(prisma.parameterChanges.size, 0);
    assert.equal(prisma.projectionFailures[0].failureKind, 'invalid_params_payload');
  });

  it('rerunning params range is idempotent for changes and unresolved failures', async () => {
    const prisma = new MockChangePrisma();
    prisma.transactions.push(successTx({ height: 31n }));
    prisma.messages.push(paramsMessage());

    await projectCoreSlotParamsRange({
      prisma,
      chainId: 'twilight-test',
      startHeight: 31n,
      endHeight: 31n,
    });
    await projectCoreSlotParamsRange({
      prisma,
      chainId: 'twilight-test',
      startHeight: 31n,
      endHeight: 31n,
    });

    assert.equal(prisma.parameterChanges.size, 0);
    assert.equal(prisma.projectionFailures.length, 1);
    assert.equal(prisma.projectionFailures[0].failureKind, 'missing_event');
  });

  it('params reset deletes params rows and preserves generic rows', async () => {
    const prisma = new MockChangePrisma();
    prisma.seedParamsCase();
    await projectCoreSlotParamsHeight({ prisma, chainId: 'twilight-test', height: 31n });

    await resetCoreSlotParamsProjection(prisma);

    assert.equal(prisma.parameterChanges.size, 0);
    assert.equal(prisma.transactions.length, 1);
    assert.equal(prisma.messages.length, 1);
    assert.equal(prisma.events.length, 1);
  });

  it('params projection does not mutate CoreSlotProjection', async () => {
    const prisma = new MockChangePrisma();
    prisma.coreSlotProjections.set('1', {
      slotId: 1n,
      payoutAddress: PAYOUT,
      updatedHeight: 30n,
    });
    prisma.seedParamsCase();

    await projectCoreSlotParamsHeight({ prisma, chainId: 'twilight-test', height: 31n });

    assert.deepEqual(prisma.coreSlotProjections.get('1'), {
      slotId: 1n,
      payoutAddress: PAYOUT,
      updatedHeight: 30n,
    });
  });
});

function successTx(overrides = {}) {
  return {
    hash: TX_HASH,
    height: 30n,
    status: 'success',
    code: 0,
    ...overrides,
  };
}

function payoutMessage(overrides = {}) {
  return {
    id: 20n,
    txHash: TX_HASH,
    height: 30n,
    msgIndex: 0,
    typeUrl: '/twilight.coreslot.v1.MsgUpdatePayoutAddress',
    module: 'coreslot',
    decodedJson: payoutDecoded(),
    rawJson: { typeUrl: '/twilight.coreslot.v1.MsgUpdatePayoutAddress' },
    ...overrides,
  };
}

function payoutDecoded(overrides = {}) {
  return {
    slot_id: '1',
    operator: OPERATOR,
    new_payout_address: PAYOUT,
    ...overrides,
  };
}

function payoutEvent(overrides = {}) {
  return {
    id: 200n,
    height: 30n,
    txHash: TX_HASH,
    msgIndex: 0,
    type: 'coreslot_payout_updated',
    attributesJson: attrs({
      slot_id: '1',
      operator_address: OPERATOR,
      msg_index: '0',
    }),
    ...overrides,
  };
}

function paramsMessage(overrides = {}) {
  return {
    id: 30n,
    txHash: TX_HASH,
    height: 31n,
    msgIndex: 0,
    typeUrl: '/twilight.coreslot.v1.MsgUpdateParams',
    module: 'coreslot',
    decodedJson: {
      authority: AUTHORITY,
      params: { max_slots: '10', min_reward_weight: '1' },
    },
    rawJson: { typeUrl: '/twilight.coreslot.v1.MsgUpdateParams' },
    ...overrides,
  };
}

function paramsEvent(overrides = {}) {
  return {
    id: 300n,
    height: 31n,
    txHash: TX_HASH,
    msgIndex: 0,
    type: 'coreslot_params_updated',
    attributesJson: attrs({
      authority: AUTHORITY,
      msg_index: '0',
    }),
    ...overrides,
  };
}

function attrs(values) {
  return Object.entries(values).map(([key, value]) => ({ key, value, index: true }));
}

function cloneMap(map) {
  return new Map([...map.entries()].map(([key, value]) => [key, { ...value }]));
}

function cursorKey(value) {
  return `${value.projectionName}:${value.chainId}`;
}
