import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CORESLOT_KEY_ROTATION_PROJECTION,
  CORESLOT_LIFECYCLE_PROJECTION,
  CORESLOT_METADATA_PROJECTION,
  CORESLOT_PARAMS_PROJECTION,
  CORESLOT_PAYOUT_PROJECTION,
  CORESLOT_TEMPORAL_MAP_PROJECTION,
} from '../../dist/projections/types.js';
import {
  CORESLOT_SEMANTIC_REBUILD_ORDER,
  CoreSlotSemanticRebuildError,
  projectCoreSlotSemanticRebuild,
} from '../../dist/projections/coreslot-semantic-rebuild.js';
import { resetCoreSlotSemanticProjections } from '../../dist/projections/reset-semantic.js';

const CHAIN_ID = 'twilight-test';
const OPERATOR = 'twilight17n30thc6ntha6rpjvk46yrwvkd86guy9crevra';
const NEW_PAYOUT = 'twilight1payoutaddressxxxxxxxxxxxxxxxxxxxxxxx';
const AUTHORITY = 'twilight1authorityxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const CONSENSUS = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd';

const METADATA_TYPE_URL = '/twilight.coreslot.v1.MsgUpdateOperatorMetadata';
const ACTIVATE_TYPE_URL = '/twilight.coreslot.v1.MsgActivateCoreSlot';
const PAYOUT_TYPE_URL = '/twilight.coreslot.v1.MsgUpdatePayoutAddress';
const PARAMS_TYPE_URL = '/twilight.coreslot.v1.MsgUpdateParams';

// --------------------------------------------------------------------------
// Seam-based tests: ordering, reset-before-project, failure-stop.
// These inject recording projectors / reset so no DB behavior is required.
// --------------------------------------------------------------------------

