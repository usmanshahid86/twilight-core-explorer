import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CORESLOT_KEY_ROTATION_STATUS,
  CORESLOT_TEMPORAL_MAP_PROJECTION,
} from '../../dist/projections/types.js';
import {
  findConsensusWindowAtHeight,
  findSlotConsensusWindowAtHeight,
  projectCoreSlotTemporalMapHeight,
  projectCoreSlotTemporalMapRange,
} from '../../dist/projections/coreslot-temporal-map.js';
import { resetCoreSlotTemporalMapProjection } from '../../dist/projections/reset-temporal-map.js';
import {
  CORESLOT_SEMANTIC_REBUILD_ORDER,
} from '../../dist/projections/coreslot-semantic-rebuild.js';

const CHAIN_ID = 'twilight-test';
const OPERATOR = 'twilight17n30thc6ntha6rpjvk46yrwvkd86guy9crevra';
const OLD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NEW = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const OTHER = 'cccccccccccccccccccccccccccccccccccccccc';

class TemporalMockPrisma {
  constructor() {
    this.lifecycleEvents = [];
    this.rotations = [];
    this.windows = [];
    this.nextWindowId = 1n;
    this.projectionFailures = [];
    this.projectionCursors = new Map();
    this.genericRows = [{ kind: 'generic' }];
    this.otherSemanticRows = [{ kind: 'metadata' }];

    this.coreSlotLifecycleEvent = {
      findMany: async (args) => this.lifecycleEvents.filter((row) => match(row, args?.where ?? {})),
    };
    this.coreSlotConsensusKeyRotation = {
      findMany: async (args) => this.rotations.filter((row) => match(row, args?.where ?? {})),
    };
    this.coreSlotConsensusWindow = {
      findFirst: async (args) =>
        this.windows.find((row) => match(row, args?.where ?? {})) ?? null,
      findMany: async (args) =>
        this.windows.filter((row) => match(row, args?.where ?? {})),
      create: async (args) => {
        const row = { id: this.nextWindowId, ...args.data };
        this.nextWindowId += 1n;
        this.windows.push(row);
        return row;
      },
      update: async (args) => {
        const row = this.windows.find((window) => window.id === args.where.id);
        if (row) Object.assign(row, args.data);
        return row;
      },
      deleteMany: async () => {
        const count = this.windows.length;
        this.windows = [];
        return { count };
      },
    };
    this.projectionFailure = {
      upsert: async (args) => {
        const key = args.where.failureKey;
        const index = this.projectionFailures.findIndex((row) => row.failureKey === key);
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
        this.projectionFailures = this.projectionFailures.filter((failure) => {
          if (!match(failure, where)) return true;
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
          if (match(cursor, where)) this.projectionCursors.delete(key);
        }
        return { count: 0 };
      },
    };
  }

  seedActivation(overrides = {}) {
    this.lifecycleEvents.push(lifecycle('coreslot_activated', 10n, overrides));
  }

  seedOpenWindow(overrides = {}) {
    this.windows.push({
      id: this.nextWindowId,
      slotId: 1n,
      operatorAddress: OPERATOR,
      consensusAddress: OLD,
      status: 'ACTIVE',
      consensusPower: 1n,
      effectiveFromHeight: 5n,
      effectiveToHeight: null,
      openedByKind: 'lifecycle',
      ...overrides,
    });
    this.nextWindowId += 1n;
  }

  seedRotation(status, overrides = {}) {
    this.rotations.push(rotation(status, overrides));
  }

  async $transaction(fn) {
    const clone = this.clone();
    const result = await fn(clone);
    this.adopt(clone);
    return result;
  }

  clone() {
    const clone = new TemporalMockPrisma();
    clone.lifecycleEvents = this.lifecycleEvents.map((row) => ({ ...row }));
    clone.rotations = this.rotations.map((row) => ({ ...row }));
    clone.windows = this.windows.map((row) => ({ ...row }));
    clone.nextWindowId = this.nextWindowId;
    clone.projectionFailures = this.projectionFailures.map((row) => ({ ...row }));
    clone.projectionCursors = cloneMap(this.projectionCursors);
    clone.genericRows = this.genericRows.map((row) => ({ ...row }));
    clone.otherSemanticRows = this.otherSemanticRows.map((row) => ({ ...row }));
    return clone;
  }

  adopt(other) {
    this.lifecycleEvents = other.lifecycleEvents;
    this.rotations = other.rotations;
    this.windows = other.windows;
    this.nextWindowId = other.nextWindowId;
    this.projectionFailures = other.projectionFailures;
    this.projectionCursors = other.projectionCursors;
    this.genericRows = other.genericRows;
    this.otherSemanticRows = other.otherSemanticRows;
  }
}

describe('CoreSlot temporal consensus map projection', () => {
  it('activation opens ACTIVE consensus window', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedActivation();

    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 10n });

    assert.equal(prisma.windows.length, 1);
    assert.equal(prisma.windows[0].status, 'ACTIVE');
    assert.equal(prisma.windows[0].effectiveFromHeight, 11n);
  });

  it('pending registration does not open ACTIVE consensus window', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.lifecycleEvents.push(lifecycle('coreslot_registered', 10n));

    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 10n });

    assert.equal(prisma.windows.length, 0);
  });

  it('inactivation closes open window at effective height', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedOpenWindow();
    prisma.lifecycleEvents.push(lifecycle('coreslot_inactivated', 10n));

    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 10n });

    assert.equal(prisma.windows[0].effectiveToHeight, 11n);
    assert.equal(prisma.windows[0].closedByKind, 'lifecycle');
  });

  it('suspension closes open window at effective height', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedOpenWindow();
    prisma.lifecycleEvents.push(lifecycle('coreslot_suspended', 10n));

    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 10n });

    assert.equal(prisma.windows[0].effectiveToHeight, 11n);
  });

  it('removal closes open window at effective height', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedOpenWindow();
    prisma.lifecycleEvents.push(lifecycle('coreslot_removed', 10n));

    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 10n });

    assert.equal(prisma.windows[0].effectiveToHeight, 11n);
  });

  it('applied key rotation closes old window and opens new window', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedOpenWindow();
    prisma.seedRotation(CORESLOT_KEY_ROTATION_STATUS.applied);

    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 15n });

    assert.equal(prisma.windows.length, 2);
    assert.equal(prisma.windows[0].effectiveToHeight, 15n);
    assert.equal(prisma.windows[1].consensusAddress, NEW);
    assert.equal(prisma.windows[1].effectiveFromHeight, 15n);
  });

  it('immediate_applied key rotation closes old window and opens new window', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedOpenWindow();
    prisma.seedRotation(CORESLOT_KEY_ROTATION_STATUS.immediateApplied, {
      id: 2n,
      effectiveHeight: null,
      appliedHeight: 15n,
    });

    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 15n });

    assert.equal(prisma.windows.length, 2);
    assert.equal(prisma.windows[0].effectiveToHeight, 16n);
    assert.equal(prisma.windows[1].effectiveFromHeight, 16n);
  });

  it('requested rotation does not open or close windows', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedOpenWindow();
    prisma.seedRotation(CORESLOT_KEY_ROTATION_STATUS.requested, { requestedHeight: 15n });

    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 15n });

    assert.equal(prisma.windows.length, 1);
    assert.equal(prisma.windows[0].effectiveToHeight, null);
  });

  it('cancelled rotation does not open or close windows', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedOpenWindow();
    prisma.seedRotation(CORESLOT_KEY_ROTATION_STATUS.cancelled, { cancelledHeight: 15n });

    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 15n });

    assert.equal(prisma.windows.length, 1);
    assert.equal(prisma.windows[0].effectiveToHeight, null);
  });

  it('applied rotation with missing old address closes exactly one open slot window if unambiguous', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedOpenWindow();
    prisma.seedRotation(CORESLOT_KEY_ROTATION_STATUS.applied, { oldConsensusAddress: null });

    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 15n });

    assert.equal(prisma.windows.length, 2);
    assert.equal(prisma.windows[0].effectiveToHeight, 15n);
  });

  it('applied rotation with missing old address and multiple open windows emits temporal_window_ambiguous', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedOpenWindow();
    prisma.seedOpenWindow({ id: 99n, consensusAddress: OTHER, effectiveFromHeight: 6n });
    prisma.seedRotation(CORESLOT_KEY_ROTATION_STATUS.applied, { oldConsensusAddress: null });

    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 15n });

    assert.equal(prisma.windows.length, 2);
    assert.equal(prisma.projectionFailures[0].failureKind, 'temporal_window_ambiguous');
  });

  it('invalid new consensus address emits invalid_consensus_address and opens no window', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedOpenWindow();
    prisma.seedRotation(CORESLOT_KEY_ROTATION_STATUS.applied, { newConsensusAddress: 'bad' });

    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 15n });

    assert.equal(prisma.windows.length, 1);
    assert.equal(prisma.projectionFailures[0].failureKind, 'invalid_consensus_address');
  });

  it('duplicate activation does not create overlapping duplicate windows', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedActivation();

    await projectCoreSlotTemporalMapRange({
      prisma,
      chainId: CHAIN_ID,
      startHeight: 10n,
      endHeight: 10n,
    });
    await projectCoreSlotTemporalMapRange({
      prisma,
      chainId: CHAIN_ID,
      startHeight: 10n,
      endHeight: 10n,
    });

    assert.equal(prisma.windows.length, 1);
    assert.equal(prisma.projectionFailures.length, 0);
  });

  it('same consensusAddress cannot map to two slots at same height', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedOpenWindow({ slotId: 2n, consensusAddress: OLD, effectiveFromHeight: 5n });
    prisma.seedActivation({ slotId: 1n, consensusAddress: OLD });

    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 10n });

    assert.equal(prisma.windows.length, 1);
    assert.equal(prisma.projectionFailures[0].failureKind, 'temporal_window_conflict');
  });

  it('same slot cannot have two active windows at same height', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedOpenWindow({ consensusAddress: OLD, effectiveFromHeight: 11n });
    prisma.seedActivation({ consensusAddress: NEW });

    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 10n });

    assert.equal(prisma.windows.length, 1);
    assert.equal(prisma.projectionFailures[0].failureKind, 'temporal_window_conflict');
  });

  it('effectiveToHeight must be greater than effectiveFromHeight', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedOpenWindow({ effectiveFromHeight: 11n });
    prisma.lifecycleEvents.push(lifecycle('coreslot_inactivated', 10n));

    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 10n });

    assert.equal(prisma.windows[0].effectiveToHeight, null);
    assert.equal(prisma.projectionFailures[0].failureKind, 'effective_height_invalid');
  });

  it('findConsensusWindowAtHeight uses half-open interval logic', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedOpenWindow({ effectiveFromHeight: 10n, effectiveToHeight: 20n });

    assert.ok(await findConsensusWindowAtHeight(prisma, OLD, 10n));
    assert.ok(await findConsensusWindowAtHeight(prisma, OLD, 19n));
    assert.equal(await findConsensusWindowAtHeight(prisma, OLD, 20n), null);
  });

  it('findSlotConsensusWindowAtHeight uses half-open interval logic', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedOpenWindow({ effectiveFromHeight: 10n, effectiveToHeight: 20n });

    assert.ok(await findSlotConsensusWindowAtHeight(prisma, 1n, 10n));
    assert.ok(await findSlotConsensusWindowAtHeight(prisma, 1n, 19n));
    assert.equal(await findSlotConsensusWindowAtHeight(prisma, 1n, 20n), null);
  });

  it('proposer joins query block height N without shifting', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedOpenWindow({ effectiveFromHeight: 10n, effectiveToHeight: 20n });

    assert.ok(await findConsensusWindowAtHeight(prisma, OLD, 10n));
  });

  it('future signature attribution can query committed height N-1', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedOpenWindow({ effectiveFromHeight: 10n, effectiveToHeight: 20n });

    const containingBlockHeight = 12n;
    const committedHeight = containingBlockHeight - 1n;
    assert.ok(await findConsensusWindowAtHeight(prisma, OLD, committedHeight));
  });

  it('idempotent rerun does not duplicate windows or failures', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedRotation(CORESLOT_KEY_ROTATION_STATUS.applied, { newConsensusAddress: 'bad' });

    await projectCoreSlotTemporalMapRange({
      prisma,
      chainId: CHAIN_ID,
      startHeight: 15n,
      endHeight: 15n,
    });
    await projectCoreSlotTemporalMapRange({
      prisma,
      chainId: CHAIN_ID,
      startHeight: 15n,
      endHeight: 15n,
    });

    assert.equal(prisma.windows.length, 0);
    assert.equal(prisma.projectionFailures.length, 1);
  });

  it('reset deletes temporal rows and preserves generic plus other semantic rows', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedOpenWindow();
    prisma.projectionFailures.push({
      failureKey: 'temporal',
      projectionName: CORESLOT_TEMPORAL_MAP_PROJECTION,
      sourceHeight: 10n,
    });

    await resetCoreSlotTemporalMapProjection(prisma);

    assert.equal(prisma.windows.length, 0);
    assert.equal(prisma.projectionFailures.length, 0);
    assert.equal(prisma.genericRows.length, 1);
    assert.equal(prisma.otherSemanticRows.length, 1);
  });

  it('combined rebuild order includes temporal_map after key_rotation', () => {
    assert.deepEqual(CORESLOT_SEMANTIC_REBUILD_ORDER.slice(-2), [
      'coreslot_key_rotation_v1',
      CORESLOT_TEMPORAL_MAP_PROJECTION,
    ]);
  });

  it('unknown key-rotation status records unknown_semantic_type and does not crash', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedRotation('surprise', { appliedHeight: 15n });

    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 15n });

    assert.equal(prisma.projectionFailures[0].failureKind, 'unknown_semantic_type');
  });

  it('temporal map projection does not mutate generic rows', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedActivation();

    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 10n });

    assert.deepEqual(prisma.genericRows, [{ kind: 'generic' }]);
  });
});

