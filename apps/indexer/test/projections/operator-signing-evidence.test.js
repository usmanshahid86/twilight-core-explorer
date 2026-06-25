import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  BLOCK_SIGNATURES_PROJECTION,
  OPERATOR_SIGNING_ATTRIBUTION_STATUS,
  OPERATOR_SIGNING_EVIDENCE_PROJECTION,
} from '../../dist/projections/types.js';
import {
  projectOperatorSigningEvidenceHeight,
  projectOperatorSigningEvidenceRange,
} from '../../dist/projections/operator-signing-evidence.js';
import {
  resetOperatorSigningEvidenceProjection,
} from '../../dist/projections/reset-operator-signing-evidence.js';

const CHAIN_ID = 'twilight-test';
const ADDR_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ADDR_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const ADDR_C = 'cccccccccccccccccccccccccccccccccccccccc';
const OPERATOR_A = 'twilight17n30thc6ntha6rpjvk46yrwvkd86guy9crevra';
const OPERATOR_B = 'twilight1jk9lqur0rj4mgn3t0djsqkk2jyc0f2f6h893xk';

describe('Operator signing evidence projection', () => {
  it('attributes an address-bearing signature to the active CoreSlot consensus window', async () => {
    const p = new MockOperatorSigningPrisma();
    p.seedSignature(sig({ sourceBlockHeight: 11n, committedBlockHeight: 10n, address: ADDR_A }));
    p.seedWindow({ id: 7n, slotId: 1n, operatorAddress: OPERATOR_A, consensusAddress: ADDR_A, consensusPower: 42n, from: 5n });

    await projectOperatorSigningEvidenceHeight({ prisma: p, chainId: CHAIN_ID, sourceBlockHeight: 11n });

    assert.equal(p.evidence.length, 1);
    assert.equal(p.evidence[0].attributionStatus, OPERATOR_SIGNING_ATTRIBUTION_STATUS.attributed);
    assert.equal(p.evidence[0].slotId, 1n);
    assert.equal(p.evidence[0].operatorAddress, OPERATOR_A);
    assert.equal(p.evidence[0].consensusPower, 42n);
    assert.equal(p.evidence[0].consensusWindowId, 7n);
  });

  it('uses committedBlockHeight, not sourceBlockHeight, for attribution', async () => {
    const p = new MockOperatorSigningPrisma();
    p.seedSignature(sig({ sourceBlockHeight: 12n, committedBlockHeight: 10n, address: ADDR_A }));
    p.seedWindow({ id: 1n, slotId: 1n, consensusAddress: ADDR_A, from: 5n, to: 11n });

    await projectOperatorSigningEvidenceHeight({ prisma: p, chainId: CHAIN_ID, sourceBlockHeight: 12n });

    assert.equal(p.evidence[0].attributionStatus, OPERATOR_SIGNING_ATTRIBUTION_STATUS.attributed);
  });

  it('respects validatorUpdateHeight + 2 temporal map boundaries already encoded in windows', async () => {
    const p = new MockOperatorSigningPrisma();
    p.seedSignature(sig({ sourceBlockHeight: 102n, committedBlockHeight: 101n, address: ADDR_A }));
    p.seedSignature(sig({ sourceBlockHeight: 103n, committedBlockHeight: 102n, address: ADDR_A }));
    p.seedWindow({ id: 1n, slotId: 1n, operatorAddress: OPERATOR_A, consensusAddress: ADDR_A, from: 50n, to: 102n });
    p.seedWindow({ id: 2n, slotId: 2n, operatorAddress: OPERATOR_B, consensusAddress: ADDR_A, from: 102n });

    await projectOperatorSigningEvidenceRange({ prisma: p, chainId: CHAIN_ID, startHeight: 102n, endHeight: 103n });

    assert.equal(p.evidence.find((row) => row.sourceBlockHeight === 102n).slotId, 1n);
    assert.equal(p.evidence.find((row) => row.sourceBlockHeight === 103n).slotId, 2n);
  });

  it('writes no_consensus_window when no temporal window covers the committed height', async () => {
    const p = new MockOperatorSigningPrisma();
    p.seedSignature(sig({ sourceBlockHeight: 11n, committedBlockHeight: 10n, address: ADDR_A }));

    await projectOperatorSigningEvidenceHeight({ prisma: p, chainId: CHAIN_ID, sourceBlockHeight: 11n });

    assert.equal(p.evidence[0].attributionStatus, OPERATOR_SIGNING_ATTRIBUTION_STATUS.noConsensusWindow);
    assert.equal(p.failures.length, 0);
  });

  it('writes unmapped_validator when temporal coverage exists but not for this address', async () => {
    const p = new MockOperatorSigningPrisma();
    p.seedSignature(sig({ sourceBlockHeight: 11n, committedBlockHeight: 10n, address: ADDR_A }));
    p.seedWindow({ id: 2n, slotId: 2n, consensusAddress: ADDR_B, from: 5n });

    await projectOperatorSigningEvidenceHeight({ prisma: p, chainId: CHAIN_ID, sourceBlockHeight: 11n });

    assert.equal(p.evidence[0].attributionStatus, OPERATOR_SIGNING_ATTRIBUTION_STATUS.unmappedValidator);
    assert.equal(p.failures.length, 0);
  });

  it('writes absent_no_validator for absent commit entries without creating invalid failures', async () => {
    const p = new MockOperatorSigningPrisma();
    p.seedSignature(sig({
      sourceBlockHeight: 11n,
      committedBlockHeight: 10n,
      address: null,
      blockIdFlagCode: 1,
      signed: false,
    }));

    await projectOperatorSigningEvidenceHeight({ prisma: p, chainId: CHAIN_ID, sourceBlockHeight: 11n });

    assert.equal(p.evidence[0].attributionStatus, OPERATOR_SIGNING_ATTRIBUTION_STATUS.absentNoValidator);
    assert.equal(p.evidence[0].rawSignatureJson.kind, 'raw');
    assert.equal(p.failures.length, 0);
  });

  it('keeps invalid validator-address evidence distinct from ordinary absent rows', async () => {
    const p = new MockOperatorSigningPrisma();
    p.seedSignature(sig({
      sourceBlockHeight: 11n,
      committedBlockHeight: 10n,
      address: null,
      blockIdFlagCode: 2,
    }));
    p.failures.push({
      projectionName: BLOCK_SIGNATURES_PROJECTION,
      sourceHeight: 11n,
      failureKind: 'invalid_validator_address',
      resolved: false,
    });

    await projectOperatorSigningEvidenceHeight({ prisma: p, chainId: CHAIN_ID, sourceBlockHeight: 11n });

    assert.equal(p.evidence[0].attributionStatus, OPERATOR_SIGNING_ATTRIBUTION_STATUS.invalidValidatorAddress);
    assert.equal(failureKinds(p).filter((kind) => kind === 'invalid_validator_address').length, 1);
  });

  it('uses historical window fields instead of current CoreSlot snapshot rows', async () => {
    const p = new MockOperatorSigningPrisma();
    p.currentCoreSlotProjection = {
      slotId: 1n,
      operatorAddress: OPERATOR_B,
      consensusPower: 999n,
    };
    p.seedSignature(sig({ sourceBlockHeight: 11n, committedBlockHeight: 10n, address: ADDR_A }));
    p.seedWindow({ id: 3n, slotId: 1n, operatorAddress: OPERATOR_A, consensusAddress: ADDR_A, consensusPower: 4n, from: 5n });

    await projectOperatorSigningEvidenceHeight({ prisma: p, chainId: CHAIN_ID, sourceBlockHeight: 11n });

    assert.equal(p.evidence[0].operatorAddress, OPERATOR_A);
    assert.equal(p.evidence[0].consensusPower, 4n);
  });

  it('rerunning projection refreshes attribution rows instead of leaving stale no-window status', async () => {
    const p = new MockOperatorSigningPrisma();
    p.seedSignature(sig({ sourceBlockHeight: 11n, committedBlockHeight: 10n, address: ADDR_A }));
    await projectOperatorSigningEvidenceRange({ prisma: p, chainId: CHAIN_ID, startHeight: 11n, endHeight: 11n });
    assert.equal(p.evidence[0].attributionStatus, OPERATOR_SIGNING_ATTRIBUTION_STATUS.noConsensusWindow);

    p.seedWindow({ id: 9n, slotId: 9n, consensusAddress: ADDR_A, from: 5n });
    await projectOperatorSigningEvidenceRange({ prisma: p, chainId: CHAIN_ID, startHeight: 11n, endHeight: 11n });

    assert.equal(p.evidence.length, 1);
    assert.equal(p.evidence[0].attributionStatus, OPERATOR_SIGNING_ATTRIBUTION_STATUS.attributed);
    assert.equal(p.evidence[0].slotId, 9n);
  });

  it('reset deletes only operator signing evidence rows and preserves upstream projections', async () => {
    const p = new MockOperatorSigningPrisma();
    p.evidence.push({ signatureKey: 's' });
    p.signatures.push(sig({ signatureKey: 's' }));
    p.windows.push(windowRow({ id: 1n, consensusAddress: ADDR_A }));
    p.rewardsRows.push({ id: 1 });
    p.failures.push({ projectionName: OPERATOR_SIGNING_EVIDENCE_PROJECTION });
    p.failures.push({ projectionName: 'block_signatures_v1' });
    p.cursors.set(`${OPERATOR_SIGNING_EVIDENCE_PROJECTION}:${CHAIN_ID}`, { projectionName: OPERATOR_SIGNING_EVIDENCE_PROJECTION });
    p.cursors.set(`block_signatures_v1:${CHAIN_ID}`, { projectionName: 'block_signatures_v1' });

    await resetOperatorSigningEvidenceProjection(p);

    assert.equal(p.evidence.length, 0);
    assert.equal(p.signatures.length, 1);
    assert.equal(p.windows.length, 1);
    assert.equal(p.rewardsRows.length, 1);
    assert.equal(p.failures.length, 1);
    assert.equal(p.cursors.has(`${OPERATOR_SIGNING_EVIDENCE_PROJECTION}:${CHAIN_ID}`), false);
    assert.equal(p.cursors.has(`block_signatures_v1:${CHAIN_ID}`), true);
  });

  it('does not implement liveness percentages, missed counts, proposer enrichment, API, or web work', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../src/projections/operator-signing-evidence.ts', import.meta.url)),
      'utf8',
    );
    assert.equal(/uptime|liveness|missed|proposer/i.test(src), false);
    assert.equal(src.includes('api/'), false);
    assert.equal(src.includes('web'), false);
  });
});