describe('CoreSlot semantic rebuild orchestration', () => {
  it('runs projections in deterministic metadata -> lifecycle -> payout -> params order', async () => {
    const calls = [];
    const recorder = (name) => async () => {
      calls.push(name);
      return [];
    };

    const result = await projectCoreSlotSemanticRebuild({
      prisma: {},
      chainId: CHAIN_ID,
      startHeight: 119n,
      endHeight: 121n,
      reset: false,
      projectors: {
        projectMetadata: recorder(CORESLOT_METADATA_PROJECTION),
        projectLifecycle: recorder(CORESLOT_LIFECYCLE_PROJECTION),
        projectPayout: recorder(CORESLOT_PAYOUT_PROJECTION),
        projectParams: recorder(CORESLOT_PARAMS_PROJECTION),
        projectKeyRotation: recorder(CORESLOT_KEY_ROTATION_PROJECTION),
        projectTemporalMap: recorder(CORESLOT_TEMPORAL_MAP_PROJECTION),
      },
    });

    assert.deepEqual(calls, [...CORESLOT_SEMANTIC_REBUILD_ORDER]);
    assert.deepEqual(result.ranProjections, [...CORESLOT_SEMANTIC_REBUILD_ORDER]);
    assert.equal(result.reset, false);
    assert.equal(result.startHeight, 119n);
    assert.equal(result.endHeight, 121n);
  });

  it('forwards the same start/end range to every projection', async () => {
    const ranges = [];
    const recorder = () => async (args) => {
      ranges.push([args.startHeight, args.endHeight]);
      return [];
    };

    await projectCoreSlotSemanticRebuild({
      prisma: {},
      chainId: CHAIN_ID,
      startHeight: 119n,
      endHeight: 121n,
      reset: false,
      projectors: {
        projectMetadata: recorder(),
        projectLifecycle: recorder(),
        projectPayout: recorder(),
        projectParams: recorder(),
        projectKeyRotation: recorder(),
        projectTemporalMap: recorder(),
      },
    });

    assert.equal(ranges.length, 6);
    for (const [start, end] of ranges) {
      assert.equal(start, 119n);
      assert.equal(end, 121n);
    }
  });

  it('resets first, then projects, when reset is true', async () => {
    const calls = [];
    const recorder = (name) => async () => {
      calls.push(name);
      return [];
    };

    await projectCoreSlotSemanticRebuild({
      prisma: {},
      chainId: CHAIN_ID,
      startHeight: 119n,
      endHeight: 121n,
      reset: true,
      resetSemantic: async () => {
        calls.push('reset');
      },
      projectors: {
        projectMetadata: recorder(CORESLOT_METADATA_PROJECTION),
        projectLifecycle: recorder(CORESLOT_LIFECYCLE_PROJECTION),
        projectPayout: recorder(CORESLOT_PAYOUT_PROJECTION),
        projectParams: recorder(CORESLOT_PARAMS_PROJECTION),
        projectKeyRotation: recorder(CORESLOT_KEY_ROTATION_PROJECTION),
        projectTemporalMap: recorder(CORESLOT_TEMPORAL_MAP_PROJECTION),
      },
    });

    assert.deepEqual(calls, [
      'reset',
      CORESLOT_METADATA_PROJECTION,
      CORESLOT_LIFECYCLE_PROJECTION,
      CORESLOT_PAYOUT_PROJECTION,
      CORESLOT_PARAMS_PROJECTION,
      CORESLOT_KEY_ROTATION_PROJECTION,
      CORESLOT_TEMPORAL_MAP_PROJECTION,
    ]);
  });

  it('does not reset when reset is false', async () => {
    let resetCalled = false;
    const noop = () => async () => [];

    await projectCoreSlotSemanticRebuild({
      prisma: {},
      chainId: CHAIN_ID,
      startHeight: 119n,
      endHeight: 121n,
      reset: false,
      resetSemantic: async () => {
        resetCalled = true;
      },
      projectors: {
        projectMetadata: noop(),
        projectLifecycle: noop(),
        projectPayout: noop(),
        projectParams: noop(),
        projectKeyRotation: noop(),
        projectTemporalMap: noop(),
      },
    });

    assert.equal(resetCalled, false);
  });

  it('stops after a failing projection and reports which one failed', async () => {
    const calls = [];
    const recorder = (name) => async () => {
      calls.push(name);
      return [];
    };
    const thrower = (name) => async () => {
      calls.push(name);
      throw new Error('lifecycle boom');
    };

    await assert.rejects(
      () =>
        projectCoreSlotSemanticRebuild({
          prisma: {},
          chainId: CHAIN_ID,
          startHeight: 119n,
          endHeight: 121n,
          reset: false,
          projectors: {
            projectMetadata: recorder(CORESLOT_METADATA_PROJECTION),
            projectLifecycle: thrower(CORESLOT_LIFECYCLE_PROJECTION),
            projectPayout: recorder(CORESLOT_PAYOUT_PROJECTION),
            projectParams: recorder(CORESLOT_PARAMS_PROJECTION),
            projectKeyRotation: recorder(CORESLOT_KEY_ROTATION_PROJECTION),
            projectTemporalMap: recorder(CORESLOT_TEMPORAL_MAP_PROJECTION),
          },
        }),
      (error) => {
        assert.ok(error instanceof CoreSlotSemanticRebuildError);
        assert.equal(error.projectionName, CORESLOT_LIFECYCLE_PROJECTION);
        assert.deepEqual(error.ranProjections, [CORESLOT_METADATA_PROJECTION]);
        return true;
      },
    );

    // metadata + lifecycle attempted; payout and params never ran.
    assert.deepEqual(calls, [
      CORESLOT_METADATA_PROJECTION,
      CORESLOT_LIFECYCLE_PROJECTION,
    ]);
  });
});

// --------------------------------------------------------------------------
// Combined reset safety tests against the in-memory model.
// --------------------------------------------------------------------------

