import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CORESLOT_KEY_ROTATION_PROJECTION,
  CORESLOT_KEY_ROTATION_TYPE_URL,
  CORESLOT_KEY_ROTATION_REQUESTED_EVENT_TYPE,
  CORESLOT_KEY_ROTATED_EVENT_TYPE,
  CORESLOT_ROTATION_CANCELLED_EVENT_TYPE,
  CORESLOT_METADATA_PROJECTION,
  CORESLOT_TEMPORAL_MAP_PROJECTION,
} from '../../dist/projections/types.js';
import {
  projectCoreSlotKeyRotationHeight,
  projectCoreSlotKeyRotationRange,
} from '../../dist/projections/coreslot-key-rotation.js';
import { resetCoreSlotKeyRotationProjection } from '../../dist/projections/reset-key-rotation.js';
import { resetCoreSlotSemanticProjections } from '../../dist/projections/reset-semantic.js';
import {
  CORESLOT_SEMANTIC_REBUILD_ORDER,
  projectCoreSlotSemanticRebuild,
} from '../../dist/projections/coreslot-semantic-rebuild.js';

const CHAIN_ID = 'twilight-test';
const OPERATOR = 'twilight17n30thc6ntha6rpjvk46yrwvkd86guy9crevra';
const OLD_CONS = 'a'.repeat(40);
const NEW_CONS = 'b'.repeat(40);

