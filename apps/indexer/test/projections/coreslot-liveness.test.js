import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  CORESLOT_LIVENESS_PROJECTION,
  CORESLOT_LIVENESS_MISS_CAUSE,
  CORESLOT_LIVENESS_STATUS,
  OPERATOR_SIGNING_ATTRIBUTION_STATUS,
} from '../../dist/projections/types.js';
import {
  projectCoreSlotLivenessHeight,
  projectCoreSlotLivenessRange,
} from '../../dist/projections/coreslot-liveness.js';
import { resetCoreSlotLivenessProjection } from '../../dist/projections/reset-coreslot-liveness.js';

const CHAIN_ID = 'twilight-test';
const ADDR = (n) => String(n).repeat(40).slice(0, 40);

describe('CoreSlot liveness projection (8c-1)', () => {
  it('full signed height -> 4 signed, 0 missed', async () => {
    const p = withFourActiveSlots();
    for (let slot = 1; slot <= 4; slot += 1) {
      p.seedEvidence(signedRow({ slot, source: 11n, committed: 10n }));
    }

    await projectCoreSlotLivenessHeight({ prisma: p, chainId: CHAIN_ID, sourceBlockHeight: 11n });

    assert.equal(p.liveness.length, 4);
    assert.equal(p.liveness.filter((r) => r.status === CORESLOT_LIVENESS_STATUS.signed).length, 4);
    assert.equal(p.liveness.filter((r) => r.status === CORESLOT_LIVENESS_STATUS.missed).length, 0);
    assert.equal(p.failures.length, 0);
  });

  it('one anonymous absent -> the expected-but-unsigned slot is missed with cause=absent', async () => {
    const p = withFourActiveSlots();
    p.seedEvidence(signedRow({ slot: 1, source: 11n, committed: 10n }));
    p.seedEvidence(signedRow({ slot: 2, source: 11n, committed: 10n }));
    p.seedEvidence(signedRow({ slot: 3, source: 11n, committed: 10n }));
    p.seedEvidence(absentRow({ source: 11n, committed: 10n }));

    await projectCoreSlotLivenessHeight({ prisma: p, chainId: CHAIN_ID, sourceBlockHeight: 11n });

    const missed = p.liveness.filter((r) => r.status === CORESLOT_LIVENESS_STATUS.missed);
    assert.equal(missed.length, 1);
    assert.equal(missed[0].slotId, 4n);
    assert.equal(missed[0].missCause, CORESLOT_LIVENESS_MISS_CAUSE.absent);
    assert.equal(missed[0].sourceBlockHeight, null);
    assert.equal(missed[0].observedSignatureKey, null);
    assert.equal(p.failures.length, 0);
  });

  it('nil vote -> missed with cause=nil and preserved observed provenance', async () => {
    const p = withFourActiveSlots();
    p.seedEvidence(signedRow({ slot: 1, source: 11n, committed: 10n }));
    p.seedEvidence(signedRow({ slot: 2, source: 11n, committed: 10n }));
    p.seedEvidence(signedRow({ slot: 3, source: 11n, committed: 10n }));
    p.seedEvidence(nilRow({ slot: 4, source: 11n, committed: 10n }));

    await projectCoreSlotLivenessHeight({ prisma: p, chainId: CHAIN_ID, sourceBlockHeight: 11n });

    const slot4 = p.liveness.find((r) => r.slotId === 4n);
    assert.equal(slot4.status, CORESLOT_LIVENESS_STATUS.missed);
    assert.equal(slot4.missCause, CORESLOT_LIVENESS_MISS_CAUSE.nil);
    assert.equal(slot4.sourceBlockHeight, null);
    assert.equal(slot4.observedBlockIdFlagCode, 3);
    assert.equal(slot4.observedSigned, false);
    assert.equal(p.failures.length, 0);
  });

  it('absent count mismatch -> ProjectionFailure, no rows written', async () => {
    const p = withFourActiveSlots();
    p.seedEvidence(signedRow({ slot: 1, source: 11n, committed: 10n }));
    p.seedEvidence(signedRow({ slot: 2, source: 11n, committed: 10n }));
    p.seedEvidence(signedRow({ slot: 3, source: 11n, committed: 10n }));
    // slot 4 expected but neither signed nor nil, and NO anonymous absent entry exists.

    await projectCoreSlotLivenessHeight({ prisma: p, chainId: CHAIN_ID, sourceBlockHeight: 11n });

    assert.equal(p.liveness.length, 0);
    assert.equal(failureKinds(p).includes('liveness_absent_count_mismatch'), true);
  });

  it('duplicate expected window for a slot -> ProjectionFailure', async () => {
    const p = new MockLivenessPrisma();
    p.seedWindow({ id: 1n, slotId: 1n, consensusAddress: ADDR(1), from: 1n });
    p.seedWindow({ id: 2n, slotId: 1n, consensusAddress: ADDR(1), from: 1n });
    p.seedEvidence(signedRow({ slot: 1, source: 11n, committed: 10n }));

    await projectCoreSlotLivenessHeight({ prisma: p, chainId: CHAIN_ID, sourceBlockHeight: 11n });

    assert.equal(p.liveness.length, 0);
    assert.equal(failureKinds(p).includes('duplicate_expected_slot_at_height'), true);
  });

  it('duplicate observed signed row for a slot -> ProjectionFailure', async () => {
    const p = new MockLivenessPrisma();
    p.seedWindow({ id: 1n, slotId: 1n, consensusAddress: ADDR(1), from: 1n });
    p.seedEvidence(signedRow({ slot: 1, source: 11n, committed: 10n, index: 0 }));
    p.seedEvidence(signedRow({ slot: 1, source: 11n, committed: 10n, index: 1 }));

    await projectCoreSlotLivenessHeight({ prisma: p, chainId: CHAIN_ID, sourceBlockHeight: 11n });

    assert.equal(p.liveness.length, 0);
    assert.equal(failureKinds(p).includes('duplicate_observed_signed_slot_at_height'), true);
  });

  it('nil and signed for the same slot/height -> ProjectionFailure', async () => {
    const p = new MockLivenessPrisma();
    p.seedWindow({ id: 1n, slotId: 1n, consensusAddress: ADDR(1), from: 1n });
    p.seedEvidence(signedRow({ slot: 1, source: 11n, committed: 10n, index: 0 }));
    p.seedEvidence(nilRow({ slot: 1, source: 11n, committed: 10n, index: 1 }));

    await projectCoreSlotLivenessHeight({ prisma: p, chainId: CHAIN_ID, sourceBlockHeight: 11n });

    assert.equal(p.liveness.length, 0);
    assert.equal(failureKinds(p).includes('nil_and_signed_same_slot_height'), true);
  });

  it('attributed observed slot not in expected set -> ProjectionFailure', async () => {
    const p = new MockLivenessPrisma();
    p.seedWindow({ id: 1n, slotId: 1n, consensusAddress: ADDR(1), from: 1n });
    p.seedEvidence(signedRow({ slot: 1, source: 11n, committed: 10n }));
    p.seedEvidence(signedRow({ slot: 9, source: 11n, committed: 10n })); // slot 9 not expected

    await projectCoreSlotLivenessHeight({ prisma: p, chainId: CHAIN_ID, sourceBlockHeight: 11n });

    assert.equal(p.liveness.length, 0);
    assert.equal(failureKinds(p).includes('observed_attributed_slot_not_expected'), true);
  });

  it('non-CoreSlot (unmapped_validator) rows are ignored, not counted as expected or missed', async () => {
    const p = new MockLivenessPrisma();
    p.seedWindow({ id: 1n, slotId: 1n, consensusAddress: ADDR(1), from: 1n });
    p.seedEvidence(signedRow({ slot: 1, source: 11n, committed: 10n }));
    p.seedEvidence({
      ...absentRow({ source: 11n, committed: 10n }),
      attributionStatus: OPERATOR_SIGNING_ATTRIBUTION_STATUS.unmappedValidator,
      blockIdFlagCode: 2,
      signed: true,
      validatorAddress: ADDR(7),
    });

    await projectCoreSlotLivenessHeight({ prisma: p, chainId: CHAIN_ID, sourceBlockHeight: 11n });

    assert.equal(p.liveness.length, 1);
    assert.equal(p.liveness[0].status, CORESLOT_LIVENESS_STATUS.signed);
    assert.equal(p.failures.length, 0);
  });

  it('empty expected set with no observations -> no rows, no failure', async () => {
    const p = new MockLivenessPrisma();
    // an out-of-scope row (no window coverage) so the height is processed at all
    p.seedEvidence({
      ...absentRow({ source: 11n, committed: 10n }),
      attributionStatus: OPERATOR_SIGNING_ATTRIBUTION_STATUS.noConsensusWindow,
      blockIdFlagCode: 2,
      signed: true,
    });

    await projectCoreSlotLivenessHeight({ prisma: p, chainId: CHAIN_ID, sourceBlockHeight: 11n });

    assert.equal(p.liveness.length, 0);
    assert.equal(p.failures.length, 0);
  });

  it('uses committedBlockHeight (not sourceBlockHeight) as the evidence grain', async () => {
    const p = new MockLivenessPrisma();
    p.seedWindow({ id: 1n, slotId: 1n, consensusAddress: ADDR(1), from: 1n });
    p.seedEvidence(signedRow({ slot: 1, source: 12n, committed: 10n }));

    await projectCoreSlotLivenessHeight({ prisma: p, chainId: CHAIN_ID, sourceBlockHeight: 12n });

    assert.equal(p.liveness.length, 1);
    assert.equal(p.liveness[0].committedBlockHeight, 10n);
    assert.equal(p.liveness[0].sourceBlockHeight, 12n); // signed rows carry observed source
    assert.equal(p.liveness[0].evidenceKey, `${CORESLOT_LIVENESS_PROJECTION}:10:1`);
  });

  it('rerun is idempotent and refreshes when upstream attribution changes', async () => {
    const p = withFourActiveSlots();
    p.seedEvidence(signedRow({ slot: 1, source: 11n, committed: 10n }));
    p.seedEvidence(signedRow({ slot: 2, source: 11n, committed: 10n }));
    p.seedEvidence(signedRow({ slot: 3, source: 11n, committed: 10n }));
    p.seedEvidence(absentRow({ source: 11n, committed: 10n }));

    await projectCoreSlotLivenessRange({ prisma: p, chainId: CHAIN_ID, startHeight: 11n, endHeight: 11n });
    assert.equal(p.liveness.length, 4);
    assert.equal(p.liveness.find((r) => r.slotId === 4n).status, CORESLOT_LIVENESS_STATUS.missed);

    // upstream now shows slot 4 signing; drop the anonymous absent, add slot 4 signed.
    p.evidence = p.evidence.filter((r) => r.attributionStatus === OPERATOR_SIGNING_ATTRIBUTION_STATUS.attributed);
    p.seedEvidence(signedRow({ slot: 4, source: 11n, committed: 10n }));

    await projectCoreSlotLivenessRange({ prisma: p, chainId: CHAIN_ID, startHeight: 11n, endHeight: 11n });

    assert.equal(p.liveness.length, 4); // no duplicates
    assert.equal(p.liveness.find((r) => r.slotId === 4n).status, CORESLOT_LIVENESS_STATUS.signed);
  });

  it('hard failure invalidates a previously-projected height: rows deleted, other heights intact', async () => {
    const p = withFourActiveSlots();
    // height A (committed 10) and height B (committed 20), both clean.
    for (let slot = 1; slot <= 4; slot += 1) p.seedEvidence(signedRow({ slot, source: 11n, committed: 10n }));
    for (let slot = 1; slot <= 4; slot += 1) p.seedEvidence(signedRow({ slot, source: 21n, committed: 20n }));

    await projectCoreSlotLivenessRange({ prisma: p, chainId: CHAIN_ID, startHeight: 11n, endHeight: 21n });
    assert.equal(p.liveness.length, 8);
    assert.equal(p.liveness.filter((r) => r.committedBlockHeight === 20n).length, 4);

    // height B now becomes invalid (duplicate attributed commit row for slot 1).
    p.seedEvidence(signedRow({ slot: 1, source: 21n, committed: 20n, index: 5 }));
    await projectCoreSlotLivenessHeight({ prisma: p, chainId: CHAIN_ID, sourceBlockHeight: 21n });

    assert.equal(failureKinds(p).includes('duplicate_observed_signed_slot_at_height'), true);
    assert.equal(p.liveness.filter((r) => r.committedBlockHeight === 20n).length, 0); // H invalidated
    assert.equal(p.liveness.filter((r) => r.committedBlockHeight === 10n).length, 4); // other height intact
    assert.equal(p.liveness.length, 4); // no partial replacement rows written
  });

  it('range projection advances the cursor on the sourceBlockHeight axis', async () => {
    const p = withFourActiveSlots();
    for (let slot = 1; slot <= 4; slot += 1) p.seedEvidence(signedRow({ slot, source: 11n, committed: 10n }));

    await projectCoreSlotLivenessRange({ prisma: p, chainId: CHAIN_ID, startHeight: 11n, endHeight: 11n });

    const cursor = p.cursors.get(`${CORESLOT_LIVENESS_PROJECTION}:${CHAIN_ID}`);
    assert.equal(cursor.lastProjectedHeight, 11n);
  });

  it('reset clears only coreslot_liveness_v1 state and preserves upstream rows', async () => {
    const p = new MockLivenessPrisma();
    p.liveness.push({ evidenceKey: 'k' });
    p.evidence.push(signedRow({ slot: 1, source: 11n, committed: 10n }));
    p.windows.push(windowRow({ id: 1n, consensusAddress: ADDR(1) }));
    p.failures.push({ projectionName: CORESLOT_LIVENESS_PROJECTION });
    p.failures.push({ projectionName: 'operator_signing_evidence_v1' });
    p.cursors.set(`${CORESLOT_LIVENESS_PROJECTION}:${CHAIN_ID}`, { projectionName: CORESLOT_LIVENESS_PROJECTION });
    p.cursors.set(`operator_signing_evidence_v1:${CHAIN_ID}`, { projectionName: 'operator_signing_evidence_v1' });

    await resetCoreSlotLivenessProjection(p);

    assert.equal(p.liveness.length, 0);
    assert.equal(p.evidence.length, 1);
    assert.equal(p.windows.length, 1);
    assert.equal(p.failures.length, 1);
    assert.equal(p.cursors.has(`${CORESLOT_LIVENESS_PROJECTION}:${CHAIN_ID}`), false);
    assert.equal(p.cursors.has(`operator_signing_evidence_v1:${CHAIN_ID}`), true);
  });

  it('does not implement uptime percentages, rolling summaries, current health, proposer, API, or web', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../src/projections/coreslot-liveness.ts', import.meta.url)),
      'utf8',
    );
    assert.equal(/uptime|percent|rolling|proposer|current[_ ]?health/i.test(src), false);
    assert.equal(src.includes('api/'), false);
    assert.equal(/\bweb\b/.test(src), false);
  });
});

