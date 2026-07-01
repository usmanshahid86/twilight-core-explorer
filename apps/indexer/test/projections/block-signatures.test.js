import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  BLOCK_SIGNATURES_PROJECTION,
} from '../../dist/projections/types.js';
import {
  extractCommitSignatures,
  extractLastCommit,
  makeSignatureKey,
  normalizeConsensusAddress,
  parseBlockIdFlag,
  projectBlockSignaturesHeight,
  projectBlockSignaturesRange,
} from '../../dist/projections/block-signatures.js';
import { resetBlockSignaturesProjection } from '../../dist/projections/reset-block-signatures.js';

const CHAIN_ID = 'twilight-test';
const ADDR_A = 'A071AC8728912DAB4405B9E7E106294CB27F0B15';
const ADDR_B = 'AFF2293E38E4F3D308B9601B74829DAEF1E98B1A';
const ADDR_C = 'F060BF2347C76488A0390285E3B9EF3A44EC7D23';

describe('Block signature projection', () => {
  it('extracts signatures from Block.rawJson.result.block.last_commit.signatures', () => {
    const raw = rawBlock({ sourceHeight: 119n, committedHeight: 118n });
    const lastCommit = extractLastCommit(raw);
    assert.equal(lastCommit?.height, 118n);
    assert.equal(extractCommitSignatures(raw).length, 3);
  });

  it('stores source and committed heights from last_commit.height', async () => {
    const p = new MockBlockSignaturesPrisma();
    p.seedBlock(119n, rawBlock({ sourceHeight: 119n, committedHeight: 118n }));
    await projectBlockSignaturesHeight({ prisma: p, chainId: CHAIN_ID, height: 119n });
    assert.equal(p.signatures.length, 3);
    assert.equal(p.signatures[0].sourceBlockHeight, 119n);
    assert.equal(p.signatures[0].committedBlockHeight, 118n);
    assert.equal(p.cursors.get(`${BLOCK_SIGNATURES_PROJECTION}:${CHAIN_ID}`).lastProjectedHeight, 119n);
  });

  it('falls back to sourceBlockHeight - 1 only when last_commit.height is absent', async () => {
    const p = new MockBlockSignaturesPrisma();
    const raw = rawBlock({ sourceHeight: 120n, committedHeight: undefined });
    delete raw.result.block.last_commit.height;
    p.seedBlock(120n, raw);
    await projectBlockSignaturesHeight({ prisma: p, chainId: CHAIN_ID, height: 120n });
    assert.equal(p.signatures[0].committedBlockHeight, 119n);
  });

  it('normalizes validator_address to lowercase 40-character hex', async () => {
    const p = new MockBlockSignaturesPrisma();
    p.seedBlock(119n, rawBlock({ sourceHeight: 119n, committedHeight: 118n }));
    await projectBlockSignaturesHeight({ prisma: p, chainId: CHAIN_ID, height: 119n });
    assert.equal(p.signatures[0].validatorAddress, ADDR_A.toLowerCase());
    assert.equal(normalizeConsensusAddress(ADDR_A).value, ADDR_A.toLowerCase());
  });

  it('stores block_id_flag raw and numeric code and preserves absent/commit/nil distinction', async () => {
    const p = new MockBlockSignaturesPrisma();
    p.seedBlock(119n, rawBlock({ sourceHeight: 119n, committedHeight: 118n }));
    await projectBlockSignaturesHeight({ prisma: p, chainId: CHAIN_ID, height: 119n });
    assert.deepEqual(p.signatures.map((s) => s.blockIdFlagCode), [2, 1, 3]);
    assert.deepEqual(p.signatures.map((s) => s.blockIdFlag), ['2', '1', '3']);
  });

  it('signed=true only for commit/signed flag', async () => {
    assert.equal(parseBlockIdFlag(1).signed, false);
    assert.equal(parseBlockIdFlag(2).signed, true);
    assert.equal(parseBlockIdFlag(3).signed, false);
    assert.equal(parseBlockIdFlag('BLOCK_ID_FLAG_COMMIT').signed, true);
  });

  it('preserves rawSignatureJson and signature data', async () => {
    const p = new MockBlockSignaturesPrisma();
    p.seedBlock(119n, rawBlock({ sourceHeight: 119n, committedHeight: 118n }));
    await projectBlockSignaturesHeight({ prisma: p, chainId: CHAIN_ID, height: 119n });
    assert.equal(p.signatures[0].signature, 'SIG-A');
    assert.equal(p.signatures[0].rawSignatureJson.validator_address, ADDR_A);
    assert.ok(p.signatures[0].timestamp instanceof Date);
  });

  it('rerunning the same range is idempotent', async () => {
    const p = new MockBlockSignaturesPrisma();
    p.seedBlock(119n, rawBlock({ sourceHeight: 119n, committedHeight: 118n }));
    await projectBlockSignaturesRange({ prisma: p, chainId: CHAIN_ID, startHeight: 119n, endHeight: 119n });
    await projectBlockSignaturesRange({ prisma: p, chainId: CHAIN_ID, startHeight: 119n, endHeight: 119n });
    assert.equal(p.signatures.length, 3);
  });

  it('range projection iterates indexed blocks only and advances cursor to requested end', async () => {
    const p = new MockBlockSignaturesPrisma();
    p.seedBlock(119n, rawBlock({ sourceHeight: 119n, committedHeight: 118n }));
    p.seedBlock(121n, rawBlock({ sourceHeight: 121n, committedHeight: 120n }));
    await projectBlockSignaturesRange({ prisma: p, chainId: CHAIN_ID, startHeight: 119n, endHeight: 125n });
    assert.equal(p.signatures.length, 6);
    assert.equal(p.failures.length, 0);
    assert.equal(
      p.cursors.get(`${BLOCK_SIGNATURES_PROJECTION}:${CHAIN_ID}`).lastProjectedHeight,
      125n,
    );
  });

  it('sourceBlockHeight <= 1 missing last_commit is skipped without failure', async () => {
    const p = new MockBlockSignaturesPrisma();
    p.seedBlock(1n, { result: { block: { header: { height: '1' } } } });
    await projectBlockSignaturesHeight({ prisma: p, chainId: CHAIN_ID, height: 1n });
    assert.equal(p.signatures.length, 0);
    assert.equal(p.failures.length, 0);
  });

  it('non-genesis missing last_commit records missing_last_commit failure', async () => {
    const p = new MockBlockSignaturesPrisma();
    p.seedBlock(119n, { result: { block: { header: { height: '119' } } } });
    await projectBlockSignaturesHeight({ prisma: p, chainId: CHAIN_ID, height: 119n });
    assert.deepEqual(failureKinds(p), ['missing_last_commit']);
  });

  it('missing signatures records missing_signatures failure', async () => {
    const p = new MockBlockSignaturesPrisma();
    p.seedBlock(119n, { result: { block: { last_commit: { height: '118' } } } });
    await projectBlockSignaturesHeight({ prisma: p, chainId: CHAIN_ID, height: 119n });
    assert.deepEqual(failureKinds(p), ['missing_signatures']);
  });

  it('malformed signature records deterministic invalid_signature_payload failure', async () => {
    const p = new MockBlockSignaturesPrisma();
    p.seedBlock(119n, {
      result: { block: { last_commit: { height: '118', signatures: ['bad'] } } },
    });
    await projectBlockSignaturesHeight({ prisma: p, chainId: CHAIN_ID, height: 119n });
    await projectBlockSignaturesHeight({ prisma: p, chainId: CHAIN_ID, height: 119n });
    assert.equal(p.signatures.length, 0);
    assert.deepEqual(failureKinds(p), ['invalid_signature_payload']);
  });

  it('invalid validator address preserves row and records invalid_validator_address failure', async () => {
    const p = new MockBlockSignaturesPrisma();
    p.seedBlock(119n, {
      result: {
        block: {
          last_commit: {
            height: '118',
            signatures: [{ validator_address: 'not-hex', block_id_flag: 2 }],
          },
        },
      },
    });
    await projectBlockSignaturesHeight({ prisma: p, chainId: CHAIN_ID, height: 119n });
    assert.equal(p.signatures.length, 1);
    assert.equal(p.signatures[0].validatorAddress, null);
    assert.deepEqual(failureKinds(p), ['invalid_validator_address']);
  });

  it('invalid last_commit.height records invalid_height and falls back to N-1', async () => {
    const p = new MockBlockSignaturesPrisma();
    const raw = rawBlock({ sourceHeight: 119n, committedHeight: 118n });
    raw.result.block.last_commit.height = 'bad';
    p.seedBlock(119n, raw);
    await projectBlockSignaturesHeight({ prisma: p, chainId: CHAIN_ID, height: 119n });
    assert.equal(p.signatures[0].committedBlockHeight, 118n);
    assert.ok(failureKinds(p).includes('invalid_height'));
  });

  // #59: a parseable-but-inconsistent last_commit.height (violates the CometBFT invariant that block H's
  // commit is for H-1) must be flagged and the protocol-derived value used — never the raw one. Trusting a
  // raw height > sourceBlockHeight would let downstream window-consumers query a committed height beyond
  // temporal-map's cursor and silently mis-attribute it (the source-axis cap only bounds source).
  it('#59: parseable-but-inconsistent last_commit.height records inconsistent_committed_height and uses N-1', async () => {
    const p = new MockBlockSignaturesPrisma();
    // last_commit.height = 130 in block 119 is inconsistent (should be 118) and, crucially, > sourceBlockHeight.
    p.seedBlock(119n, rawBlock({ sourceHeight: 119n, committedHeight: 130n }));
    await projectBlockSignaturesHeight({ prisma: p, chainId: CHAIN_ID, height: 119n });
    // committed must be the derived 118, NOT the bogus raw 130 -> committed <= source is now guaranteed.
    assert.equal(p.signatures[0].committedBlockHeight, 118n);
    assert.ok(failureKinds(p).includes('inconsistent_committed_height'));
  });

  it('#59: a consistent last_commit.height (N-1) records no committed-height failure', async () => {
    const p = new MockBlockSignaturesPrisma();
    p.seedBlock(119n, rawBlock({ sourceHeight: 119n, committedHeight: 118n }));
    await projectBlockSignaturesHeight({ prisma: p, chainId: CHAIN_ID, height: 119n });
    assert.equal(p.signatures[0].committedBlockHeight, 118n);
    assert.equal(failureKinds(p).includes('inconsistent_committed_height'), false);
  });

  it('makeSignatureKey is deterministic', () => {
    assert.equal(
      makeSignatureKey({
        sourceBlockHeight: 119n,
        committedBlockHeight: 118n,
        signatureIndex: 0,
        validatorAddress: ADDR_A.toLowerCase(),
      }),
      `119:118:0:${ADDR_A.toLowerCase()}`,
    );
  });

  it('reset deletes BlockSignature rows only and preserves generic/CoreSlot/rewards sentinels', async () => {
    const p = new MockBlockSignaturesPrisma();
    p.signatures.push({ signatureKey: 'k' });
    p.failures.push({ projectionName: BLOCK_SIGNATURES_PROJECTION });
    p.failures.push({ projectionName: 'coreslot_lifecycle_v1' });
    p.cursors.set(`${BLOCK_SIGNATURES_PROJECTION}:${CHAIN_ID}`, { projectionName: BLOCK_SIGNATURES_PROJECTION });
    p.cursors.set(`rewards_semantic_v1:${CHAIN_ID}`, { projectionName: 'rewards_semantic_v1' });
    p.genericRows = 9;
    p.coreSlotRows = 3;
    p.rewardsRows = 2;

    await resetBlockSignaturesProjection(p);
    assert.equal(p.signatures.length, 0);
    assert.equal(p.failures.length, 1);
    assert.equal(p.cursors.has(`${BLOCK_SIGNATURES_PROJECTION}:${CHAIN_ID}`), false);
    assert.equal(p.cursors.has(`rewards_semantic_v1:${CHAIN_ID}`), true);
    assert.equal(p.genericRows, 9);
    assert.equal(p.coreSlotRows, 3);
    assert.equal(p.rewardsRows, 2);
  });

  it('cursor does not advance on semantic write failure', async () => {
    const p = new MockBlockSignaturesPrisma();
    p.seedBlock(119n, rawBlock({ sourceHeight: 119n, committedHeight: 118n }));
    p.throwOnSignatureUpsert = true;
    await assert.rejects(
      () => projectBlockSignaturesHeight({ prisma: p, chainId: CHAIN_ID, height: 119n }),
      /write failed/,
    );
    const cursor = p.cursors.get(`${BLOCK_SIGNATURES_PROJECTION}:${CHAIN_ID}`);
    assert.equal(cursor.status, 'halted_error');
    assert.notEqual(cursor.lastProjectedHeight, 119n);
  });

  it('does not attempt CoreSlot attribution or liveness percentages', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../src/projections/block-signatures.ts', import.meta.url)),
      'utf8',
    );
    assert.equal(src.includes('findConsensusWindowAtHeight'), false);
    assert.equal(src.includes('CoreSlotConsensusWindow'), false);
    assert.equal(/uptime|liveness|missed/i.test(src), false);
  });
});