describe('CoreSlot key rotation projection', () => {
  it('1. request message + requested event creates a requested rotation row', async () => {
    const prisma = new MockKeyRotationPrisma();
    prisma.seedRequested({ height: 100n, slotId: 1n, effective: 150n });

    const result = await projectCoreSlotKeyRotationHeight({ prisma, chainId: CHAIN_ID, height: 100n });

    assert.equal(result.rotationsWritten, 1);
    assert.equal(prisma.rotations.length, 1);
    const row = prisma.rotations[0];
    assert.equal(row.status, 'requested');
    assert.equal(row.slotId, 1n);
    assert.equal(row.newConsensusAddress, NEW_CONS);
    assert.equal(row.oldConsensusAddress, OLD_CONS);
    assert.equal(row.effectiveHeight, 150n);
  });

  it('2. requested rotation does not update CoreSlotProjection.consensusAddress', async () => {
    const prisma = new MockKeyRotationPrisma();
    prisma.seedRequested({ height: 100n, slotId: 1n, effective: 150n });

    await projectCoreSlotKeyRotationHeight({ prisma, chainId: CHAIN_ID, height: 100n });

    assert.equal(prisma.coreSlotProjections.size, 0);
  });

  it('3. immediate rotated event with message creates an immediate_applied row', async () => {
    const prisma = new MockKeyRotationPrisma();
    prisma.seedImmediate({ height: 100n, slotId: 2n });

    await projectCoreSlotKeyRotationHeight({ prisma, chainId: CHAIN_ID, height: 100n });

    assert.equal(prisma.rotations.length, 1);
    assert.equal(prisma.rotations[0].status, 'immediate_applied');
  });

  it('4. immediate applied rotation updates CoreSlotProjection.consensusAddress', async () => {
    const prisma = new MockKeyRotationPrisma();
    prisma.seedImmediate({ height: 100n, slotId: 2n });

    await projectCoreSlotKeyRotationHeight({ prisma, chainId: CHAIN_ID, height: 100n });

    const projection = prisma.coreSlotProjections.get('2');
    assert.ok(projection);
    assert.equal(projection.consensusAddress, NEW_CONS);
    assert.equal(projection.consensusPower, 10n);
  });

  it('5. delayed rotated event links to an existing requested row and marks applied', async () => {
    const prisma = new MockKeyRotationPrisma();
    prisma.seedRequested({ height: 100n, slotId: 1n, effective: 150n });
    prisma.seedDelayedApplied({ height: 150n, slotId: 1n, effective: 150n });

    await projectCoreSlotKeyRotationRange({ prisma, chainId: CHAIN_ID, startHeight: 100n, endHeight: 150n });

    assert.equal(prisma.rotations.length, 1);
    assert.equal(prisma.rotations[0].status, 'applied');
    assert.equal(prisma.rotations[0].appliedHeight, 150n);
  });

  it('6. delayed applied rotation updates CoreSlotProjection.consensusAddress', async () => {
    const prisma = new MockKeyRotationPrisma();
    prisma.seedRequested({ height: 100n, slotId: 1n, effective: 150n });
    prisma.seedDelayedApplied({ height: 150n, slotId: 1n, effective: 150n });

    await projectCoreSlotKeyRotationRange({ prisma, chainId: CHAIN_ID, startHeight: 100n, endHeight: 150n });

    assert.equal(prisma.coreSlotProjections.get('1').consensusAddress, NEW_CONS);
  });

  it('7. applied event without request creates event-only applied row and missing_request failure', async () => {
    const prisma = new MockKeyRotationPrisma();
    prisma.seedDelayedApplied({ height: 150n, slotId: 3n, effective: 150n });

    await projectCoreSlotKeyRotationHeight({ prisma, chainId: CHAIN_ID, height: 150n });

    assert.equal(prisma.rotations.length, 1);
    assert.equal(prisma.rotations[0].status, 'applied');
    assert.equal(failureKinds(prisma).includes('missing_request'), true);
    assert.equal(prisma.coreSlotProjections.get('3').consensusAddress, NEW_CONS);
  });

  it('8. cancellation event links to a requested row and marks cancelled', async () => {
    const prisma = new MockKeyRotationPrisma();
    prisma.seedRequested({ height: 100n, slotId: 1n, effective: 150n });
    prisma.seedCancelled({ height: 120n, slotId: 1n, effective: 150n });

    await projectCoreSlotKeyRotationRange({ prisma, chainId: CHAIN_ID, startHeight: 100n, endHeight: 120n });

    assert.equal(prisma.rotations.length, 1);
    assert.equal(prisma.rotations[0].status, 'cancelled');
    assert.equal(prisma.rotations[0].cancelledHeight, 120n);
  });

  it('9. cancelled rotation does not update CoreSlotProjection.consensusAddress', async () => {
    const prisma = new MockKeyRotationPrisma();
    prisma.seedRequested({ height: 100n, slotId: 1n, effective: 150n });
    prisma.seedCancelled({ height: 120n, slotId: 1n, effective: 150n });

    await projectCoreSlotKeyRotationRange({ prisma, chainId: CHAIN_ID, startHeight: 100n, endHeight: 120n });

    assert.equal(prisma.coreSlotProjections.size, 0);
  });

  it('10. cancellation without request creates event-only cancelled row and missing_request', async () => {
    const prisma = new MockKeyRotationPrisma();
    prisma.seedCancelled({ height: 120n, slotId: 4n, effective: 150n });

    await projectCoreSlotKeyRotationHeight({ prisma, chainId: CHAIN_ID, height: 120n });

    assert.equal(prisma.rotations.length, 1);
    assert.equal(prisma.rotations[0].status, 'cancelled');
    assert.equal(failureKinds(prisma).includes('missing_request'), true);
    assert.equal(prisma.coreSlotProjections.size, 0);
  });

  it('11. ambiguous requested rows for an applied event create rotation_correlation_failed', async () => {
    const prisma = new MockKeyRotationPrisma();
    prisma.seedRequested({ height: 100n, slotId: 1n, effective: 150n, tag: 'a' });
    prisma.seedRequested({ height: 101n, slotId: 1n, effective: 150n, tag: 'b' });
    prisma.seedDelayedApplied({ height: 150n, slotId: 1n, effective: 150n });

    await projectCoreSlotKeyRotationRange({ prisma, chainId: CHAIN_ID, startHeight: 100n, endHeight: 150n });

    assert.equal(failureKinds(prisma).includes('rotation_correlation_failed'), true);
    assert.equal(prisma.coreSlotProjections.size, 0);
  });

  it('12. invalid slot_id creates invalid_slot_id failure', async () => {
    const prisma = new MockKeyRotationPrisma();
    prisma.events.push(rotatedEvent({ id: 90n, height: 150n, slotId: 'not-a-number', effective: 150n }));

    await projectCoreSlotKeyRotationHeight({ prisma, chainId: CHAIN_ID, height: 150n });

    assert.equal(prisma.rotations.length, 0);
    assert.equal(failureKinds(prisma).includes('invalid_slot_id'), true);
  });

  it('13. invalid consensus address creates invalid_consensus_address failure', async () => {
    const prisma = new MockKeyRotationPrisma();
    prisma.events.push(rotatedEvent({ id: 91n, height: 150n, slotId: 1n, effective: 150n, newAddr: 'nothex' }));

    await projectCoreSlotKeyRotationHeight({ prisma, chainId: CHAIN_ID, height: 150n });

    assert.equal(prisma.rotations.length, 0);
    assert.equal(failureKinds(prisma).includes('invalid_consensus_address'), true);
  });

  it('14. failed tx with MsgRotateConsensusKey does not project tx-bound request/apply', async () => {
    const prisma = new MockKeyRotationPrisma();
    prisma.transactions.push({ hash: 'FAILED', height: 100n, status: 'failed', code: 7 });
    prisma.messages.push(rotateMessage({ id: 1n, txHash: 'FAILED', height: 100n, slotId: 1n }));
    prisma.events.push(requestedEvent({ id: 10n, txHash: 'FAILED', height: 100n, slotId: 1n, effective: 150n }));

    const result = await projectCoreSlotKeyRotationHeight({ prisma, chainId: CHAIN_ID, height: 100n });

    assert.equal(result.rotationsWritten, 0);
    assert.equal(prisma.rotations.length, 0);
    assert.equal(prisma.projectionFailures.length, 0);
    assert.equal(prisma.coreSlotProjections.size, 0);
  });

  it('15. message without a matching request/applied event creates missing_event', async () => {
    const prisma = new MockKeyRotationPrisma();
    prisma.transactions.push(successTx('HASH', 100n));
    prisma.messages.push(rotateMessage({ id: 1n, txHash: 'HASH', height: 100n, slotId: 1n }));

    await projectCoreSlotKeyRotationHeight({ prisma, chainId: CHAIN_ID, height: 100n });

    assert.equal(prisma.rotations.length, 0);
    assert.equal(failureKinds(prisma).includes('missing_event'), true);
  });

  it('16. duplicate rerun is idempotent for rows and failures', async () => {
    const prisma = new MockKeyRotationPrisma();
    prisma.seedRequested({ height: 100n, slotId: 1n, effective: 150n });
    prisma.seedDelayedApplied({ height: 150n, slotId: 1n, effective: 150n });

    const run = () => projectCoreSlotKeyRotationRange({
      prisma, chainId: CHAIN_ID, startHeight: 100n, endHeight: 150n,
    });
    await run();
    await run();

    assert.equal(prisma.rotations.length, 1);
    assert.equal(prisma.rotations[0].status, 'applied');
    assert.equal(prisma.projectionFailures.length, 0);
    assert.equal(prisma.coreSlotProjections.get('1').consensusAddress, NEW_CONS);
  });

  it('17. individual reset deletes key rotation rows and preserves generic + other semantic rows', async () => {
    const prisma = new MockKeyRotationPrisma();
    prisma.transactions.push(successTx('HASH', 100n));
    prisma.rotations.push({ id: 1n, slotId: 1n, status: 'requested', newConsensusAddress: NEW_CONS, effectiveHeight: 150n });
    prisma.metadataChanges.set('1', { id: 1n });
    prisma.projectionFailures.push(
      { failureKey: 'k', projectionName: CORESLOT_KEY_ROTATION_PROJECTION },
      { failureKey: 'm', projectionName: CORESLOT_METADATA_PROJECTION },
    );
    prisma.seedCursor(CORESLOT_KEY_ROTATION_PROJECTION, 150n);
    prisma.seedCursor(CORESLOT_METADATA_PROJECTION, 150n);

    await resetCoreSlotKeyRotationProjection(prisma);

    assert.equal(prisma.rotations.length, 0);
    assert.equal(prisma.metadataChanges.size, 1);
    assert.equal(prisma.transactions.length, 1);
    assert.deepEqual(prisma.projectionFailures.map((f) => f.projectionName), [CORESLOT_METADATA_PROJECTION]);
    assert.deepEqual([...prisma.projectionCursors.values()].map((c) => c.projectionName), [CORESLOT_METADATA_PROJECTION]);
  });

  it('18. combined rebuild order includes key_rotation after params', async () => {
    const calls = [];
    const recorder = (name) => async () => { calls.push(name); return []; };
    await projectCoreSlotSemanticRebuild({
      prisma: {},
      chainId: CHAIN_ID,
      startHeight: 100n,
      endHeight: 100n,
      reset: false,
      projectors: {
        projectMetadata: recorder('coreslot_metadata_v1'),
        projectLifecycle: recorder('coreslot_lifecycle_v1'),
        projectPayout: recorder('coreslot_payout_v1'),
        projectParams: recorder('coreslot_params_v1'),
        projectKeyRotation: recorder(CORESLOT_KEY_ROTATION_PROJECTION),
        projectTemporalMap: recorder(CORESLOT_TEMPORAL_MAP_PROJECTION),
      },
    });

    assert.deepEqual(calls, [...CORESLOT_SEMANTIC_REBUILD_ORDER]);
    assert.equal(calls[calls.length - 2], CORESLOT_KEY_ROTATION_PROJECTION);
    assert.equal(calls[calls.length - 1], CORESLOT_TEMPORAL_MAP_PROJECTION);
  });

  it('19. combined reset includes key rotation rows, failures, and cursor', async () => {
    const prisma = new MockKeyRotationPrisma();
    prisma.transactions.push(successTx('HASH', 100n));
    prisma.rotations.push({ id: 1n, slotId: 1n, status: 'applied' });
    prisma.consensusWindows.push({ id: 1n, slotId: 1n, consensusAddress: NEW_CONS });
    prisma.coreSlotProjections.set('1', { slotId: 1n });
    prisma.projectionFailures.push(
      { failureKey: 'k', projectionName: CORESLOT_KEY_ROTATION_PROJECTION },
      { failureKey: 'r', projectionName: 'rewards_v1' },
    );
    prisma.seedCursor(CORESLOT_KEY_ROTATION_PROJECTION, 150n);
    prisma.seedCursor('rewards_v1', 50n);

    await resetCoreSlotSemanticProjections(prisma);

    assert.equal(prisma.rotations.length, 0);
    assert.equal(prisma.consensusWindows.length, 0);
    assert.equal(prisma.coreSlotProjections.size, 0);
    assert.equal(prisma.transactions.length, 1);
    assert.deepEqual(prisma.projectionFailures.map((f) => f.projectionName), ['rewards_v1']);
    assert.deepEqual([...prisma.projectionCursors.values()].map((c) => c.projectionName), ['rewards_v1']);
  });

  it('20. key rotation does not clear metadata/payout/lifecycle fields on CoreSlotProjection', async () => {
    const prisma = new MockKeyRotationPrisma();
    prisma.coreSlotProjections.set('1', {
      slotId: 1n,
      status: 'ACTIVE',
      metadataJson: { moniker: 'op-1' },
      payoutAddress: 'twilight1payout',
      updatedHeight: 90n,
    });
    prisma.seedDelayedApplied({ height: 150n, slotId: 1n, effective: 150n });

    await projectCoreSlotKeyRotationHeight({ prisma, chainId: CHAIN_ID, height: 150n });

    const projection = prisma.coreSlotProjections.get('1');
    assert.equal(projection.consensusAddress, NEW_CONS);
    assert.equal(projection.status, 'ACTIVE');
    assert.deepEqual(projection.metadataJson, { moniker: 'op-1' });
    assert.equal(projection.payoutAddress, 'twilight1payout');
  });
});

