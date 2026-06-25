import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  CORESLOT_HEALTH_PROJECTION,
  CORESLOT_HEALTH_REASON,
  CORESLOT_HEALTH_STATUS,
  NETWORK_HALT_RISK_LEVEL,
  NETWORK_HALT_RISK_REASON,
} from '../../dist/projections/types.js';
import { projectCoreSlotHealth } from '../../dist/projections/coreslot-health.js';
import { resetCoreSlotHealthProjection } from '../../dist/projections/reset-coreslot-health.js';

const CHAIN_ID = 'twilight-test';
const ADDR = (n) => String(n).repeat(40).slice(0, 40);
const health = (p, slot) => p.health.find((h) => h.slotId === BigInt(slot));
const net = (p) => p.networkSnapshots[0];
let idSeq = 1000;

describe('CoreSlot health projection (8c-3)', () => {
  it('healthy slot: recent_100 complete, no misses', async () => {
    const p = new MockHealthPrisma();
    seedSlot(p, 1, {});

    await projectCoreSlotHealth({ prisma: p, chainId: CHAIN_ID });

    assert.equal(health(p, 1).healthStatus, CORESLOT_HEALTH_STATUS.healthy);
    assert.equal(health(p, 1).healthReason, CORESLOT_HEALTH_REASON.completeNoRecentMisses);
    assert.equal(health(p, 1).isActiveAtLatest, true);
    assert.equal(health(p, 1).policyVersion, 'coreslot_health_policy_v1');
  });

  it('degraded by recent misses (streak 0, missed > 0)', async () => {
    const p = new MockHealthPrisma();
    seedSlot(p, 1, { signed: 59, missed: 41, absent: 39, nil: 2, uptimeBps: 5900, signedStreak: 12, missedStreak: 0 });

    await projectCoreSlotHealth({ prisma: p, chainId: CHAIN_ID });

    assert.equal(health(p, 1).healthStatus, CORESLOT_HEALTH_STATUS.degraded);
    assert.equal(health(p, 1).healthReason, CORESLOT_HEALTH_REASON.recentMisses);
  });

  it('degraded by current miss streak (1..9)', async () => {
    const p = new MockHealthPrisma();
    seedSlot(p, 1, { signed: 95, missed: 5, absent: 5, missedStreak: 9 });

    await projectCoreSlotHealth({ prisma: p, chainId: CHAIN_ID });

    assert.equal(health(p, 1).healthStatus, CORESLOT_HEALTH_STATUS.degraded);
    assert.equal(health(p, 1).healthReason, CORESLOT_HEALTH_REASON.currentMissStreak);
  });

  it('down by sustained current miss streak (>= 10)', async () => {
    const p = new MockHealthPrisma();
    seedSlot(p, 1, { signed: 85, missed: 15, absent: 15, missedStreak: 12 });

    await projectCoreSlotHealth({ prisma: p, chainId: CHAIN_ID });

    assert.equal(health(p, 1).healthStatus, CORESLOT_HEALTH_STATUS.down);
    assert.equal(health(p, 1).healthReason, CORESLOT_HEALTH_REASON.sustainedMissStreak);
  });

  it('incomplete summary -> incomplete (does not pretend clean)', async () => {
    const p = new MockHealthPrisma();
    seedSlot(p, 1, { summaryStatus: 'incomplete', invalidHeightCount: 1 });

    await projectCoreSlotHealth({ prisma: p, chainId: CHAIN_ID });

    assert.equal(health(p, 1).healthStatus, CORESLOT_HEALTH_STATUS.incomplete);
    assert.equal(health(p, 1).healthReason, CORESLOT_HEALTH_REASON.incompleteSummary);
  });

  it('active slot with no recent_100 summary -> unknown / missing_summary', async () => {
    const p = new MockHealthPrisma();
    seedSlot(p, 1, {});                  // establishes networkLatestHeight
    p.seedWindow(windowRow({ slot: 2 })); // active, but no summary

    await projectCoreSlotHealth({ prisma: p, chainId: CHAIN_ID });

    assert.equal(health(p, 2).healthStatus, CORESLOT_HEALTH_STATUS.unknown);
    assert.equal(health(p, 2).healthReason, CORESLOT_HEALTH_REASON.missingSummary);
    assert.equal(health(p, 2).expectedCount, 0);
    assert.equal(health(p, 2).uptimeBps, null);
  });

  it('uptime threshold boundary: 9900 -> healthy, 9899 -> degraded; streak 10 -> down, 9 -> degraded', async () => {
    // isolate the uptime threshold (missed forced 0 to bypass the missed>0 branch)
    const a = new MockHealthPrisma();
    seedSlot(a, 1, { missed: 0, signed: 100, uptimeBps: 9900 });
    await projectCoreSlotHealth({ prisma: a, chainId: CHAIN_ID });
    assert.equal(health(a, 1).healthStatus, CORESLOT_HEALTH_STATUS.healthy);

    const b = new MockHealthPrisma();
    seedSlot(b, 1, { missed: 0, signed: 100, uptimeBps: 9899 });
    await projectCoreSlotHealth({ prisma: b, chainId: CHAIN_ID });
    assert.equal(health(b, 1).healthStatus, CORESLOT_HEALTH_STATUS.degraded);

    const c = new MockHealthPrisma();
    seedSlot(c, 1, { signed: 90, missed: 10, absent: 10, missedStreak: 10 });
    await projectCoreSlotHealth({ prisma: c, chainId: CHAIN_ID });
    assert.equal(health(c, 1).healthStatus, CORESLOT_HEALTH_STATUS.down);

    const d = new MockHealthPrisma();
    seedSlot(d, 1, { signed: 91, missed: 9, absent: 9, missedStreak: 9 });
    await projectCoreSlotHealth({ prisma: d, chainId: CHAIN_ID });
    assert.equal(health(d, 1).healthStatus, CORESLOT_HEALTH_STATUS.degraded);
  });

  it('lifetime/recent context uptimes are copied', async () => {
    const p = new MockHealthPrisma();
    p.seedWindow(windowRow({ slot: 1 }));
    p.seedSummary(summary({ slot: 1, windowKind: 'recent_100' }));
    p.seedSummary(summary({ slot: 1, windowKind: 'lifetime', signed: 319, missed: 41, absent: 39, nil: 2, expected: 360, uptimeBps: 8861 }));
    p.seedSummary(summary({ slot: 1, windowKind: 'recent_500', expected: 360, signed: 319, missed: 41, uptimeBps: 8861 }));
    p.seedSummary(summary({ slot: 1, windowKind: 'recent_1000', expected: 360, signed: 319, missed: 41, uptimeBps: 8861 }));

    await projectCoreSlotHealth({ prisma: p, chainId: CHAIN_ID });

    assert.equal(health(p, 1).lifetimeUptimeBps, 8861);
    assert.equal(health(p, 1).recent500UptimeBps, 8861);
    assert.equal(health(p, 1).recent1000UptimeBps, 8861);
  });

  it('latest identity copied from the active window', async () => {
    const p = new MockHealthPrisma();
    p.seedWindow(windowRow({ slot: 1, operator: 'opLatest', consAddr: ADDR(7) }));
    p.seedSummary(summary({ slot: 1, windowKind: 'recent_100', operator: 'opStale' }));

    await projectCoreSlotHealth({ prisma: p, chainId: CHAIN_ID });

    assert.equal(health(p, 1).operatorAddress, 'opLatest'); // window wins
    assert.equal(health(p, 1).consensusAddress, ADDR(7));
  });

  it('network normal: all slots healthy', async () => {
    const p = new MockHealthPrisma();
    for (let s = 1; s <= 4; s += 1) seedSlot(p, s, {});

    await projectCoreSlotHealth({ prisma: p, chainId: CHAIN_ID });

    assert.equal(net(p).haltRiskLevel, NETWORK_HALT_RISK_LEVEL.normal);
    assert.equal(net(p).haltRiskReason, NETWORK_HALT_RISK_REASON.allHealthy);
    assert.equal(net(p).availablePowerBps, 10000);
  });

  it('network warning: one degraded, no down', async () => {
    const p = new MockHealthPrisma();
    seedSlot(p, 1, {});
    seedSlot(p, 2, {});
    seedSlot(p, 3, {});
    seedSlot(p, 4, { signed: 95, missed: 5, absent: 5 }); // degraded

    await projectCoreSlotHealth({ prisma: p, chainId: CHAIN_ID });

    assert.equal(net(p).degradedSlotCount, 1);
    assert.equal(net(p).downSlotCount, 0);
    assert.equal(net(p).availablePowerBps, 10000);
    assert.equal(net(p).haltRiskLevel, NETWORK_HALT_RISK_LEVEL.warning);
  });

  it('network warning: one down but available power 7500 (> 2/3)', async () => {
    const p = new MockHealthPrisma();
    seedSlot(p, 1, {});
    seedSlot(p, 2, {});
    seedSlot(p, 3, {});
    seedSlot(p, 4, { signed: 80, missed: 20, absent: 20, missedStreak: 15 }); // down

    await projectCoreSlotHealth({ prisma: p, chainId: CHAIN_ID });

    assert.equal(net(p).downSlotCount, 1);
    assert.equal(net(p).availableSlotCount, 3);
    assert.equal(net(p).availablePowerBps, 7500);
    assert.equal(net(p).haltRiskLevel, NETWORK_HALT_RISK_LEVEL.warning);
  });

  it('network critical: two down, available power 5000 (<= 2/3)', async () => {
    const p = new MockHealthPrisma();
    seedSlot(p, 1, {});
    seedSlot(p, 2, {});
    seedSlot(p, 3, { signed: 80, missed: 20, absent: 20, missedStreak: 15 });
    seedSlot(p, 4, { signed: 80, missed: 20, absent: 20, missedStreak: 15 });

    await projectCoreSlotHealth({ prisma: p, chainId: CHAIN_ID });

    assert.equal(net(p).downSlotCount, 2);
    assert.equal(net(p).availablePowerBps, 5000);
    assert.equal(net(p).haltRiskLevel, NETWORK_HALT_RISK_LEVEL.critical);
    assert.equal(net(p).haltRiskReason, NETWORK_HALT_RISK_REASON.insufficientAvailablePower);
  });

  it('network unknown: any active incomplete/unknown slot', async () => {
    const p = new MockHealthPrisma();
    seedSlot(p, 1, {});
    seedSlot(p, 2, {});
    seedSlot(p, 3, {});
    seedSlot(p, 4, { summaryStatus: 'incomplete', invalidHeightCount: 1 }); // incomplete

    await projectCoreSlotHealth({ prisma: p, chainId: CHAIN_ID });

    assert.equal(net(p).haltRiskLevel, NETWORK_HALT_RISK_LEVEL.unknown);
    assert.equal(net(p).haltRiskReason, NETWORK_HALT_RISK_REASON.coverageUnknown);
  });

  it('corrupt active-slot summary: emit incomplete row + network coverage_unknown (never silently drop)', async () => {
    const p = new MockHealthPrisma();
    seedSlot(p, 1, {});
    seedSlot(p, 2, {});
    seedSlot(p, 3, {});
    // slot 4 active, but its recent_100 summary is invariant-violating (signed+missed != expected)
    p.seedWindow(windowRow({ slot: 4, operator: 'op4' }));
    p.seedSummary(summary({ slot: 4, windowKind: 'recent_100', expected: 100, signed: 50, missed: 10 }));

    await projectCoreSlotHealth({ prisma: p, chainId: CHAIN_ID });

    assert.equal(p.failures.some((f) => f.failureKind === 'coreslot_health_invariant_violation'), true);
    const slot4 = health(p, 4);
    assert.ok(slot4, 'slot 4 must not be silently dropped');
    assert.equal(slot4.healthStatus, CORESLOT_HEALTH_STATUS.incomplete);
    assert.equal(slot4.healthReason, CORESLOT_HEALTH_REASON.corruptSummary);
    assert.equal(slot4.isActiveAtLatest, true);
    assert.equal(slot4.operatorAddress, 'op4'); // identity from active window
    assert.equal(slot4.policyVersion, 'coreslot_health_policy_v1');
    assert.equal(p.health.length, 4);

    assert.equal(net(p).activeSlotCount, 4);
    assert.equal(net(p).healthySlotCount, 3);
    assert.equal(net(p).incompleteSlotCount, 1);
    assert.equal(net(p).haltRiskLevel, NETWORK_HALT_RISK_LEVEL.unknown);
    assert.equal(net(p).haltRiskReason, NETWORK_HALT_RISK_REASON.coverageUnknown);
  });

  it('idempotent full recompute (no duplicate rows)', async () => {
    const p = new MockHealthPrisma();
    for (let s = 1; s <= 3; s += 1) seedSlot(p, s, {});

    await projectCoreSlotHealth({ prisma: p, chainId: CHAIN_ID });
    await projectCoreSlotHealth({ prisma: p, chainId: CHAIN_ID });

    assert.equal(p.health.length, 3);
    assert.equal(p.networkSnapshots.length, 1);
  });

  it('reset clears only health/risk state and preserves summaries', async () => {
    const p = new MockHealthPrisma();
    p.health.push({ healthKey: 'k' });
    p.networkSnapshots.push({ riskKey: 'r' });
    p.seedSummary(summary({ slot: 1, windowKind: 'recent_100' }));
    p.failures.push({ projectionName: CORESLOT_HEALTH_PROJECTION });
    p.failures.push({ projectionName: 'coreslot_liveness_summary_v1' });
    p.cursors.set(`${CORESLOT_HEALTH_PROJECTION}:${CHAIN_ID}`, { projectionName: CORESLOT_HEALTH_PROJECTION });
    p.cursors.set(`coreslot_liveness_summary_v1:${CHAIN_ID}`, { projectionName: 'coreslot_liveness_summary_v1' });

    await resetCoreSlotHealthProjection(p);

    assert.equal(p.health.length, 0);
    assert.equal(p.networkSnapshots.length, 0);
    assert.equal(p.summaries.length, 1);
    assert.equal(p.failures.length, 1);
    assert.equal(p.cursors.has(`${CORESLOT_HEALTH_PROJECTION}:${CHAIN_ID}`), false);
    assert.equal(p.cursors.has(`coreslot_liveness_summary_v1:${CHAIN_ID}`), true);
  });

  it('active-set vs missing summary: temporal map drives membership; inactive-with-summary not emitted', async () => {
    const p = new MockHealthPrisma();
    // temporal map: slots 1,2,3,4 active at networkLatestHeight
    for (let s = 1; s <= 4; s += 1) p.seedWindow(windowRow({ slot: s }));
    // summaries only for 1,2,3
    for (let s = 1; s <= 3; s += 1) p.seedSummary(summary({ slot: s, windowKind: 'recent_100' }));
    // slot 5 has a summary but NO active window -> must NOT be emitted
    p.seedSummary(summary({ slot: 5, windowKind: 'recent_100' }));

    await projectCoreSlotHealth({ prisma: p, chainId: CHAIN_ID });

    assert.equal(health(p, 4).healthStatus, CORESLOT_HEALTH_STATUS.unknown);
    assert.equal(health(p, 4).healthReason, CORESLOT_HEALTH_REASON.missingSummary);
    assert.equal(health(p, 5), undefined); // inactive slot not emitted
    assert.equal(p.health.length, 4);      // slots 1-4 only
    assert.equal(net(p).haltRiskLevel, NETWORK_HALT_RISK_LEVEL.unknown);
    assert.equal(net(p).haltRiskReason, NETWORK_HALT_RISK_REASON.coverageUnknown);
  });

  it('does not read raw signatures/8a/8b, proposer, API, web, or live RPC', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../src/projections/coreslot-health.ts', import.meta.url)),
      'utf8',
    );
    assert.equal(/blockSignature|operatorSigningEvidence/i.test(src), false);
    assert.equal(/proposer|fetch\(|http/i.test(src), false);
    assert.equal(src.includes('api/'), false);
    assert.equal(/\bweb\b/.test(src), false);
  });
});

