import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { seedCoreSlotGenesisIdentity } from '../../dist/projections/coreslot-genesis-identity.js';

const CHAIN_ID = 'twilight-test';

// Real Phase 7.2 fixture genesis slot shape (app_state.coreslot.slots[]).
function genesisSlot(id, { status = 'SLOT_STATUS_ACTIVE', pubkeyB64 } = {}) {
  const operator = `twilight1op${id}`;
  return {
    slot_id: String(id),
    operator_address: operator,
    payout_address: operator,
    consensus_pubkey: { '@type': '/cosmos.crypto.ed25519.PubKey', key: pubkeyB64 },
    status,
    consensus_power: '1',
    reward_weight: '1.000000000000000000',
    created_height: '0',
    metadata: { moniker: `node${id}`, identity: '', website: '', security_contact: '', details: '' },
  };
}

function expectedConsensusAddress(pubkeyB64) {
  return createHash('sha256')
    .update(Buffer.from(pubkeyB64, 'base64'))
    .digest()
    .subarray(0, 20)
    .toString('hex');
}

class MockSeedPrisma {
  constructor() {
    this.slots = new Map();
    this.failures = new Map();
    this.coreSlotProjection = {
      upsert: async (args) => {
        const key = args.where.slotId.toString();
        const existing = this.slots.get(key);
        // Honor create-vs-update like Prisma so the no-clobber behavior is exercised.
        this.slots.set(key, existing ? { ...existing, ...args.update } : { ...args.create });
      },
    };
    this.projectionFailure = {
      upsert: async (args) => {
        this.failures.set(args.where.failureKey, { ...args.create });
      },
    };
  }
}

function clientWith(slots, raw) {
  return {
    getGenesis: async () => ({
      chainId: CHAIN_ID,
      initialHeight: '1',
      coreSlot: raw ?? { slots },
      raw: { app_state: { coreslot: { slots } } },
    }),
  };
}

describe('CoreSlot genesis identity seed (F1)', () => {
  const PUB = 'jzW9Yasrsrl+DY1Nr2/LrbM6Rgs36Xqmy/BBJCvmILs=';

  it('seeds a full CoreSlotProjection identity row from genesis', async () => {
    const p = new MockSeedPrisma();
    const result = await seedCoreSlotGenesisIdentity({
      prisma: p,
      chainId: CHAIN_ID,
      client: clientWith([genesisSlot(1, { pubkeyB64: PUB })]),
    });

    assert.equal(result.slotsSeeded, 1);
    assert.equal(result.failuresCreated, 0);
    const row = p.slots.get('1');
    assert.equal(row.slotId, 1n);
    assert.equal(row.status, 'ACTIVE'); // SLOT_STATUS_ACTIVE normalized
    assert.equal(row.operatorAddress, 'twilight1op1');
    assert.equal(row.payoutAddress, 'twilight1op1');
    assert.equal(row.consensusAddress, expectedConsensusAddress(PUB));
    assert.equal(row.rewardWeight, '1.000000000000000000');
    assert.equal(row.consensusPower, 1n);
    assert.equal(row.metadataJson.moniker, 'node1');
    assert.equal(row.createdHeight, 0n);
    assert.equal(row.updatedHeight, 1n); // genesis baseline height
  });

  it('seeds every genesis slot (multi-slot PoA set)', async () => {
    const p = new MockSeedPrisma();
    const result = await seedCoreSlotGenesisIdentity({
      prisma: p,
      chainId: CHAIN_ID,
      client: clientWith([1, 2, 3, 4].map((id) => genesisSlot(id, { pubkeyB64: PUB }))),
    });
    assert.equal(result.slotsSeeded, 4);
    assert.deepEqual([...p.slots.keys()].sort(), ['1', '2', '3', '4']);
  });

  it('re-seed does not clobber event-derived state (no updatedHeight regression)', async () => {
    const p = new MockSeedPrisma();
    const client = clientWith([genesisSlot(1, { pubkeyB64: PUB })]);
    await seedCoreSlotGenesisIdentity({ prisma: p, chainId: CHAIN_ID, client });
    // Simulate later on-chain event replay updating the row past the genesis baseline.
    Object.assign(p.slots.get('1'), { status: 'INACTIVE', updatedHeight: 42n });
    // An incremental re-seed (non-reset, startHeight<=1) must leave event-derived state intact.
    await seedCoreSlotGenesisIdentity({ prisma: p, chainId: CHAIN_ID, client });
    const row = p.slots.get('1');
    assert.equal(row.status, 'INACTIVE'); // not regressed to genesis ACTIVE
    assert.equal(row.updatedHeight, 42n); // not regressed to genesis baseline 1
  });

  it('records invalid_slot_id and skips a slot missing its id (never fabricates)', async () => {
    const p = new MockSeedPrisma();
    const bad = genesisSlot(2, { pubkeyB64: PUB });
    delete bad.slot_id;
    const result = await seedCoreSlotGenesisIdentity({
      prisma: p,
      chainId: CHAIN_ID,
      client: clientWith([bad]),
    });
    assert.equal(result.slotsSeeded, 0);
    assert.equal(result.failuresCreated, 1);
    assert.equal(p.slots.size, 0);
    const failure = [...p.failures.values()][0];
    assert.equal(failure.failureKind, 'invalid_slot_id');
    // Durability: stamped at the pre-chain sentinel height 0 so the metadata height-1 cleanup
    // (deleteMany sourceHeight=1) cannot silently delete it. See coreslot-genesis-identity.ts.
    assert.equal(failure.sourceHeight, 0n);
  });

  it('records genesis_coreslot_malformed when app_state.coreslot is empty', async () => {
    const p = new MockSeedPrisma();
    const result = await seedCoreSlotGenesisIdentity({
      prisma: p,
      chainId: CHAIN_ID,
      client: clientWith(undefined, {}),
    });
    assert.equal(result.slotsSeeded, 0);
    const failure = [...p.failures.values()][0];
    assert.equal(failure.failureKind, 'genesis_coreslot_malformed');
    assert.equal(failure.sourceHeight, 0n); // durable past the metadata height-1 cleanup
  });

  it('rethrows + records genesis_unavailable when getGenesis fails', async () => {
    const p = new MockSeedPrisma();
    const client = { getGenesis: async () => { throw new Error('REST down'); } };
    await assert.rejects(
      () => seedCoreSlotGenesisIdentity({ prisma: p, chainId: CHAIN_ID, client }),
      /REST down/,
    );
    assert.equal([...p.failures.values()][0].failureKind, 'genesis_unavailable');
  });
});