function failureKinds(prisma) {
  return prisma.projectionFailures.map((f) => f.failureKind);
}

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

function successTx(hash, height) {
  return { hash, height, status: 'success', code: 0 };
}

function rotateMessage(overrides = {}) {
  return {
    id: 1n,
    txHash: 'HASH',
    height: 100n,
    msgIndex: 0,
    typeUrl: CORESLOT_KEY_ROTATION_TYPE_URL,
    module: 'coreslot',
    decodedJson: {
      slot_id: overrides.slotId !== undefined ? String(overrides.slotId) : '1',
      operator: OPERATOR,
      new_consensus_pubkey: { '@type': '/cosmos.crypto.ed25519.PubKey', key: 'base64==' },
    },
    rawJson: {},
    ...stripSlot(overrides),
  };
}

function rotationEvent(type, overrides = {}) {
  const attrs = [
    { key: 'slot_id', value: overrides.slotId !== undefined ? String(overrides.slotId) : '1' },
    { key: 'operator_address', value: OPERATOR },
    { key: 'old_consensus_address', value: overrides.oldAddr ?? OLD_CONS },
    { key: 'new_consensus_address', value: overrides.newAddr ?? NEW_CONS },
  ];
  if (overrides.effective !== undefined) attrs.push({ key: 'effective_height', value: String(overrides.effective) });
  if (overrides.power !== undefined) attrs.push({ key: 'power', value: String(overrides.power) });
  if (overrides.msgIndex !== undefined) attrs.push({ key: 'msg_index', value: String(overrides.msgIndex) });
  if (overrides.reason !== undefined) attrs.push({ key: 'reason', value: overrides.reason });
  return {
    id: overrides.id ?? 10n,
    height: overrides.height ?? 100n,
    txHash: overrides.txHash ?? null,
    msgIndex: overrides.msgIndex ?? null,
    type,
    attributesJson: attrs,
  };
}