// ---- mock + fixtures ----------------------------------------------------------

function withFourActiveSlots() {
  const p = new MockLivenessPrisma();
  for (let slot = 1; slot <= 4; slot += 1) {
    p.seedWindow({ id: BigInt(slot), slotId: BigInt(slot), consensusAddress: ADDR(slot), operatorAddress: `op${slot}`, consensusPower: 1n, from: 1n });
  }
  return p;
}

function signedRow({ slot, source, committed, index = 0 }) {
  return evidenceRow({ slot, source, committed, index, status: OPERATOR_SIGNING_ATTRIBUTION_STATUS.attributed, flag: 2, signed: true });
}

function nilRow({ slot, source, committed, index = 0 }) {
  return evidenceRow({ slot, source, committed, index, status: OPERATOR_SIGNING_ATTRIBUTION_STATUS.attributed, flag: 3, signed: false });
}

function absentRow({ source, committed, index = 9 }) {
  return {
    signatureKey: `${source}:${committed}:${index}:absent`,
    sourceBlockHeight: source,
    committedBlockHeight: committed,
    signatureIndex: index,
    slotId: null,
    operatorAddress: null,
    consensusPower: null,
    consensusWindowId: null,
    attributionStatus: OPERATOR_SIGNING_ATTRIBUTION_STATUS.absentNoValidator,
    blockIdFlag: '1',
    blockIdFlagCode: 1,
    signed: false,
  };
}

