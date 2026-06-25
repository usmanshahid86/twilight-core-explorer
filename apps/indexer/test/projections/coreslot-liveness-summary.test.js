import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  CORESLOT_LIVENESS_PROJECTION,
  CORESLOT_LIVENESS_SUMMARY_PROJECTION,
  CORESLOT_LIVENESS_SUMMARY_STATUS,
} from '../../dist/projections/types.js';
import { projectCoreSlotLivenessSummary } from '../../dist/projections/coreslot-liveness-summary.js';
import { resetCoreSlotLivenessSummaryProjection } from '../../dist/projections/reset-coreslot-liveness-summary.js';

const CHAIN_ID = 'twilight-test';
const get = (p, slot, kind) =>
  p.summaries.find((s) => s.slotId === BigInt(slot) && s.windowKind === kind);

describe('CoreSlot liveness summary projection (8c-2)', () => {
  it('all-signed lifetime summary -> uptime 10000, complete', async () => {
    const p = new MockSummaryPrisma();
    for (let h = 1; h <= 5; h += 1) p.seedEvidence(signedEv({ slot: 1, committed: h }));

    await projectCoreSlotLivenessSummary({ prisma: p, chainId: CHAIN_ID });

    const life = get(p, 1, 'lifetime');
    assert.equal(life.expectedCount, 5);
    assert.equal(life.signedCount, 5);
    assert.equal(life.missedCount, 0);
    assert.equal(life.uptimeBps, 10000);
    assert.equal(life.currentSignedStreak, 5);
    assert.equal(life.currentMissedStreak, 0);
    assert.equal(life.summaryStatus, CORESLOT_LIVENESS_SUMMARY_STATUS.complete);
  });

  it('absent and nil are both missed, counted separately', async () => {
    const p = new MockSummaryPrisma();
    p.seedEvidence(signedEv({ slot: 1, committed: 1 }));
    p.seedEvidence(absentEv({ slot: 1, committed: 2 }));
    p.seedEvidence(nilEv({ slot: 1, committed: 3 }));

    await projectCoreSlotLivenessSummary({ prisma: p, chainId: CHAIN_ID });

    const life = get(p, 1, 'lifetime');
    assert.equal(life.missedCount, 2);
    assert.equal(life.absentMissedCount, 1);
    assert.equal(life.nilMissedCount, 1);
    assert.equal(life.signedCount, 1);
    assert.equal(life.signedCount + life.missedCount, life.expectedCount); // invariant
    assert.equal(life.absentMissedCount + life.nilMissedCount, life.missedCount); // invariant
    assert.equal(life.latestMissedHeight, 3n);
    assert.equal(life.currentMissedStreak, 2); // trailing absent(2)+nil(3)
    assert.equal(life.currentSignedStreak, 0);
  });

  it('uptimeBps floors, and recent_100 captures the trailing window (8861 / 5900)', async () => {
    const p = new MockSummaryPrisma();
    // 360 heights: 1..319 signed, 320..358 absent (39), 359..360 nil (2). 319 signed / 360.
    for (let h = 1; h <= 360; h += 1) {
      if (h <= 319) p.seedEvidence(signedEv({ slot: 4, committed: h }));
      else if (h <= 358) p.seedEvidence(absentEv({ slot: 4, committed: h }));
      else p.seedEvidence(nilEv({ slot: 4, committed: h }));
    }

    await projectCoreSlotLivenessSummary({ prisma: p, chainId: CHAIN_ID });

    const life = get(p, 4, 'lifetime');
    assert.equal(life.expectedCount, 360);
    assert.equal(life.signedCount, 319);
    assert.equal(life.missedCount, 41);
    assert.equal(life.absentMissedCount, 39);
    assert.equal(life.nilMissedCount, 2);
    assert.equal(life.uptimeBps, 8861); // floor(319*10000/360)

    const r100 = get(p, 4, 'recent_100');
    assert.equal(r100.expectedCount, 100);
    assert.equal(r100.signedCount, 59);
    assert.equal(r100.missedCount, 41);
    assert.equal(r100.uptimeBps, 5900);

    // recent_500 / recent_1000 collapse to lifetime (only 360 heights present)
    assert.equal(get(p, 4, 'recent_500').expectedCount, 360);
    assert.equal(get(p, 4, 'recent_1000').expectedCount, 360);
  });

  it('empty evidence -> no summary rows', async () => {
    const p = new MockSummaryPrisma();
    await projectCoreSlotLivenessSummary({ prisma: p, chainId: CHAIN_ID });
    assert.equal(p.summaries.length, 0);
  });

  it('sparse evidence -> span exposes the gap; counts use present rows only', async () => {
    const p = new MockSummaryPrisma();
    p.seedEvidence(signedEv({ slot: 1, committed: 10 }));
    p.seedEvidence(signedEv({ slot: 1, committed: 12 }));
    p.seedEvidence(signedEv({ slot: 1, committed: 15 }));

    await projectCoreSlotLivenessSummary({ prisma: p, chainId: CHAIN_ID });

    const life = get(p, 1, 'lifetime');
    assert.equal(life.firstCommittedHeight, 10n);
    assert.equal(life.lastCommittedHeight, 15n);
    assert.equal(life.spanHeightCount, 6n);     // 15-10+1
    assert.equal(life.evidenceHeightCount, 3);  // gap = 6-3 = 3
  });

  it('unresolved coreslot_liveness_v1 failure inside the span marks the window incomplete', async () => {
    const p = new MockSummaryPrisma();
    for (let h = 10; h <= 20; h += 1) {
      if (h === 15) continue; // 15 was invalidated upstream (evidence deleted)
      p.seedEvidence(signedEv({ slot: 1, committed: h }));
    }
    p.seedFailure({ projectionName: CORESLOT_LIVENESS_PROJECTION, committedHeight: 15n, resolved: false });

    await projectCoreSlotLivenessSummary({ prisma: p, chainId: CHAIN_ID });

    const life = get(p, 1, 'lifetime');
    assert.equal(life.invalidHeightCount, 1);
    assert.equal(life.summaryStatus, CORESLOT_LIVENESS_SUMMARY_STATUS.incomplete);
    // counts are unaffected by the coverage flag
    assert.equal(life.expectedCount, 10);
    assert.equal(life.signedCount, 10);
    assert.equal(life.uptimeBps, 10000);
  });

  it('failure outside the span does not mark incomplete', async () => {
    const p = new MockSummaryPrisma();
    for (let h = 10; h <= 20; h += 1) p.seedEvidence(signedEv({ slot: 1, committed: h }));
    p.seedFailure({ projectionName: CORESLOT_LIVENESS_PROJECTION, committedHeight: 99n, resolved: false });

    await projectCoreSlotLivenessSummary({ prisma: p, chainId: CHAIN_ID });

    const life = get(p, 1, 'lifetime');
    assert.equal(life.invalidHeightCount, 0);
    assert.equal(life.summaryStatus, CORESLOT_LIVENESS_SUMMARY_STATUS.complete);
  });

  it('latest operatorAddress wins; counts span all operators', async () => {
    const p = new MockSummaryPrisma();
    p.seedEvidence(signedEv({ slot: 1, committed: 1, operator: 'opA' }));
    p.seedEvidence(signedEv({ slot: 1, committed: 2, operator: 'opB' }));

    await projectCoreSlotLivenessSummary({ prisma: p, chainId: CHAIN_ID });

    const life = get(p, 1, 'lifetime');
    assert.equal(life.operatorAddress, 'opB'); // latest
    assert.equal(life.expectedCount, 2);
  });

  it('recent_N truncates to the trailing N present rows', async () => {
    const p = new MockSummaryPrisma();
    for (let h = 1; h <= 150; h += 1) p.seedEvidence(signedEv({ slot: 1, committed: h }));

    await projectCoreSlotLivenessSummary({ prisma: p, chainId: CHAIN_ID });

    assert.equal(get(p, 1, 'lifetime').expectedCount, 150);
    const r100 = get(p, 1, 'recent_100');
    assert.equal(r100.expectedCount, 100);
    assert.equal(r100.windowSize, 100);
    assert.equal(r100.firstCommittedHeight, 51n);
    assert.equal(r100.lastCommittedHeight, 150n);
  });

  it('invariant violation (unexpected evidence shape) -> failure, slot skipped', async () => {
    const p = new MockSummaryPrisma();
    p.seedEvidence(signedEv({ slot: 1, committed: 1 }));
    p.seedEvidence({ ...signedEv({ slot: 1, committed: 2 }), status: 'weird', missCause: null });

    await projectCoreSlotLivenessSummary({ prisma: p, chainId: CHAIN_ID });

    assert.equal(p.summaries.length, 0); // slot skipped
    assert.equal(
      p.failures.some((f) => f.failureKind === 'liveness_summary_invariant_violation'),
      true,
    );
  });

  it('rerun is idempotent (full recompute, no duplicate rows)', async () => {
    const p = new MockSummaryPrisma();
    for (let h = 1; h <= 4; h += 1) p.seedEvidence(signedEv({ slot: 1, committed: h }));

    await projectCoreSlotLivenessSummary({ prisma: p, chainId: CHAIN_ID });
    const firstCount = p.summaries.length;
    await projectCoreSlotLivenessSummary({ prisma: p, chainId: CHAIN_ID });

    assert.equal(p.summaries.length, firstCount); // 4 windowKinds, no dups
    assert.equal(firstCount, 4);
  });

  it('reset clears only summary state and preserves evidence + unrelated state', async () => {
    const p = new MockSummaryPrisma();
    p.summaries.push({ summaryKey: 'k' });
    p.seedEvidence(signedEv({ slot: 1, committed: 1 }));
    p.failures.push({ projectionName: CORESLOT_LIVENESS_SUMMARY_PROJECTION });
    p.failures.push({ projectionName: CORESLOT_LIVENESS_PROJECTION });
    p.cursors.set(`${CORESLOT_LIVENESS_SUMMARY_PROJECTION}:${CHAIN_ID}`, { projectionName: CORESLOT_LIVENESS_SUMMARY_PROJECTION });
    p.cursors.set(`${CORESLOT_LIVENESS_PROJECTION}:${CHAIN_ID}`, { projectionName: CORESLOT_LIVENESS_PROJECTION });

    await resetCoreSlotLivenessSummaryProjection(p);

    assert.equal(p.summaries.length, 0);
    assert.equal(p.evidence.length, 1);
    assert.equal(p.failures.length, 1);
    assert.equal(p.cursors.has(`${CORESLOT_LIVENESS_SUMMARY_PROJECTION}:${CHAIN_ID}`), false);
    assert.equal(p.cursors.has(`${CORESLOT_LIVENESS_PROJECTION}:${CHAIN_ID}`), true);
  });

  it('does not read 8a/8b, recompute misses, or implement health/proposer/API/web', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../src/projections/coreslot-liveness-summary.ts', import.meta.url)),
      'utf8',
    );
    assert.equal(/operatorSigningEvidence|blockSignature/i.test(src), false); // no 8a/8b re-read
    assert.equal(/proposer|healthy|degraded|rolling/i.test(src), false);
    assert.equal(src.includes('api/'), false);
    assert.equal(/\bweb\b/.test(src), false);
  });
});

