import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CORESLOT_KEY_ROTATION_STATUS,
  CORESLOT_TEMPORAL_MAP_PROJECTION,
} from '../../dist/projections/types.js';
import {
  VALIDATOR_SET_MEMBERSHIP_OFFSET,
  findConsensusWindowAtHeight,
  findSlotConsensusWindowAtHeight,
  projectCoreSlotTemporalMapHeight,
  projectCoreSlotTemporalMapRange,
  seedCoreSlotGenesisTemporalMap,
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
const SLOT4_GENESIS_PUBKEY = 'tUWPEa11HIE67ApPunYmzh1ixkPZJyS32mZAGrpaLJs=';
const SLOT4_CONSENSUS = 'f060bf2347c76488a0390285e3b9ef3a44ec7d23';

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
      validatorUpdateHeight: overrides.validatorUpdateHeight ?? 3n,
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
  it('uses the Phase 6b-3 validator-set membership offset', () => {
    assert.equal(VALIDATOR_SET_MEMBERSHIP_OFFSET, 2n);
  });

  it('seeds one ACTIVE genesis window per active genesis CoreSlot at height 1', async () => {
    const prisma = new TemporalMockPrisma();

    await seedCoreSlotGenesisTemporalMap({
      prisma,
      chainId: CHAIN_ID,
      client: genesisClient([
        genesisSlot({ slotId: '1', consensusAddress: OLD }),
        genesisSlot({ slotId: '2', consensusAddress: NEW, operatorAddress: 'twilight1two' }),
      ]),
    });

    assert.equal(prisma.windows.length, 2);
    assert.deepEqual(prisma.windows.map((window) => window.effectiveFromHeight), [1n, 1n]);
    assert.deepEqual(prisma.windows.map((window) => window.openedByKind), ['genesis', 'genesis']);
    assert.deepEqual(prisma.windows.map((window) => window.validatorUpdateHeight), [null, null]);
  });

  it('derives genesis consensus address from consensus_pubkey when hex address is omitted', async () => {
    const prisma = new TemporalMockPrisma();

    await seedCoreSlotGenesisTemporalMap({
      prisma,
      chainId: CHAIN_ID,
      client: genesisClient([
        genesisSlot({
          slotId: '4',
          consensusAddress: null,
          consensusPubkey: SLOT4_GENESIS_PUBKEY,
        }),
      ]),
    });

    assert.equal(prisma.windows.length, 1);
    assert.equal(prisma.windows[0].consensusAddress, SLOT4_CONSENSUS);
    assert.equal(prisma.windows[0].openedByKind, 'genesis');
  });

  it('does not apply the +2 membership offset to the genesis baseline', async () => {
    const prisma = new TemporalMockPrisma();

    await seedCoreSlotGenesisTemporalMap({
      prisma,
      chainId: CHAIN_ID,
      client: genesisClient([genesisSlot({ slotId: '1', consensusAddress: OLD })]),
    });
    prisma.seedActivation({ slotId: 2n, consensusAddress: NEW });
    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 10n });

    assert.equal(prisma.windows.find((window) => window.slotId === 1n).effectiveFromHeight, 1n);
    assert.equal(prisma.windows.find((window) => window.slotId === 2n).effectiveFromHeight, 12n);
  });

  it('skips inactive or keyless genesis slots without failure', async () => {
    const prisma = new TemporalMockPrisma();

    await seedCoreSlotGenesisTemporalMap({
      prisma,
      chainId: CHAIN_ID,
      client: genesisClient([
        genesisSlot({ slotId: '1', status: 'SLOT_STATUS_INACTIVE', consensusAddress: OLD }),
        genesisSlot({ slotId: '2', status: 'SLOT_STATUS_INACTIVE', consensusAddress: '' }),
      ]),
    });

    assert.equal(prisma.windows.length, 0);
    assert.equal(prisma.projectionFailures.length, 0);
  });

  it('closes a seeded genesis window at the later inactivation +2 height', async () => {
    const prisma = new TemporalMockPrisma();

    await seedCoreSlotGenesisTemporalMap({
      prisma,
      chainId: CHAIN_ID,
      client: genesisClient([genesisSlot({ slotId: '4', consensusAddress: OLD })]),
    });
    prisma.lifecycleEvents.push(lifecycle('coreslot_inactivated', 3554n, {
      slotId: 4n,
      consensusAddress: OLD,
    }));
    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 3554n });

    assert.equal(prisma.windows.length, 1);
    assert.equal(prisma.windows[0].effectiveFromHeight, 1n);
    assert.equal(prisma.windows[0].effectiveToHeight, 3556n);
    assert.equal(prisma.projectionFailures.length, 0);
  });

  it('supersedes a seeded genesis window at a later rotation boundary', async () => {
    const prisma = new TemporalMockPrisma();

    await seedCoreSlotGenesisTemporalMap({
      prisma,
      chainId: CHAIN_ID,
      client: genesisClient([genesisSlot({ slotId: '1', consensusAddress: OLD })]),
    });
    prisma.seedRotation(CORESLOT_KEY_ROTATION_STATUS.applied, {
      slotId: 1n,
      oldConsensusAddress: OLD,
      newConsensusAddress: NEW,
      effectiveHeight: 15n,
      appliedHeight: 15n,
    });
    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 15n });

    assert.equal(prisma.windows.length, 2);
    assert.equal(prisma.windows[0].effectiveToHeight, 17n);
    assert.equal(prisma.windows[1].consensusAddress, NEW);
    assert.equal(prisma.windows[1].effectiveFromHeight, 17n);
  });

  it('re-seeding genesis is idempotent', async () => {
    const prisma = new TemporalMockPrisma();
    const client = genesisClient([genesisSlot({ slotId: '1', consensusAddress: OLD })]);

    await seedCoreSlotGenesisTemporalMap({ prisma, chainId: CHAIN_ID, client });
    await seedCoreSlotGenesisTemporalMap({ prisma, chainId: CHAIN_ID, client });

    assert.equal(prisma.windows.length, 1);
    assert.equal(prisma.projectionFailures.length, 0);
  });

  it('full reset plus seed rebuild reproduces equivalent windows', async () => {
    const prisma = new TemporalMockPrisma();
    const client = genesisClient([genesisSlot({ slotId: '1', consensusAddress: OLD })]);

    await seedCoreSlotGenesisTemporalMap({ prisma, chainId: CHAIN_ID, client });
    const first = comparableWindows(prisma.windows);
    await resetCoreSlotTemporalMapProjection(prisma);
    await seedCoreSlotGenesisTemporalMap({ prisma, chainId: CHAIN_ID, client });

    assert.deepEqual(comparableWindows(prisma.windows), first);
  });

  it('records invalid_consensus_address for active genesis slots with invalid consensus address', async () => {
    const prisma = new TemporalMockPrisma();

    await seedCoreSlotGenesisTemporalMap({
      prisma,
      chainId: CHAIN_ID,
      client: genesisClient([genesisSlot({ slotId: '1', consensusAddress: 'bad' })]),
    });

    assert.equal(prisma.windows.length, 0);
    assert.equal(prisma.projectionFailures[0].failureKind, 'invalid_consensus_address');
  });

  it('records invalid_consensus_address for active genesis slots missing consensus address', async () => {
    const prisma = new TemporalMockPrisma();

    await seedCoreSlotGenesisTemporalMap({
      prisma,
      chainId: CHAIN_ID,
      client: genesisClient([genesisSlot({ slotId: '1', consensusAddress: '' })]),
    });

    assert.equal(prisma.windows.length, 0);
    assert.equal(prisma.projectionFailures[0].failureKind, 'invalid_consensus_address');
  });

  it('FU-1: a genesis ProjectionFailure is stamped at the 0n sentinel and survives the height-1 cleanup', async () => {
    const prisma = new TemporalMockPrisma();

    // A malformed active genesis slot -> a genesis-seed ProjectionFailure.
    await seedCoreSlotGenesisTemporalMap({
      prisma,
      chainId: CHAIN_ID,
      client: genesisClient([genesisSlot({ slotId: '1', consensusAddress: 'bad' })]),
    });
    assert.equal(prisma.projectionFailures.length, 1);
    assert.equal(prisma.projectionFailures[0].failureKind, 'invalid_consensus_address');
    // Durability: stamped below any real block height (which starts at 1).
    assert.equal(prisma.projectionFailures[0].sourceHeight, 0n);

    // Control: a (non-genesis) failure at height 1, resolved:false. The height-1 per-height cleanup
    // MUST delete this — proving the cleanup is genuinely live — while the 0n genesis failure survives.
    // (Pre-fix the genesis failure was itself stamped at 1n and got deleted right here, with the control.)
    const projectionName = prisma.projectionFailures[0].projectionName;
    prisma.projectionFailures.push({
      failureKey: 'control-1n',
      projectionName,
      sourceHeight: 1n,
      failureKind: 'temporal_window_conflict',
      resolved: false,
    });
    assert.equal(prisma.projectionFailures.length, 2);

    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 1n });

    // The 1n control is deleted; the 0n genesis failure remains.
    assert.equal(
      prisma.projectionFailures.length,
      1,
      'height-1 cleanup deletes the 1n control but keeps the 0n genesis failure',
    );
    assert.equal(prisma.projectionFailures[0].sourceHeight, 0n);
    assert.equal(prisma.projectionFailures[0].failureKind, 'invalid_consensus_address');
  });

  it('records temporal_window_conflict for duplicate active genesis consensus addresses', async () => {
    const prisma = new TemporalMockPrisma();

    await seedCoreSlotGenesisTemporalMap({
      prisma,
      chainId: CHAIN_ID,
      client: genesisClient([
        genesisSlot({ slotId: '1', consensusAddress: OLD }),
        genesisSlot({ slotId: '2', consensusAddress: OLD }),
      ]),
    });

    assert.equal(prisma.windows.length, 1);
    assert.equal(prisma.projectionFailures[0].failureKind, 'temporal_window_conflict');
  });

  it('records genesis_coreslot_malformed when genesis app_state.coreslot is missing', async () => {
    const prisma = new TemporalMockPrisma();

    await assert.rejects(
      () => seedCoreSlotGenesisTemporalMap({
        prisma,
        chainId: CHAIN_ID,
        client: genesisClient(null),
      }),
      /app_state\.coreslot/,
    );
    assert.equal(prisma.projectionFailures[0].failureKind, 'genesis_coreslot_malformed');
  });

  it('range projection can seed genesis before event replay', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.lifecycleEvents.push(lifecycle('coreslot_inactivated', 10n, {
      slotId: 1n,
      consensusAddress: OLD,
    }));

    await projectCoreSlotTemporalMapRange({
      prisma,
      chainId: CHAIN_ID,
      startHeight: 1n,
      endHeight: 10n,
      client: genesisClient([genesisSlot({ slotId: '1', consensusAddress: OLD })]),
    });

    assert.equal(prisma.windows[0].effectiveFromHeight, 1n);
    assert.equal(prisma.windows[0].effectiveToHeight, 12n);
  });

  it('activation opens ACTIVE consensus window', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedActivation();

    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 10n });

    assert.equal(prisma.windows.length, 1);
    assert.equal(prisma.windows[0].status, 'ACTIVE');
    assert.equal(prisma.windows[0].validatorUpdateHeight, 10n);
    assert.equal(prisma.windows[0].effectiveFromHeight, 12n);
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

    assert.equal(prisma.windows[0].effectiveToHeight, 12n);
    assert.equal(prisma.windows[0].closedByKind, 'lifecycle');
  });

  it('suspension closes open window at effective height', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedOpenWindow();
    prisma.lifecycleEvents.push(lifecycle('coreslot_suspended', 10n));

    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 10n });

    assert.equal(prisma.windows[0].effectiveToHeight, 12n);
  });

  it('removal closes open window at effective height', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedOpenWindow();
    prisma.lifecycleEvents.push(lifecycle('coreslot_removed', 10n));

    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 10n });

    assert.equal(prisma.windows[0].effectiveToHeight, 12n);
  });

  it('applied key rotation closes old window and opens new window', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedOpenWindow();
    prisma.seedRotation(CORESLOT_KEY_ROTATION_STATUS.applied);

    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 15n });

    assert.equal(prisma.windows.length, 2);
    assert.equal(prisma.windows[0].effectiveToHeight, 17n);
    assert.equal(prisma.windows[1].consensusAddress, NEW);
    assert.equal(prisma.windows[1].validatorUpdateHeight, 15n);
    assert.equal(prisma.windows[1].effectiveFromHeight, 17n);
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
    assert.equal(prisma.windows[0].effectiveToHeight, 17n);
    assert.equal(prisma.windows[1].validatorUpdateHeight, 15n);
    assert.equal(prisma.windows[1].effectiveFromHeight, 17n);
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
    assert.equal(prisma.windows[0].effectiveToHeight, 17n);
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
    prisma.seedOpenWindow({ consensusAddress: OLD, effectiveFromHeight: 12n });
    prisma.seedActivation({ consensusAddress: NEW });

    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 10n });

    assert.equal(prisma.windows.length, 1);
    assert.equal(prisma.projectionFailures[0].failureKind, 'temporal_window_conflict');
  });

  it('effectiveToHeight must be greater than effectiveFromHeight', async () => {
    const prisma = new TemporalMockPrisma();
    prisma.seedOpenWindow({ effectiveFromHeight: 12n });
    prisma.lifecycleEvents.push(lifecycle('coreslot_inactivated', 10n));

    await projectCoreSlotTemporalMapHeight({ prisma, chainId: CHAIN_ID, height: 10n });

    assert.equal(prisma.windows[0].effectiveToHeight, null);
    assert.equal(prisma.projectionFailures[0].failureKind, 'effective_height_invalid');
  });

  it('encodes Phase 6b-3 fixture boundaries for slot 4 lifecycle and rotation', async () => {
    const prisma = new TemporalMockPrisma();
    const slot4Old = 'f060bf2347c76488a0390285e3b9ef3a44ec7d23';
    const slot4New = 'fa90d27eb73b75fed0fc7587d95da6537dc76f23';

    prisma.seedOpenWindow({
      slotId: 4n,
      consensusAddress: slot4Old,
      operatorAddress: OPERATOR,
      validatorUpdateHeight: 3550n,
      effectiveFromHeight: 3552n,
    });
    prisma.lifecycleEvents.push(lifecycle('coreslot_inactivated', 3554n, {
      id: 3554n,
      sourceEventId: 3554n,
      slotId: 4n,
      consensusAddress: slot4Old,
    }));
    prisma.lifecycleEvents.push(lifecycle('coreslot_activated', 3567n, {
      id: 3567n,
      sourceEventId: 3567n,
      slotId: 4n,
      consensusAddress: slot4Old,
    }));
    prisma.rotations.push(rotation(CORESLOT_KEY_ROTATION_STATUS.applied, {
      id: 3582n,
      slotId: 4n,
      oldConsensusAddress: slot4Old,
      newConsensusAddress: slot4New,
      effectiveHeight: 3582n,
      appliedHeight: 3582n,
      sourceAppliedEventId: 3582n,
    }));

    await projectCoreSlotTemporalMapRange({
      prisma,
      chainId: CHAIN_ID,
      startHeight: 3554n,
      endHeight: 3582n,
    });

    assert.equal(prisma.windows.length, 3);
    assert.equal(prisma.windows[0].effectiveToHeight, 3556n);
    assert.equal(prisma.windows[1].consensusAddress, slot4Old);
    assert.equal(prisma.windows[1].validatorUpdateHeight, 3567n);
    assert.equal(prisma.windows[1].effectiveFromHeight, 3569n);
    assert.equal(prisma.windows[1].effectiveToHeight, 3584n);
    assert.equal(prisma.windows[2].consensusAddress, slot4New);
    assert.equal(prisma.windows[2].validatorUpdateHeight, 3582n);
    assert.equal(prisma.windows[2].effectiveFromHeight, 3584n);
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

function genesisClient(slots) {
  return {
    async getGenesis() {
      return {
        chainId: CHAIN_ID,
        initialHeight: '1',
        coreSlot: slots === null ? null : { slots },
        raw: { app_state: { coreslot: slots === null ? null : { slots } } },
      };
    },
  };
}

function genesisSlot(overrides = {}) {
  const slot = {
    slot_id: overrides.slotId ?? '1',
    status: overrides.status ?? 'SLOT_STATUS_ACTIVE',
    operator_address: overrides.operatorAddress ?? OPERATOR,
    consensus_address: overrides.consensusAddress === undefined ? OLD : overrides.consensusAddress,
    consensus_power: overrides.consensusPower ?? '1',
  };
  if (overrides.consensusPubkey !== undefined) {
    slot.consensus_pubkey = {
      '@type': '/cosmos.crypto.ed25519.PubKey',
      key: overrides.consensusPubkey,
    };
  }
  return slot;
}

function comparableWindows(windows) {
  return windows.map((window) => ({
    slotId: window.slotId,
    operatorAddress: window.operatorAddress,
    consensusAddress: window.consensusAddress,
    consensusPower: window.consensusPower,
    validatorUpdateHeight: window.validatorUpdateHeight,
    effectiveFromHeight: window.effectiveFromHeight,
    effectiveToHeight: window.effectiveToHeight,
    openedByKind: window.openedByKind,
  }));
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