describe('CoreSlot semantic reset safety', () => {
  it('deletes all CoreSlot semantic change tables and the projection', async () => {
    const prisma = new CombinedMockPrisma();
    prisma.seedAllSemanticRows();

    await resetCoreSlotSemanticProjections(prisma);

    assert.equal(prisma.metadataChanges.size, 0);
    assert.equal(prisma.lifecycleEvents.size, 0);
    assert.equal(prisma.payoutChanges.size, 0);
    assert.equal(prisma.parameterChanges.size, 0);
    assert.equal(prisma.keyRotations.length, 0);
    assert.equal(prisma.consensusWindows.length, 0);
    assert.equal(prisma.coreSlotProjections.size, 0);
  });

  it('deletes only ProjectionFailure rows for CoreSlot projection names', async () => {
    const prisma = new CombinedMockPrisma();
    prisma.projectionFailures.push(
      { failureKey: 'a', projectionName: CORESLOT_METADATA_PROJECTION, sourceHeight: 1n },
      { failureKey: 'b', projectionName: CORESLOT_LIFECYCLE_PROJECTION, sourceHeight: 1n },
      { failureKey: 'c', projectionName: CORESLOT_PAYOUT_PROJECTION, sourceHeight: 1n },
      { failureKey: 'd', projectionName: CORESLOT_PARAMS_PROJECTION, sourceHeight: 1n },
      { failureKey: 'f', projectionName: CORESLOT_TEMPORAL_MAP_PROJECTION, sourceHeight: 1n },
      { failureKey: 'e', projectionName: 'rewards_v1', sourceHeight: 1n },
    );

    await resetCoreSlotSemanticProjections(prisma);

    assert.deepEqual(
      prisma.projectionFailures.map((f) => f.projectionName),
      ['rewards_v1'],
    );
  });

  it('deletes only ProjectionCursor rows for CoreSlot projection names', async () => {
    const prisma = new CombinedMockPrisma();
    prisma.seedCursor(CORESLOT_METADATA_PROJECTION, 121n);
    prisma.seedCursor(CORESLOT_LIFECYCLE_PROJECTION, 121n);
    prisma.seedCursor(CORESLOT_PAYOUT_PROJECTION, 121n);
    prisma.seedCursor(CORESLOT_PARAMS_PROJECTION, 121n);
    prisma.seedCursor(CORESLOT_TEMPORAL_MAP_PROJECTION, 121n);
    prisma.seedCursor('rewards_v1', 50n);

    await resetCoreSlotSemanticProjections(prisma);

    assert.deepEqual(
      [...prisma.projectionCursors.values()].map((c) => c.projectionName),
      ['rewards_v1'],
    );
  });

  it('preserves all generic canonical rows', async () => {
    const prisma = new CombinedMockPrisma();
    prisma.seedAllSemanticRows();
    prisma.blocks.push({ height: 120n });
    prisma.accounts.push({ address: OPERATOR });
    prisma.decodeFailures.push({ id: 1n });
    prisma.indexerCursors.push({ chainId: CHAIN_ID });

    await resetCoreSlotSemanticProjections(prisma);

    assert.equal(prisma.transactions.length > 0, true);
    assert.equal(prisma.messages.length > 0, true);
    assert.equal(prisma.events.length > 0, true);
    assert.equal(prisma.blocks.length, 1);
    assert.equal(prisma.accounts.length, 1);
    assert.equal(prisma.decodeFailures.length, 1);
    assert.equal(prisma.indexerCursors.length, 1);
  });
});

// --------------------------------------------------------------------------
// Full rebuild against the real projectors and the in-memory model.
// --------------------------------------------------------------------------

