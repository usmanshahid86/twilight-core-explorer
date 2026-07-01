import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  PROPOSER_ATTRIBUTION_PROJECTION,
  PROPOSER_ATTRIBUTION_STATUS,
} from '../../dist/projections/types.js';
import {
  projectProposerAttributionHeight,
  projectProposerAttributionRange,
} from '../../dist/projections/proposer-attribution.js';
import { resetProposerAttributionProjection } from '../../dist/projections/reset-proposer-attribution.js';

const CHAIN_ID = 'twilight-test';
const LOWER = (n) => String(n).repeat(40).slice(0, 40);
const UPPER = (n) => LOWER(n).toUpperCase();
const OPERATOR = 'twilight1operator';

describe('Proposer attribution projection', () => {
  it('attributes a proposer to the CoreSlot window at the block height, lowercasing the address', async () => {
    const p = new MockProposerPrisma();
    p.seedBlock({ height: 11n, proposerAddress: UPPER('a') }); // CometBFT uppercase
    p.seedWindow({ id: 7n, slotId: 1n, operatorAddress: OPERATOR, consensusAddress: LOWER('a'), from: 5n });

    await projectProposerAttributionHeight({ prisma: p, chainId: CHAIN_ID, height: 11n });

    assert.equal(p.attributions.length, 1);
    assert.equal(p.attributions[0].attributionStatus, PROPOSER_ATTRIBUTION_STATUS.attributed);
    assert.equal(p.attributions[0].proposerAddress, LOWER('a')); // lowercased
    assert.equal(p.attributions[0].rawProposerAddress, UPPER('a')); // raw preserved
    assert.equal(p.attributions[0].slotId, 1n);
    assert.equal(p.attributions[0].operatorAddress, OPERATOR);
    assert.equal(p.attributions[0].consensusWindowId, 7n);
  });

  it('attributes using the block height N itself (no -1 shift)', async () => {
    const p = new MockProposerPrisma();
    p.seedBlock({ height: 100n, proposerAddress: UPPER('b') });
    // window covers 100 but NOT 99 -> only a height-N (not N-1) lookup attributes
    p.seedWindow({ id: 1n, slotId: 2n, consensusAddress: LOWER('b'), from: 100n });

    await projectProposerAttributionHeight({ prisma: p, chainId: CHAIN_ID, height: 100n });

    assert.equal(p.attributions[0].attributionStatus, PROPOSER_ATTRIBUTION_STATUS.attributed);
    assert.equal(p.attributions[0].slotId, 2n);
  });

  it('writes unmapped_validator when coverage exists but not for this proposer', async () => {
    const p = new MockProposerPrisma();
    p.seedBlock({ height: 11n, proposerAddress: UPPER('a') });
    p.seedWindow({ id: 2n, slotId: 2n, consensusAddress: LOWER('b'), from: 5n }); // different address

    await projectProposerAttributionHeight({ prisma: p, chainId: CHAIN_ID, height: 11n });

    assert.equal(p.attributions[0].attributionStatus, PROPOSER_ATTRIBUTION_STATUS.unmappedValidator);
    assert.equal(p.failures.length, 0);
  });

  // #59 regression: proposer attribution reads consensus windows from temporal-map via
  // findConsensusWindowAtHeight(block.height). The fixed CLI caps endHeight at min(maxBlock, temporal-map
  // cursor), so it never attributes a block whose window is not built yet (which would silently record
  // noConsensusWindow and advance past it). Mirrors the CLI cap: deferred until temporal-map catches up.
  it('#59: capping endHeight at the temporal-map cursor defers a block until its window exists, then attributes it', async () => {
    const cappedEnd = (requestedEnd, temporalMapCursor) =>
      (requestedEnd < temporalMapCursor ? requestedEnd : temporalMapCursor);

    const p = new MockProposerPrisma();
    p.seedBlock({ height: 11n, proposerAddress: UPPER('a') });

    // Temporal-map BEHIND (cursor 9): endHeight caps to 9 < startHeight 11 -> deferred, no mis-attribution.
    const behindEnd = cappedEnd(11n, 9n);
    if (behindEnd >= 11n) {
      await projectProposerAttributionRange({ prisma: p, chainId: CHAIN_ID, startHeight: 11n, endHeight: behindEnd });
    }
    assert.equal(p.attributions.length, 0, 'deferred while temporal-map (consensus windows) is behind');

    // Temporal-map catches up (cursor 11) and its window exists -> block 11 attributed to slot 1.
    p.seedWindow({ id: 7n, slotId: 1n, operatorAddress: OPERATOR, consensusAddress: LOWER('a'), from: 5n });
    await projectProposerAttributionRange({
      prisma: p,
      chainId: CHAIN_ID,
      startHeight: 11n,
      endHeight: cappedEnd(11n, 11n),
    });

    assert.equal(p.attributions[0].attributionStatus, PROPOSER_ATTRIBUTION_STATUS.attributed, 'attributed once temporal-map caught up');
    assert.equal(p.attributions[0].slotId, 1n);
  });

  it('writes no_consensus_window when no window covers the height', async () => {
    const p = new MockProposerPrisma();
    p.seedBlock({ height: 11n, proposerAddress: UPPER('a') });

    await projectProposerAttributionHeight({ prisma: p, chainId: CHAIN_ID, height: 11n });

    assert.equal(p.attributions[0].attributionStatus, PROPOSER_ATTRIBUTION_STATUS.noConsensusWindow);
    assert.equal(p.failures.length, 0);
  });

  it('writes missing_proposer for a null proposer address (no failure)', async () => {
    const p = new MockProposerPrisma();
    p.seedBlock({ height: 1n, proposerAddress: null });

    await projectProposerAttributionHeight({ prisma: p, chainId: CHAIN_ID, height: 1n });

    assert.equal(p.attributions[0].attributionStatus, PROPOSER_ATTRIBUTION_STATUS.missingProposer);
    assert.equal(p.attributions[0].proposerAddress, null);
    assert.equal(p.failures.length, 0);
  });

  it('writes invalid_proposer_address + a failure for a non-hex proposer', async () => {
    const p = new MockProposerPrisma();
    p.seedBlock({ height: 11n, proposerAddress: 'not-a-valid-hex-address' });

    await projectProposerAttributionHeight({ prisma: p, chainId: CHAIN_ID, height: 11n });

    assert.equal(p.attributions[0].attributionStatus, PROPOSER_ATTRIBUTION_STATUS.invalidProposerAddress);
    assert.equal(p.failures.some((f) => f.failureKind === 'invalid_proposer_address'), true);
  });

  it('rerun refreshes attribution instead of leaving stale status', async () => {
    const p = new MockProposerPrisma();
    p.seedBlock({ height: 11n, proposerAddress: UPPER('a') });
    await projectProposerAttributionRange({ prisma: p, chainId: CHAIN_ID, startHeight: 11n, endHeight: 11n });
    assert.equal(p.attributions[0].attributionStatus, PROPOSER_ATTRIBUTION_STATUS.noConsensusWindow);

    p.seedWindow({ id: 9n, slotId: 9n, consensusAddress: LOWER('a'), from: 5n });
    await projectProposerAttributionRange({ prisma: p, chainId: CHAIN_ID, startHeight: 11n, endHeight: 11n });

    assert.equal(p.attributions.length, 1);
    assert.equal(p.attributions[0].attributionStatus, PROPOSER_ATTRIBUTION_STATUS.attributed);
    assert.equal(p.attributions[0].slotId, 9n);
  });

  it('reset clears only proposer attribution state', async () => {
    const p = new MockProposerPrisma();
    p.attributions.push({ attributionKey: 'k' });
    p.blocks.push({ height: 1n, proposerAddress: UPPER('a') });
    p.windows.push(windowRow({ id: 1n, consensusAddress: LOWER('a') }));
    p.failures.push({ projectionName: PROPOSER_ATTRIBUTION_PROJECTION });
    p.failures.push({ projectionName: 'block_signatures_v1' });
    p.cursors.set(`${PROPOSER_ATTRIBUTION_PROJECTION}:${CHAIN_ID}`, { projectionName: PROPOSER_ATTRIBUTION_PROJECTION });
    p.cursors.set(`block_signatures_v1:${CHAIN_ID}`, { projectionName: 'block_signatures_v1' });

    await resetProposerAttributionProjection(p);

    assert.equal(p.attributions.length, 0);
    assert.equal(p.blocks.length, 1);
    assert.equal(p.windows.length, 1);
    assert.equal(p.failures.length, 1);
    assert.equal(p.cursors.has(`${PROPOSER_ATTRIBUTION_PROJECTION}:${CHAIN_ID}`), false);
    assert.equal(p.cursors.has(`block_signatures_v1:${CHAIN_ID}`), true);
  });

  it('does no live chain reads (DB/projection only)', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../src/projections/proposer-attribution.ts', import.meta.url)),
      'utf8',
    );
    assert.equal(/fetch\(|http|ChainClient|getStatus|rpc/i.test(src), false);
  });
});