function evidenceRow({ slot, source, committed, index, status, flag, signed }) {
  return {
    signatureKey: `${source}:${committed}:${index}:slot${slot}`,
    sourceBlockHeight: source,
    committedBlockHeight: committed,
    signatureIndex: index,
    slotId: BigInt(slot),
    operatorAddress: `op${slot}`,
    consensusPower: 1n,
    consensusWindowId: BigInt(slot),
    attributionStatus: status,
    blockIdFlag: String(flag),
    blockIdFlagCode: flag,
    signed,
  };
}

function windowRow(input) {
  return {
    id: input.id ?? 1n,
    slotId: input.slotId ?? 1n,
    operatorAddress: input.operatorAddress ?? 'op1',
    consensusAddress: input.consensusAddress ?? ADDR(1),
    status: 'ACTIVE',
    consensusPower: input.consensusPower ?? 1n,
    validatorUpdateHeight: input.validatorUpdateHeight ?? input.from ?? 1n,
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

function failureKinds(p) {
  return p.failures.map((f) => f.failureKind).filter(Boolean);
}

class MockLivenessPrisma {
  constructor() {
    this.evidence = [];
    this.windows = [];
    this.liveness = [];
    this.failures = [];
    this.cursors = new Map();

    this.operatorSigningEvidence = {
      findMany: async (args) => {
        let rows = applyOrdering(this.evidence.filter((r) => match(r, args?.where ?? {})), args?.orderBy);
        if (args?.distinct) rows = distinctBy(rows, args.distinct);
        return rows;
      },
      aggregate: async () => ({
        _max: { sourceBlockHeight: this.evidence.reduce((m, r) => (r.sourceBlockHeight > m ? r.sourceBlockHeight : m), 0n) },
      }),
    };
    this.coreSlotConsensusWindow = {
      findMany: async (args) => applyOrdering(this.windows.filter((r) => match(r, args?.where ?? {})), args?.orderBy),
    };
    this.coreSlotLivenessEvidence = {
      deleteMany: async (args) => {
        const before = this.liveness.length;
        this.liveness = args?.where
          ? this.liveness.filter((r) => !match(r, args.where))
          : [];
        return { count: before - this.liveness.length };
      },
      createMany: async (args) => {
        const data = Array.isArray(args.data) ? args.data : [args.data];
        for (const row of data) this.liveness.push({ ...row });
        return { count: data.length };
      },
    };
    this.projectionFailure = {
      findFirst: async (args) => this.failures.find((r) => match(r, args?.where ?? {})) ?? null,
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

  seedWindow(input) {
    this.windows.push(windowRow(input));
  }

  seedEvidence(row) {
    this.evidence.push(row);
  }

  async $transaction(fn) {
    const clone = this.clone();
    const result = await fn(clone);
    this.adopt(clone);
    return result;
  }

  clone() {
    const clone = new MockLivenessPrisma();
    clone.evidence = this.evidence.map((r) => ({ ...r }));
    clone.windows = this.windows.map((r) => ({ ...r }));
    clone.liveness = this.liveness.map((r) => ({ ...r }));
    clone.failures = this.failures.map((r) => ({ ...r }));
    clone.cursors = new Map([...this.cursors.entries()].map(([k, r]) => [k, { ...r }]));
    return clone;
  }

  adopt(other) {
    this.evidence = other.evidence;
    this.windows = other.windows;
    this.liveness = other.liveness;
    this.failures = other.failures;
    this.cursors = other.cursors;
  }
}

function distinctBy(rows, fields) {
  const keys = Array.isArray(fields) ? fields : [fields];
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const k = keys.map((f) => String(row[f])).join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
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
