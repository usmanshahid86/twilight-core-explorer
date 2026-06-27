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
        this.slots.set(args.where.slotId.toString(), { ...args.create });
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
    assert.equal([...p.failures.values()][0].failureKind, 'invalid_slot_id');
  });

  it('records genesis_coreslot_malformed when app_state.coreslot is empty', async () => {
    const p = new MockSeedPrisma();
    const result = await seedCoreSlotGenesisIdentity({
      prisma: p,
      chainId: CHAIN_ID,
      client: clientWith(undefined, {}),
    });
    assert.equal(result.slotsSeeded, 0);
    assert.equal([...p.failures.values()][0].failureKind, 'genesis_coreslot_malformed');
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