// ---- mock + fixtures ----------------------------------------------------------

function seedSlot(p, slot, recentOpts, opts = {}) {
  p.seedWindow(windowRow({ slot, operator: opts.operator, consAddr: opts.consAddr }));
  p.seedSummary(summary({ slot, windowKind: 'recent_100', ...recentOpts }));
}

function summary(o) {
  const expected = o.expected ?? 100;
  const missed = o.missed ?? 0;
  const signed = o.signed ?? (expected - missed);
  const absent = o.absent ?? missed;
  const nil = o.nil ?? 0;
  return {
    id: BigInt(o.id ?? idSeq++),
    slotId: BigInt(o.slot),
    windowKind: o.windowKind ?? 'recent_100',
    lastCommittedHeight: o.last ?? 360n,
    firstCommittedHeight: o.first ?? 261n,
    operatorAddress: o.operator ?? `op${o.slot}`,
    consensusAddress: o.consAddr ?? ADDR(o.slot),
    consensusWindowId: BigInt(o.slot),
    expectedCount: expected,
    signedCount: signed,
    missedCount: missed,
    absentMissedCount: absent,
    nilMissedCount: nil,
    uptimeBps: o.uptimeBps ?? (expected > 0 ? Math.floor((signed * 10000) / expected) : null),
    currentSignedStreak: o.signedStreak ?? (missed === 0 ? expected : 0),
    currentMissedStreak: o.missedStreak ?? 0,
    latestMissedHeight: o.latestMissed ?? (missed > 0 ? 350n : null),
    summaryStatus: o.summaryStatus ?? 'complete',
    invalidHeightCount: o.invalidHeightCount ?? 0,
  };
}