// ---- mock + fixtures ----------------------------------------------------------

function signedEv(o) {
  return ev({ ...o, status: 'signed', missCause: null });
}
function absentEv(o) {
  return ev({ ...o, status: 'missed', missCause: 'absent' });
}
function nilEv(o) {
  return ev({ ...o, status: 'missed', missCause: 'nil' });
}
function ev({ slot, committed, status, missCause, operator = 'op', consAddr = 'addr', windowId = 1 }) {
  return {
    committedBlockHeight: BigInt(committed),
    slotId: BigInt(slot),
    status,
    missCause,
    operatorAddress: operator,
    consensusAddress: consAddr,
    consensusWindowId: BigInt(windowId),
  };
}

class MockSummaryPrisma {
  constructor() {
    this.evidence = [];
    this.summaries = [];
    this.failures = [];
    this.cursors = new Map();

    this.coreSlotLivenessEvidence = {
      findMany: async (args) =>
        applyOrdering(this.evidence.filter((r) => match(r, args?.where ?? {})), args?.orderBy),
    };
    this.coreSlotLivenessSummary = {
      deleteMany: async (args) => {
        const before = this.summaries.length;
        this.summaries = args?.where ? this.summaries.filter((r) => !match(r, args.where)) : [];
        return { count: before - this.summaries.length };
      },
      createMany: async (args) => {
        const data = Array.isArray(args.data) ? args.data : [args.data];
        for (const row of data) this.summaries.push({ ...row });
        return { count: data.length };
      },
    };
    this.projectionFailure = {
      findMany: async (args) => this.failures.filter((r) => match(r, args?.where ?? {})),
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

  seedEvidence(row) {
    this.evidence.push(row);
  }

  seedFailure(row) {
    this.failures.push(row);
  }

  async $transaction(fn) {
    const clone = this.clone();
    const result = await fn(clone);
    this.adopt(clone);
    return result;
  }

  clone() {
    const clone = new MockSummaryPrisma();
    clone.evidence = this.evidence.map((r) => ({ ...r }));
    clone.summaries = this.summaries.map((r) => ({ ...r }));
    clone.failures = this.failures.map((r) => ({ ...r }));
    clone.cursors = new Map([...this.cursors.entries()].map(([k, r]) => [k, { ...r }]));
    return clone;
  }

  adopt(other) {
    this.evidence = other.evidence;
    this.summaries = other.summaries;
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