describe('CoreSlot semantic rebuild against real projectors', () => {
  it('rebuilds metadata, lifecycle, and payout into one CoreSlotProjection', async () => {
    const prisma = new CombinedMockPrisma();
    prisma.seedMetadataAt(120n);
    prisma.seedActivateAt(121n);
    prisma.seedPayoutAt(122n);

    await projectCoreSlotSemanticRebuild({
      prisma,
      chainId: CHAIN_ID,
      startHeight: 120n,
      endHeight: 122n,
      reset: true,
    });

    assert.equal(prisma.metadataChanges.size, 1);
    assert.equal(prisma.lifecycleEvents.size, 1);
    assert.equal(prisma.payoutChanges.size, 1);

    const projection = prisma.coreSlotProjections.get('1');
    assert.ok(projection);
    assert.deepEqual(projection.metadataJson, { moniker: 'explorer-smoke' });
    assert.equal(projection.status, 'ACTIVE');
    assert.equal(projection.payoutAddress, NEW_PAYOUT);
  });

  it('preserves metadataJson when lifecycle runs after metadata', async () => {
    const prisma = new CombinedMockPrisma();
    prisma.seedMetadataAt(120n);
    prisma.seedActivateAt(121n);

    await projectCoreSlotSemanticRebuild({
      prisma,
      chainId: CHAIN_ID,
      startHeight: 120n,
      endHeight: 121n,
      reset: true,
    });

    const projection = prisma.coreSlotProjections.get('1');
    assert.deepEqual(projection.metadataJson, { moniker: 'explorer-smoke' });
    assert.equal(projection.status, 'ACTIVE');
  });

  it('preserves lifecycle-owned fields when payout runs after lifecycle', async () => {
    const prisma = new CombinedMockPrisma();
    prisma.seedActivateAt(121n);
    prisma.seedPayoutAt(122n);

    await projectCoreSlotSemanticRebuild({
      prisma,
      chainId: CHAIN_ID,
      startHeight: 121n,
      endHeight: 122n,
      reset: true,
    });

    const projection = prisma.coreSlotProjections.get('1');
    assert.equal(projection.status, 'ACTIVE');
    assert.equal(projection.payoutAddress, NEW_PAYOUT);
  });

  it('does not mutate CoreSlotProjection from the params projection', async () => {
    const prisma = new CombinedMockPrisma();
    prisma.seedParamsAt(120n);

    await projectCoreSlotSemanticRebuild({
      prisma,
      chainId: CHAIN_ID,
      startHeight: 120n,
      endHeight: 120n,
      reset: true,
    });

    assert.equal(prisma.parameterChanges.size, 1);
    assert.equal(prisma.coreSlotProjections.size, 0);
  });

  it('is idempotent across two combined rebuilds of the same range', async () => {
    const prisma = new CombinedMockPrisma();
    prisma.seedMetadataAt(120n);
    prisma.seedActivateAt(121n);
    prisma.seedPayoutAt(122n);
    prisma.seedParamsAt(120n);

    const run = () =>
      projectCoreSlotSemanticRebuild({
        prisma,
        chainId: CHAIN_ID,
        startHeight: 120n,
        endHeight: 122n,
        reset: false,
      });

    await run();
    await run();

    assert.equal(prisma.metadataChanges.size, 1);
    assert.equal(prisma.lifecycleEvents.size, 1);
    assert.equal(prisma.payoutChanges.size, 1);
    assert.equal(prisma.parameterChanges.size, 1);
    assert.equal(prisma.coreSlotProjections.size, 1);
    assert.equal(unresolvedCoreSlotFailures(prisma).length, 0);
  });

  it('advances each projection cursor to the end height', async () => {
    const prisma = new CombinedMockPrisma();
    prisma.seedMetadataAt(120n);

    await projectCoreSlotSemanticRebuild({
      prisma,
      chainId: CHAIN_ID,
      startHeight: 120n,
      endHeight: 121n,
      reset: true,
    });

    for (const name of [
      CORESLOT_METADATA_PROJECTION,
      CORESLOT_LIFECYCLE_PROJECTION,
      CORESLOT_PAYOUT_PROJECTION,
      CORESLOT_PARAMS_PROJECTION,
      CORESLOT_KEY_ROTATION_PROJECTION,
      CORESLOT_TEMPORAL_MAP_PROJECTION,
    ]) {
      const cursor = prisma.projectionCursors.get(`${name}:${CHAIN_ID}`);
      assert.ok(cursor, `missing cursor for ${name}`);
      assert.equal(cursor.lastProjectedHeight, 121n);
      assert.equal(cursor.status, 'idle');
    }
  });

  it('stops the rebuild and leaves generic rows untouched when a projection throws', async () => {
    const prisma = new CombinedMockPrisma({ failOnLifecycleUpsert: true });
    prisma.seedMetadataAt(120n);
    prisma.seedActivateAt(121n);
    prisma.seedPayoutAt(122n);

    await assert.rejects(
      () =>
        projectCoreSlotSemanticRebuild({
          prisma,
          chainId: CHAIN_ID,
          startHeight: 120n,
          endHeight: 122n,
          reset: false,
        }),
      (error) => {
        assert.ok(error instanceof CoreSlotSemanticRebuildError);
        assert.equal(error.projectionName, CORESLOT_LIFECYCLE_PROJECTION);
        return true;
      },
    );

    // payout never ran because lifecycle failed first.
    assert.equal(prisma.payoutChanges.size, 0);
    // generic canonical rows are untouched.
    assert.equal(prisma.transactions.length, 3);
    assert.equal(prisma.messages.length, 3);
    assert.equal(prisma.events.length, 3);
  });
});