function windowRow(o) {
  return {
    id: BigInt(o.id ?? o.slot),
    slotId: BigInt(o.slot),
    operatorAddress: o.operator ?? `op${o.slot}`,
    consensusAddress: o.consAddr ?? ADDR(o.slot),
    status: 'ACTIVE',
    consensusPower: 1n,
    validatorUpdateHeight: 1n,
    effectiveFromHeight: o.from ?? 1n,
    effectiveToHeight: o.to ?? null,
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

class MockHealthPrisma {
  constructor() {
    this.summaries = [];
    this.windows = [];
    this.health = [];
    this.networkSnapshots = [];
    this.failures = [];
    this.cursors = new Map();

    this.coreSlotLivenessSummary = {
      findMany: async (args) => applyOrdering(this.summaries.filter((r) => match(r, args?.where ?? {})), args?.orderBy),
    };
    this.coreSlotConsensusWindow = {
      findMany: async (args) => applyOrdering(this.windows.filter((r) => match(r, args?.where ?? {})), args?.orderBy),
    };
    this.coreSlotHealthSnapshot = {
      deleteMany: async (args) => {
        const before = this.health.length;
        this.health = args?.where ? this.health.filter((r) => !match(r, args.where)) : [];
        return { count: before - this.health.length };
      },
      createMany: async (args) => {
        const data = Array.isArray(args.data) ? args.data : [args.data];
        for (const row of data) this.health.push({ ...row });
        return { count: data.length };
      },
    };
    this.networkLivenessRiskSnapshot = {
      deleteMany: async () => {
        const count = this.networkSnapshots.length;
        this.networkSnapshots = [];
        return { count };
      },
      create: async (args) => {
        this.networkSnapshots.push({ ...args.data });
        return args.data;
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

  seedSummary(row) {
    this.summaries.push(row);
  }

  seedWindow(row) {
    this.windows.push(row);
  }

  async $transaction(fn) {
    const clone = this.clone();
    const result = await fn(clone);
    this.adopt(clone);
    return result;
  }

  clone() {
    const clone = new MockHealthPrisma();
    clone.summaries = this.summaries.map((r) => ({ ...r }));
    clone.windows = this.windows.map((r) => ({ ...r }));
    clone.health = this.health.map((r) => ({ ...r }));
    clone.networkSnapshots = this.networkSnapshots.map((r) => ({ ...r }));
    clone.failures = this.failures.map((r) => ({ ...r }));
    clone.cursors = new Map([...this.cursors.entries()].map(([k, r]) => [k, { ...r }]));
    return clone;
  }

  adopt(other) {
    this.summaries = other.summaries;
    this.windows = other.windows;
    this.health = other.health;
    this.networkSnapshots = other.networkSnapshots;
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