function lifecycle(eventType, height, overrides = {}) {
  const slotId = overrides.slotId ?? 1n;
  const sourceEventId = overrides.sourceEventId ?? height;
  const consensusAddress = overrides.consensusAddress ?? OLD;
  return {
    id: overrides.id ?? sourceEventId,
    sourceEventId,
    height,
    txHash: null,
    msgIndex: null,
    slotId,
    eventType,
    newStatus: eventType === 'coreslot_activated' ? 'ACTIVE' : null,
    operatorAddress: OPERATOR,
    consensusAddress,
    power: 1n,
    rawEventJson: overrides.rawEventJson ?? {},
    rawMessageJson: null,
  };
}

function rotation(status, overrides = {}) {
  return {
    id: overrides.id ?? 1n,
    slotId: overrides.slotId ?? 1n,
    operatorAddress: OPERATOR,
    oldConsensusAddress: overrides.oldConsensusAddress === undefined
      ? OLD
      : overrides.oldConsensusAddress,
    newConsensusAddress: overrides.newConsensusAddress === undefined
      ? NEW
      : overrides.newConsensusAddress,
    status,
    effectiveHeight: overrides.effectiveHeight === undefined ? 15n : overrides.effectiveHeight,
    appliedHeight: overrides.appliedHeight === undefined ? 15n : overrides.appliedHeight,
    cancelledHeight: overrides.cancelledHeight ?? null,
    requestedHeight: overrides.requestedHeight ?? null,
    power: 1n,
    sourceAppliedEventId: overrides.sourceAppliedEventId ?? 15n,
    rawAppliedEventJson: {},
  };
}

function match(row, where) {
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'OR' && Array.isArray(condition)) {
      if (!condition.some((branch) => match(row, branch))) return false;
      continue;
    }
    if (condition !== null && typeof condition === 'object' && !Array.isArray(condition)) {
      if (condition.in !== undefined && !condition.in.includes(row[key])) return false;
      if (condition.lte !== undefined && !(row[key] <= condition.lte)) return false;
      if (condition.gt !== undefined && !(row[key] !== null && row[key] > condition.gt)) return false;
      continue;
    }
    if (row[key] !== condition) return false;
  }
  return true;
}

function cloneMap(map) {
  return new Map([...map.entries()].map(([key, value]) => [key, { ...value }]));
}

function cursorKey(value) {
  return `${value.projectionName}:${value.chainId}`;
}