// ---- mock + fixtures ----------------------------------------------------------

function windowRow(input) {
  return {
    id: input.id ?? 1n,
    slotId: input.slotId ?? 1n,
    operatorAddress: input.operatorAddress ?? OPERATOR,
    consensusAddress: input.consensusAddress ?? LOWER('a'),
    status: 'ACTIVE',
    consensusPower: input.consensusPower ?? 1n,
    validatorUpdateHeight: input.from ?? 1n,
    effectiveFromHeight: input.from ?? 1n,
    effectiveToHeight: input.to ?? null,
    openedByKind: 'genesis',
    openedByEventId: null,
    openedByRotationId: null,
    openedByLifecycleId: null,
    closedByKind: null,
    closedByEventId: null,
    closedByRotationId: null,
    closedByLifecycleId: null,
    rawOpenJson: null,
    rawCloseJson: null,
  };
}

class MockProposerPrisma {
  constructor() {
    this.blocks = [];
    this.windows = [];
    this.attributions = [];
    this.failures = [];
    this.cursors = new Map();

    this.block = {
      findMany: async (args) => applyOrdering(this.blocks.filter((r) => match(r, args?.where ?? {})), args?.orderBy),
    };
    this.coreSlotConsensusWindow = {
      findFirst: async (args) =>
        applyOrdering(this.windows.filter((r) => match(r, args?.where ?? {})), args?.orderBy)[0] ?? null,
      findMany: async (args) => applyOrdering(this.windows.filter((r) => match(r, args?.where ?? {})), args?.orderBy),
      count: async (args) => this.windows.filter((r) => match(r, args?.where ?? {})).length,
      create: async (a) => { this.windows.push(a.data); return a.data; },
      update: async () => ({}),
      deleteMany: async () => { this.windows = []; return { count: 0 }; },
    };
    this.blockProposerAttribution = {
      upsert: async (args) => {
        const key = args.where.attributionKey;
        const index = this.attributions.findIndex((r) => r.attributionKey === key);
        const next = index >= 0 ? { ...this.attributions[index], ...args.update } : { ...args.create };
        if (index >= 0) this.attributions[index] = next;
        else this.attributions.push(next);
        return next;
      },
      deleteMany: async (args) => {
        const before = this.attributions.length;
        this.attributions = args?.where ? this.attributions.filter((r) => !match(r, args.where)) : [];
        return { count: before - this.attributions.length };
      },
    };
    this.projectionFailure = {
      upsert: async (args) => {
        const key = args.where.failureKey;
        const index = this.failures.findIndex((r) => r.failureKey === key);
        const next = index >= 0 ? { ...this.failures[index], ...args.update } : { ...args.create };
        if (index >= 0) this.failures[index] = next;
        else this.failures.push(next);
        return next;
      },
      deleteMany: async (args) => {
        const before = this.failures.length;
        this.failures = this.failures.filter((r) => !match(r, args?.where ?? {}));
        return { count: before - this.failures.length };
      },
    };
    this.projectionCursor = {
      upsert: async (args) => {
        const keyArgs = args.where.projectionName_chainId ?? args.create;
        const key = `${keyArgs.projectionName}:${keyArgs.chainId}`;
        const existing = this.cursors.get(key);
        const next = existing ? { ...existing, ...args.update } : { ...args.create };
        this.cursors.set(key, next);
        return next;
      },
      deleteMany: async (args) => {
        for (const [key, cursor] of [...this.cursors.entries()]) {
          if (match(cursor, args?.where ?? {})) this.cursors.delete(key);
        }
        return { count: 0 };
      },
    };
  }