function requestedEvent(overrides) {
  return rotationEvent(CORESLOT_KEY_ROTATION_REQUESTED_EVENT_TYPE, overrides);
}
function rotatedEvent(overrides) {
  return rotationEvent(CORESLOT_KEY_ROTATED_EVENT_TYPE, { power: 10, ...overrides });
}
function cancelledEvent(overrides) {
  return rotationEvent(CORESLOT_ROTATION_CANCELLED_EVENT_TYPE, { reason: 'superseded', ...overrides });
}

function stripSlot(overrides) {
  const { slotId, ...rest } = overrides;
  return rest;
}

// --------------------------------------------------------------------------
// In-memory Prisma model for the key rotation projector + reset interfaces.
// --------------------------------------------------------------------------

class MockKeyRotationPrisma {
  constructor() {
    this.transactions = [];
    this.messages = [];
    this.events = [];
    this.rotations = [];
    this.nextRotationId = 1n;
    this.consensusWindows = [];
    this.coreSlotProjections = new Map();
    this.projectionFailures = [];
    this.projectionCursors = new Map();
    // extra semantic stores for combined reset coverage
    this.metadataChanges = new Map();
    this.lifecycleEvents = new Map();
    this.payoutChanges = new Map();
    this.parameterChanges = new Map();

    this.explorerTransaction = {
      findMany: async (args) => {
        const where = args?.where ?? {};
        return this.transactions.filter((tx) => {
          if (where.height !== undefined && tx.height !== where.height) return false;
          return tx.status === 'success' || tx.code === 0;
        });
      },
    };
    this.message = {
      findMany: async (args) => {
        const where = args?.where ?? {};
        const txHashes = new Set(where.txHash?.in ?? []);
        return this.messages.filter((m) => {
          if (where.height !== undefined && m.height !== where.height) return false;
          if (txHashes.size > 0 && !txHashes.has(m.txHash)) return false;
          if (where.module !== undefined && m.module !== where.module) return false;
          if (where.typeUrl !== undefined && m.typeUrl !== where.typeUrl) return false;
          return true;
        });
      },
    };
    this.event = {
      findMany: async (args) => {
        const where = args?.where ?? {};
        const types = new Set(where.type?.in ?? (where.type !== undefined ? [where.type] : []));
        return this.events.filter((e) => {
          if (where.height !== undefined && e.height !== where.height) return false;
          if (types.size > 0 && !types.has(e.type)) return false;
          return true;
        });
      },
    };
    this.coreSlotConsensusKeyRotation = {
      findFirst: async (args) => this.rotations.find((r) => matchWhere(r, args?.where ?? {})) ?? null,
      findMany: async (args) => this.rotations.filter((r) => matchWhere(r, args?.where ?? {})),
      upsert: async (args) => {
        const existing = this.rotations.find((r) => matchWhere(r, args.where));
        if (existing) {
          Object.assign(existing, args.update);
          return existing;
        }
        const row = { id: this.nextRotationId, ...args.create };
        this.nextRotationId += 1n;
        this.rotations.push(row);
        return row;
      },
      create: async (args) => {
        const row = { id: this.nextRotationId, ...args.data };
        this.nextRotationId += 1n;
        this.rotations.push(row);
        return row;
      },
      update: async (args) => {
        const row = this.rotations.find((r) => r.id === args.where.id);
        if (row) Object.assign(row, args.data);
        return row;
      },
      deleteMany: async () => {
        const count = this.rotations.length;
        this.rotations = [];
        return { count };
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
      deleteMany: async () => { this.coreSlotProjections.clear(); return { count: 0 }; },
    };
    this.coreSlotMetadataChange = mapModel(() => this.metadataChanges);
    this.coreSlotLifecycleEvent = mapModel(() => this.lifecycleEvents);
    this.coreSlotPayoutChange = mapModel(() => this.payoutChanges);
    this.coreSlotParameterChange = mapModel(() => this.parameterChanges);
    this.coreSlotConsensusWindow = {
      deleteMany: async () => {
        const count = this.consensusWindows.length;
        this.consensusWindows = [];
        return { count };
      },
    };
    this.projectionFailure = {
      upsert: async (args) => {
        const key = args.where.failureKey;
        const index = this.projectionFailures.findIndex((f) => f.failureKey === key);
        const next = index >= 0
          ? { ...this.projectionFailures[index], ...args.update }
          : { ...args.create };
        if (index >= 0) this.projectionFailures[index] = next;
        else this.projectionFailures.push(next);
        return next;
      },
      deleteMany: async (args) => {
        const where = args?.where ?? {};
        const before = this.projectionFailures.length;
        this.projectionFailures = this.projectionFailures.filter((f) => {
          if (where.projectionName !== undefined && !matchesScalarOrIn(f.projectionName, where.projectionName)) return true;
          if (where.sourceHeight !== undefined && f.sourceHeight !== where.sourceHeight) return true;
          if (where.resolved !== undefined && f.resolved !== where.resolved) return true;
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
        const where = args?.where ?? {};
        for (const [key, cursor] of [...this.projectionCursors.entries()]) {
          if (matchesScalarOrIn(cursor.projectionName, where.projectionName)) this.projectionCursors.delete(key);
        }
        return { count: 0 };
      },
    };
  }

  async $transaction(fn) {
    return fn(this);
  }

  seedCursor(projectionName, height) {
    this.projectionCursors.set(`${projectionName}:${CHAIN_ID}`, {
      projectionName, chainId: CHAIN_ID, lastProjectedHeight: height, status: 'idle',
    });
  }

  seedRequested({ height, slotId, effective, tag = '' }) {
    const txHash = `REQ-${slotId}-${tag}-${height}`;
    const baseId = 1000n + BigInt(height) + (tag === 'b' ? 1n : 0n);
    this.transactions.push(successTx(txHash, height));
    this.messages.push(rotateMessage({ id: baseId, txHash, height, msgIndex: 0, slotId }));
    this.events.push(requestedEvent({
      id: baseId + 5000n, txHash, height, slotId, effective, msgIndex: 0,
    }));
  }

  seedImmediate({ height, slotId }) {
    const txHash = `IMM-${slotId}-${height}`;
    this.transactions.push(successTx(txHash, height));
    this.messages.push(rotateMessage({ id: 2000n + BigInt(height), txHash, height, msgIndex: 0, slotId }));
    this.events.push(rotatedEvent({
      id: 7000n + BigInt(height), txHash, height, slotId, effective: height, msgIndex: 0, power: 10,
    }));
  }

  seedDelayedApplied({ height, slotId, effective }) {
    // EndBlock application: event-only, no txHash.
    this.events.push(rotatedEvent({
      id: 8000n + BigInt(height) + slotId, height, slotId, effective, power: 10,
    }));
  }

  seedCancelled({ height, slotId, effective }) {
    this.events.push(cancelledEvent({
      id: 9000n + BigInt(height) + slotId, height, slotId, effective,
    }));
  }
}

function mapModel(getMap) {
  return {
    deleteMany: async () => { getMap().clear(); return { count: 0 }; },
  };
}

function matchWhere(row, where) {
  for (const [key, condition] of Object.entries(where)) {
    if (condition !== null && typeof condition === 'object' && !Array.isArray(condition)) {
      // not used in these tests beyond scalars
      return false;
    }
    if (row[key] !== condition) return false;
  }
  return true;
}

function matchesScalarOrIn(value, condition) {
  if (condition === undefined) return true;
  if (condition && typeof condition === 'object' && Array.isArray(condition.in)) {
    return condition.in.includes(value);
  }
  return value === condition;
}

function cursorKey(value) {
  return `${value.projectionName}:${value.chainId}`;
}