function unresolvedCoreSlotFailures(prisma) {
  const names = new Set([
    CORESLOT_METADATA_PROJECTION,
    CORESLOT_LIFECYCLE_PROJECTION,
    CORESLOT_PAYOUT_PROJECTION,
    CORESLOT_PARAMS_PROJECTION,
    CORESLOT_KEY_ROTATION_PROJECTION,
    CORESLOT_TEMPORAL_MAP_PROJECTION,
  ]);
  return prisma.projectionFailures.filter((f) => names.has(f.projectionName) && !f.resolved);
}

// --------------------------------------------------------------------------
// In-memory Prisma model supporting the four real CoreSlot projectors plus the
// combined reset interface.
// --------------------------------------------------------------------------

class CombinedMockPrisma {
  constructor(options = {}) {
    this.options = options;
    this.transactions = [];
    this.messages = [];
    this.events = [];
    this.blocks = [];
    this.accounts = [];
    this.decodeFailures = [];
    this.indexerCursors = [];
    this.metadataChanges = new Map();
    this.lifecycleEvents = new Map();
    this.nextLifecycleEventId = 1n;
    this.payoutChanges = new Map();
    this.parameterChanges = new Map();
    this.keyRotations = [];
    this.nextKeyRotationId = 1n;
    this.consensusWindows = [];
    this.nextConsensusWindowId = 1n;
    this.coreSlotProjections = new Map();
    this.projectionFailures = [];
    this.projectionCursors = new Map();

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
        return this.messages.filter((message) => {
          if (where.height !== undefined && message.height !== where.height) return false;
          if (txHashes.size > 0 && !txHashes.has(message.txHash)) return false;
          if (where.module !== undefined && message.module !== where.module) return false;
          if (!matchesScalarOrIn(message.typeUrl, where.typeUrl)) return false;
          return true;
        });
      },
    };
    this.event = {
      findMany: async (args) => {
        const where = args?.where ?? {};
        const txHashes = new Set(where.txHash?.in ?? []);
        return this.events.filter((event) => {
          if (where.height !== undefined && event.height !== where.height) return false;
          if (txHashes.size > 0 && !txHashes.has(event.txHash)) return false;
          if (!matchesScalarOrIn(event.type, where.type)) return false;
          return true;
        });
      },
    };

    this.coreSlotMetadataChange = mapModel(this, 'metadataChanges', (args) =>
      args.where.sourceMessageId.toString());
    this.coreSlotPayoutChange = mapModel(this, 'payoutChanges', (args) =>
      args.where.sourceMessageId.toString());
    this.coreSlotParameterChange = mapModel(this, 'parameterChanges', (args) =>
      args.where.sourceMessageId.toString());
    this.coreSlotLifecycleEvent = {
      findMany: async (args) =>
        [...this.lifecycleEvents.values()].filter((row) => matchConsensusWindow(row, args?.where ?? {})),
      upsert: async (args) => {
        if (this.options.failOnLifecycleUpsert) throw new Error('lifecycle upsert failed');
        const key = args.where.sourceEventId.toString();
        const existing = this.lifecycleEvents.get(key);
        const next = existing
          ? { ...existing, ...args.update }
          : { id: this.nextLifecycleEventId, ...args.create };
        if (!existing) this.nextLifecycleEventId += 1n;
        this.lifecycleEvents.set(key, next);
        return next;
      },
      deleteMany: async () => {
        this.lifecycleEvents.clear();
        return { count: 0 };
      },
    };
    this.coreSlotConsensusKeyRotation = {
      findFirst: async (args) =>
        this.keyRotations.find((row) => matchRotation(row, args?.where ?? {})) ?? null,
      findMany: async (args) =>
        this.keyRotations.filter((row) => matchRotation(row, args?.where ?? {})),
      upsert: async (args) => {
        const existing = this.keyRotations.find((row) => matchRotation(row, args.where));
        if (existing) {
          Object.assign(existing, args.update);
          return existing;
        }
        const row = { id: this.nextKeyRotationId, ...args.create };
        this.nextKeyRotationId += 1n;
        this.keyRotations.push(row);
        return row;
      },
      create: async (args) => {
        const row = { id: this.nextKeyRotationId, ...args.data };
        this.nextKeyRotationId += 1n;
        this.keyRotations.push(row);
        return row;
      },
      update: async (args) => {
        const row = this.keyRotations.find((r) => r.id === args.where.id);
        if (row) Object.assign(row, args.data);
        return row;
      },
      deleteMany: async () => {
        const count = this.keyRotations.length;
        this.keyRotations = [];
        return { count };
      },
    };
    this.coreSlotConsensusWindow = {
      findFirst: async (args) =>
        this.consensusWindows.find((row) => matchConsensusWindow(row, args?.where ?? {})) ?? null,
      findMany: async (args) =>
        this.consensusWindows.filter((row) => matchConsensusWindow(row, args?.where ?? {})),
      create: async (args) => {
        const row = { id: this.nextConsensusWindowId, ...args.data };
        this.nextConsensusWindowId += 1n;
        this.consensusWindows.push(row);
        return row;
      },
      update: async (args) => {
        const row = this.consensusWindows.find((r) => r.id === args.where.id);
        if (row) Object.assign(row, args.data);
        return row;
      },
      deleteMany: async () => {
        const count = this.consensusWindows.length;
        this.consensusWindows = [];
        return { count };
      },
    };
    this.coreSlotProjection = {
      upsert: async (args) =>
        upsertIntoMap(this.coreSlotProjections, args.where.slotId.toString(), args),
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
          if (where.projectionName !== undefined
            && !matchesScalarOrIn(failure.projectionName, where.projectionName)) {
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
      findMany: async (args) => {
        const where = args?.where ?? {};
        return [...this.projectionCursors.values()].filter((cursor) => {
          if (where.chainId !== undefined && cursor.chainId !== where.chainId) return false;
          if (!matchesScalarOrIn(cursor.projectionName, where.projectionName)) return false;
          return true;
        });
      },
      deleteMany: async (args) => {
        const where = args?.where ?? {};
        for (const [key, cursor] of [...this.projectionCursors.entries()]) {
          if (matchesScalarOrIn(cursor.projectionName, where.projectionName)) {
            this.projectionCursors.delete(key);
          }
        }
        return { count: 0 };
      },
    };
  }

  async $transaction(fn) {
    const clone = this.clone();
    const result = await fn(clone);
    this.adopt(clone);
    return result;
  }

  clone() {
    const clone = new CombinedMockPrisma(this.options);
    clone.transactions = this.transactions.map((row) => ({ ...row }));
    clone.messages = this.messages.map((row) => ({ ...row }));
    clone.events = this.events.map((row) => ({ ...row }));
    clone.blocks = this.blocks.map((row) => ({ ...row }));
    clone.accounts = this.accounts.map((row) => ({ ...row }));
    clone.decodeFailures = this.decodeFailures.map((row) => ({ ...row }));
    clone.indexerCursors = this.indexerCursors.map((row) => ({ ...row }));
    clone.metadataChanges = cloneMap(this.metadataChanges);
    clone.lifecycleEvents = cloneMap(this.lifecycleEvents);
    clone.nextLifecycleEventId = this.nextLifecycleEventId;
    clone.payoutChanges = cloneMap(this.payoutChanges);
    clone.parameterChanges = cloneMap(this.parameterChanges);
    clone.keyRotations = this.keyRotations.map((row) => ({ ...row }));
    clone.nextKeyRotationId = this.nextKeyRotationId;
    clone.consensusWindows = this.consensusWindows.map((row) => ({ ...row }));
    clone.nextConsensusWindowId = this.nextConsensusWindowId;
    clone.coreSlotProjections = cloneMap(this.coreSlotProjections);
    clone.projectionFailures = this.projectionFailures.map((row) => ({ ...row }));
    clone.projectionCursors = cloneMap(this.projectionCursors);
    return clone;
  }

  adopt(other) {
    this.transactions = other.transactions;
    this.messages = other.messages;
    this.events = other.events;
    this.blocks = other.blocks;
    this.accounts = other.accounts;
    this.decodeFailures = other.decodeFailures;
    this.indexerCursors = other.indexerCursors;
    this.metadataChanges = other.metadataChanges;
    this.lifecycleEvents = other.lifecycleEvents;
    this.nextLifecycleEventId = other.nextLifecycleEventId;
    this.payoutChanges = other.payoutChanges;
    this.parameterChanges = other.parameterChanges;
    this.keyRotations = other.keyRotations;
    this.nextKeyRotationId = other.nextKeyRotationId;
    this.consensusWindows = other.consensusWindows;
    this.nextConsensusWindowId = other.nextConsensusWindowId;
    this.coreSlotProjections = other.coreSlotProjections;
    this.projectionFailures = other.projectionFailures;
    this.projectionCursors = other.projectionCursors;
  }

  seedCursor(projectionName, height) {
    this.projectionCursors.set(`${projectionName}:${CHAIN_ID}`, {
      projectionName,
      chainId: CHAIN_ID,
      lastProjectedHeight: height,
      status: 'idle',
    });
  }

  seedMetadataAt(height) {
    const hash = txHash('meta', height);
    this.transactions.push(successTx(hash, height));
    this.messages.push({
      id: nextId(this.messages),
      txHash: hash,
      height,
      msgIndex: 0,
      typeUrl: METADATA_TYPE_URL,
      module: 'coreslot',
      decodedJson: { slot_id: '1', operator: OPERATOR, metadata: { moniker: 'explorer-smoke' } },
      rawJson: {},
    });
    this.events.push({
      id: nextId(this.events),
      height,
      txHash: hash,
      msgIndex: 0,
      type: 'coreslot_metadata_updated',
      attributesJson: [
        { key: 'slot_id', value: '1' },
        { key: 'operator_address', value: OPERATOR },
        { key: 'msg_index', value: '0' },
      ],
    });
  }

  seedActivateAt(height) {
    const hash = txHash('activate', height);
    this.transactions.push(successTx(hash, height));
    this.messages.push({
      id: nextId(this.messages),
      txHash: hash,
      height,
      msgIndex: 0,
      typeUrl: ACTIVATE_TYPE_URL,
      module: 'coreslot',
      decodedJson: { slot_id: '1', operator_address: OPERATOR },
      rawJson: {},
    });
    this.events.push({
      id: nextId(this.events),
      height,
      txHash: hash,
      msgIndex: 0,
      type: 'coreslot_activated',
      attributesJson: [
        { key: 'slot_id', value: '1' },
        { key: 'operator_address', value: OPERATOR },
        { key: 'consensus_address', value: CONSENSUS },
        { key: 'new_status', value: 'ACTIVE' },
        { key: 'power', value: '1' },
        { key: 'msg_index', value: '0' },
      ],
    });
  }

  seedPayoutAt(height) {
    const hash = txHash('payout', height);
    this.transactions.push(successTx(hash, height));
    this.messages.push({
      id: nextId(this.messages),
      txHash: hash,
      height,
      msgIndex: 0,
      typeUrl: PAYOUT_TYPE_URL,
      module: 'coreslot',
      decodedJson: { slot_id: '1', operator: OPERATOR, new_payout_address: NEW_PAYOUT },
      rawJson: {},
    });
    this.events.push({
      id: nextId(this.events),
      height,
      txHash: hash,
      msgIndex: 0,
      type: 'coreslot_payout_updated',
      attributesJson: [
        { key: 'slot_id', value: '1' },
        { key: 'operator_address', value: OPERATOR },
        { key: 'msg_index', value: '0' },
      ],
    });
  }

  seedParamsAt(height) {
    const hash = txHash('params', height);
    this.transactions.push(successTx(hash, height));
    this.messages.push({
      id: nextId(this.messages),
      txHash: hash,
      height,
      msgIndex: 0,
      typeUrl: PARAMS_TYPE_URL,
      module: 'coreslot',
      decodedJson: { authority: AUTHORITY, params: { epochLength: '100' } },
      rawJson: {},
    });
    this.events.push({
      id: nextId(this.events),
      height,
      txHash: hash,
      msgIndex: 0,
      type: 'coreslot_params_updated',
      attributesJson: [
        { key: 'authority', value: AUTHORITY },
        { key: 'msg_index', value: '0' },
      ],
    });
  }

  seedAllSemanticRows() {
    this.seedMetadataAt(120n);
    this.seedActivateAt(121n);
    this.seedPayoutAt(122n);
    this.seedParamsAt(123n);
    this.metadataChanges.set('1', { sourceMessageId: 1n });
    this.lifecycleEvents.set('1', { sourceEventId: 1n });
    this.payoutChanges.set('1', { sourceMessageId: 1n });
    this.parameterChanges.set('1', { sourceMessageId: 1n });
    this.keyRotations.push({ id: 1n, slotId: 1n, status: 'requested' });
    this.consensusWindows.push({
      id: 1n,
      slotId: 1n,
      consensusAddress: CONSENSUS,
      status: 'ACTIVE',
      validatorUpdateHeight: 119n,
      effectiveFromHeight: 121n,
      effectiveToHeight: null,
      openedByKind: 'lifecycle',
    });
    this.coreSlotProjections.set('1', { slotId: 1n });
  }
}