  seedBlock(row) { this.blocks.push(row); }
  seedWindow(input) { this.windows.push(windowRow(input)); }

  async $transaction(fn) {
    const clone = this.clone();
    const result = await fn(clone);
    this.adopt(clone);
    return result;
  }

  clone() {
    const clone = new MockProposerPrisma();
    clone.blocks = this.blocks.map((r) => ({ ...r }));
    clone.windows = this.windows.map((r) => ({ ...r }));
    clone.attributions = this.attributions.map((r) => ({ ...r }));
    clone.failures = this.failures.map((r) => ({ ...r }));
    clone.cursors = new Map([...this.cursors.entries()].map(([k, r]) => [k, { ...r }]));
    return clone;
  }

  adopt(other) {
    this.blocks = other.blocks;
    this.windows = other.windows;
    this.attributions = other.attributions;
    this.failures = other.failures;
    this.cursors = other.cursors;
  }
}

function applyOrdering(rows, orderBy = []) {
  const order = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const part of order) {
      const [field, direction] = Object.entries(part)[0] ?? [];
      if (!field) continue;
      if (a[field] === b[field]) continue;
      const result = a[field] > b[field] ? 1 : -1;
      return direction === 'desc' ? -result : result;
    }
    return 0;
  });
}

function match(row, where) {
  if (!where || Object.keys(where).length === 0) return true;
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'OR') return expected.some((clause) => match(row, clause));
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if ('not' in expected && row[key] === expected.not) return false;
      if ('gte' in expected && !(row[key] >= expected.gte)) return false;
      if ('lte' in expected && !(row[key] <= expected.lte)) return false;
      if ('gt' in expected && !(row[key] > expected.gt)) return false;
      if ('lt' in expected && !(row[key] < expected.lt)) return false;
      if ('in' in expected && !expected.in.includes(row[key])) return false;
      return true;
    }
    return row[key] === expected;
  });
}