class MockOperatorSigningPrisma {
  constructor() {
    this.signatures = [];
    this.evidence = [];
    this.windows = [];
    this.failures = [];
    this.cursors = new Map();
    this.rewardsRows = [];
    this.currentCoreSlotProjection = null;

    this.blockSignature = {
      findMany: async (args) => applyOrdering(
        this.signatures.filter((row) => match(row, args?.where ?? {})),
        args?.orderBy,
      ),
    };
    this.coreSlotConsensusWindow = {
      findFirst: async (args) =>
        applyOrdering(this.windows.filter((row) => match(row, args?.where ?? {})), args?.orderBy)[0]
          ?? null,
      findMany: async (args) =>
        applyOrdering(this.windows.filter((row) => match(row, args?.where ?? {})), args?.orderBy),
      create: async (args) => {
        this.windows.push(args.data);
        return args.data;
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
      count: async (args) =>
        this.windows.filter((row) => match(row, args?.where ?? {})).length,
    };
    this.operatorSigningEvidence = {
      upsert: async (args) => {
        const key = args.where.signatureKey;
        const index = this.evidence.findIndex((row) => row.signatureKey === key);
        const next = index >= 0
          ? { ...this.evidence[index], ...args.update }
          : { ...args.create };
        if (index >= 0) this.evidence[index] = next;
        else this.evidence.push(next);
        return next;
      },
      deleteMany: async () => {
        const count = this.evidence.length;
        this.evidence = [];
        return { count };
      },
    };
    this.projectionFailure = {
      findFirst: async (args) =>
        this.failures.find((row) => match(row, args?.where ?? {})) ?? null,
      upsert: async (args) => {
        const key = args.where.failureKey;
        const index = this.failures.findIndex((row) => row.failureKey === key);
        const next = index >= 0
          ? { ...this.failures[index], ...args.update }
          : { ...args.create };
        if (index >= 0) this.failures[index] = next;
        else this.failures.push(next);
        return next;
      },
      deleteMany: async (args) => {
        const before = this.failures.length;
        this.failures = this.failures.filter((row) => !match(row, args?.where ?? {}));
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

  seedSignature(row) {
    this.signatures.push(row);
  }

  seedWindow(input) {
    this.windows.push(windowRow(input));
  }

  async $transaction(fn) {
    const clone = this.clone();
    const result = await fn(clone);
    this.adopt(clone);
    return result;
  }

  clone() {
    const clone = new MockOperatorSigningPrisma();
    clone.signatures = this.signatures.map((row) => ({ ...row }));
    clone.evidence = this.evidence.map((row) => ({ ...row }));
    clone.windows = this.windows.map((row) => ({ ...row }));
    clone.failures = this.failures.map((row) => ({ ...row }));
    clone.cursors = new Map([...this.cursors.entries()].map(([key, row]) => [key, { ...row }]));
    clone.rewardsRows = this.rewardsRows.map((row) => ({ ...row }));
    clone.currentCoreSlotProjection = this.currentCoreSlotProjection
      ? { ...this.currentCoreSlotProjection }
      : null;
    return clone;
  }

  adopt(other) {
    this.signatures = other.signatures;
    this.evidence = other.evidence;
    this.windows = other.windows;
    this.failures = other.failures;
    this.cursors = other.cursors;
    this.rewardsRows = other.rewardsRows;
    this.currentCoreSlotProjection = other.currentCoreSlotProjection;
  }
}

function sig(overrides = {}) {
  const sourceBlockHeight = overrides.sourceBlockHeight ?? 11n;
  const committedBlockHeight = overrides.committedBlockHeight ?? sourceBlockHeight - 1n;
  const signatureIndex = overrides.signatureIndex ?? 0;
  const address = overrides.address === undefined ? ADDR_A : overrides.address;
  return {
    signatureKey: overrides.signatureKey
      ?? `${sourceBlockHeight}:${committedBlockHeight}:${signatureIndex}:${address ?? ''}`,
    sourceBlockHeight,
    committedBlockHeight,
    signatureIndex,
    validatorAddress: address,
    blockIdFlag: String(overrides.blockIdFlagCode ?? 2),
    blockIdFlagCode: overrides.blockIdFlagCode ?? 2,
    signed: overrides.signed ?? true,
    rawSignatureJson: overrides.rawSignatureJson ?? { kind: 'raw', validator_address: address },
  };
}

function windowRow(input) {
  return {
    id: input.id ?? 1n,
    slotId: input.slotId ?? 1n,
    operatorAddress: input.operatorAddress ?? OPERATOR_A,
    consensusAddress: input.consensusAddress ?? ADDR_A,
    status: 'ACTIVE',
    consensusPower: input.consensusPower ?? 1n,
    validatorUpdateHeight: input.validatorUpdateHeight ?? input.from ?? 1n,
    effectiveFromHeight: input.from ?? 1n,
    effectiveToHeight: input.to ?? null,
    openedByKind: 'lifecycle',
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
  return p.failures.map((failure) => failure.failureKind).filter(Boolean).sort();
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