function matchRotation(row, where) {
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'OR' && Array.isArray(condition)) {
      if (!condition.some((branch) => matchRotation(row, branch))) return false;
      continue;
    }
    if (condition !== null && typeof condition === 'object' && !Array.isArray(condition)) {
      return false;
    }
    if (row[key] !== condition) return false;
  }
  return true;
}

function matchConsensusWindow(row, where) {
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'OR' && Array.isArray(condition)) {
      if (!condition.some((branch) => matchConsensusWindow(row, branch))) return false;
      continue;
    }
    if (condition !== null && typeof condition === 'object' && !Array.isArray(condition)) {
      if (condition.lte !== undefined && !(row[key] <= condition.lte)) return false;
      if (condition.gt !== undefined && !(row[key] !== null && row[key] > condition.gt)) return false;
      if (condition.in !== undefined && !condition.in.includes(row[key])) return false;
      continue;
    }
    if (row[key] !== condition) return false;
  }
  return true;
}

function mapModel(prisma, field, keyOf) {
  return {
    upsert: async (args) => upsertIntoMap(prisma[field], keyOf(args), args),
    deleteMany: async () => {
      prisma[field].clear();
      return { count: 0 };
    },
  };
}

function upsertIntoMap(map, key, args) {
  const existing = map.get(key);
  const next = existing ? { ...existing, ...args.update } : { ...args.create };
  map.set(key, next);
  return next;
}

function matchesScalarOrIn(value, condition) {
  if (condition === undefined) return true;
  if (condition && typeof condition === 'object' && Array.isArray(condition.in)) {
    return condition.in.includes(value);
  }
  return value === condition;
}

function successTx(hash, height) {
  return { hash, height, status: 'success', code: 0 };
}

function txHash(kind, height) {
  return `${kind}-${height.toString()}`;
}

function nextId(rows) {
  return BigInt(rows.length + 1);
}

function cloneMap(map) {
  return new Map([...map.entries()].map(([key, value]) => [key, { ...value }]));
}

function cursorKey(value) {
  return `${value.projectionName}:${value.chainId}`;
}