function rawBlock({ sourceHeight, committedHeight }) {
  return {
    result: {
      block: {
        header: {
          height: sourceHeight.toString(),
          proposer_address: ADDR_A,
        },
        last_commit: {
          round: 0,
          height: committedHeight?.toString(),
          block_id: { hash: `BLOCK${committedHeight ?? sourceHeight - 1n}` },
          signatures: [
            {
              validator_address: ADDR_A,
              block_id_flag: 2,
              timestamp: '2026-06-24T03:54:08.163658Z',
              signature: 'SIG-A',
            },
            {
              validator_address: ADDR_B,
              block_id_flag: 1,
              timestamp: '2026-06-24T03:54:08.163658Z',
            },
            {
              validator_address: ADDR_C,
              block_id_flag: 3,
              timestamp: '2026-06-24T03:54:08.163658Z',
              signature: 'SIG-C',
            },
          ],
        },
      },
    },
  };
}

function failureKinds(p) {
  return p.failures.map((f) => f.failureKind).filter(Boolean).sort();
}

class MockBlockSignaturesPrisma {
  constructor() {
    this.blocks = new Map();
    this.signatures = [];
    this.failures = [];
    this.cursors = new Map();
    this.genericRows = 0;
    this.coreSlotRows = 0;
    this.rewardsRows = 0;
    this.throwOnSignatureUpsert = false;
    this.block = {
      findMany: async (args) => {
        const gte = args.where.height.gte;
        const lte = args.where.height.lte;
        return [...this.blocks.values()]
          .filter((block) => block.height >= gte && block.height <= lte)
          .sort((a, b) => (a.height < b.height ? -1 : a.height > b.height ? 1 : 0))
          .map((block) => ({ height: block.height }));
      },
      findUnique: async (args) => this.blocks.get(args.where.height.toString()) ?? null,
    };
    this.blockSignature = {
      upsert: async (args) => {
        if (this.throwOnSignatureUpsert) throw new Error('write failed');
        const existing = this.signatures.find((s) => s.signatureKey === args.where.signatureKey);
        if (existing) {
          Object.assign(existing, args.update);
          return existing;
        }
        const row = { id: BigInt(this.signatures.length + 1), ...args.create };
        this.signatures.push(row);
        return row;
      },
      deleteMany: async () => {
        this.signatures = [];
      },
    };
    this.projectionFailure = {
      upsert: async (args) => {
        const key = args.where.failureKey;
        const existing = this.failures.find((f) => f.failureKey === key);
        if (existing) {
          Object.assign(existing, args.update);
          return existing;
        }
        const row = { id: BigInt(this.failures.length + 1), ...args.create };
        this.failures.push(row);
        return row;
      },
      deleteMany: async (args) => {
        const where = args.where ?? {};
        this.failures = this.failures.filter((failure) => {
          if (where.projectionName && failure.projectionName !== where.projectionName) return true;
          if (where.sourceHeight !== undefined && failure.sourceHeight !== where.sourceHeight) return true;
          if (where.resolved !== undefined && failure.resolved !== where.resolved) return true;
          return false;
        });
      },
    };
    this.projectionCursor = {
      upsert: async (args) => {
        const key = `${args.where.projectionName_chainId.projectionName}:${args.where.projectionName_chainId.chainId}`;
        const existing = this.cursors.get(key);
        const row = existing ? { ...existing, ...args.update } : args.create;
        this.cursors.set(key, row);
        return row;
      },
      deleteMany: async (args) => {
        for (const [key, cursor] of [...this.cursors.entries()]) {
          if (cursor.projectionName === args.where.projectionName) this.cursors.delete(key);
        }
      },
    };
  }

  seedBlock(height, rawJson) {
    this.blocks.set(height.toString(), { height, rawJson });
  }

  async $transaction(fn) {
    return fn(this);
  }
}
