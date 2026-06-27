import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  REWARDS_CLAIM_TYPE_URL,
  REWARDS_PAUSE_TYPE_URL,
  REWARDS_RESUME_TYPE_URL,
  REWARDS_SEMANTIC_PROJECTION,
  REWARDS_SNAPSHOT_PROJECTION,
  REWARDS_UPDATE_PARAMS_TYPE_URL,
} from '../../dist/projections/types.js';
import {
  projectRewardsSemanticHeight,
  projectRewardsSemanticRange,
} from '../../dist/projections/rewards-semantic.js';
import {
  buildBalanceSampleKey,
  ingestRewardsSnapshot,
} from '../../dist/projections/rewards-snapshot.js';
import { resetRewardsProjections } from '../../dist/projections/reset-rewards.js';

const CHAIN_ID = 'twilight-test';
const CLAIMANT = 'twilight1claimantxxxxxxxxxxxxxxxxxxxxxxxxxxx';

describe('Rewards semantic projection', () => {
  it('1. epoch_finalized creates a RewardEpochProjection', async () => {
    const p = new MockRewardsPrisma();
    p.events.push(evt(1n, 100n, null, null, 'epoch_finalized', [
      { key: 'epoch_number', value: '7' },
      { key: 'total_reward', value: '1000000' },
      { key: 'denom', value: 'utwlt' },
      { key: 'active_slot_count', value: '4' },
    ]));
    await projectRewardsSemanticHeight({ prisma: p, chainId: CHAIN_ID, height: 100n });
    assert.equal(p.epochs.size, 1);
    const e = p.epochs.get('7');
    assert.equal(e.totalReward, '1000000');
    assert.equal(e.activeSlotCount, 4);
  });

  it('2. epoch_finalized does not create claim truth', async () => {
    const p = new MockRewardsPrisma();
    p.events.push(evt(1n, 100n, null, null, 'epoch_finalized', [{ key: 'epoch_number', value: '7' }]));
    await projectRewardsSemanticHeight({ prisma: p, chainId: CHAIN_ID, height: 100n });
    assert.equal(p.slotRewards.length, 0);
    assert.equal(p.claims.size, 0);
  });

  it('3a. epoch_finalized maps live nyks-core keys (allocated/eligible_slots/cumulative_emitted/distribution_method) + utwlt denom', async () => {
    // Real Phase 7.2 fixture event shape: the chain emits `allocated`/`eligible_slots`/
    // `cumulative_emitted`/`distribution_method` (NOT total_reward/active_slot_count/denom).
    const p = new MockRewardsPrisma();
    p.events.push(evt(3n, 30n, null, null, 'epoch_finalized', [
      { key: 'epoch', value: '3' },
      { key: 'start_height', value: '21' },
      { key: 'end_height', value: '30' },
      { key: 'minted_emission', value: '4161900' },
      { key: 'cumulative_emitted', value: '12485700' },
      { key: 'reward_pool', value: '4161900' },
      { key: 'allocated', value: '4161900' },
      { key: 'carry_out', value: '0' },
      { key: 'eligible_slots', value: '4' },
      { key: 'distribution_method', value: 'DISTRIBUTION_METHOD_UNIFORM_ACTIVE_BLOCKS' },
    ]));
    await projectRewardsSemanticHeight({ prisma: p, chainId: CHAIN_ID, height: 30n });
    const e = p.epochs.get('3');
    assert.equal(e.totalReward, '4161900'); // <- allocated
    assert.equal(e.activeSlotCount, 4); // <- eligible_slots
    assert.equal(e.cumulativeEmitted, '12485700');
    assert.equal(e.distributionMethod, 'DISTRIBUTION_METHOD_UNIFORM_ACTIVE_BLOCKS');
    assert.equal(e.denom, 'utwlt'); // <- not emitted; native-denom default
  });

  it('3b. reward_claimed maps signer -> claimant + utwlt denom (live nyks-core keys)', async () => {
    const SIGNER = 'twilight1signerxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    const p = new MockRewardsPrisma();
    p.transactions.push(successTx('CLAIM-SIGNER', 31n));
    p.messages.push(msg(1n, 'CLAIM-SIGNER', 31n, 0, REWARDS_CLAIM_TYPE_URL, {
      slot_id: '1', start_epoch: '2', end_epoch: '3',
    }));
    p.events.push(evt(10n, 31n, 'CLAIM-SIGNER', 0, 'reward_claimed', [
      { key: 'signer', value: SIGNER },
      { key: 'slot_id', value: '1' },
      { key: 'start_epoch', value: '2' },
      { key: 'end_epoch', value: '3' },
      { key: 'amount', value: '2080950' },
      { key: 'payout_count', value: '1' },
      { key: 'msg_index', value: '0' },
    ]));
    await projectRewardsSemanticHeight({ prisma: p, chainId: CHAIN_ID, height: 31n });
    const c = [...p.claims.values()][0];
    assert.equal(c.claimant, SIGNER); // <- signer, not claimant/operator/creator
    assert.equal(c.denom, 'utwlt'); // <- not emitted; native-denom default
    assert.equal(c.amount, '2080950');
  });

  it('5. MsgClaimRewards + reward_claimed creates a RewardClaimEvent', async () => {
    const p = new MockRewardsPrisma();
    seedClaim(p, { height: 120n });
    await projectRewardsSemanticHeight({ prisma: p, chainId: CHAIN_ID, height: 120n });
    assert.equal(p.claims.size, 1);
    const c = [...p.claims.values()][0];
    assert.equal(c.slotId, 4n);
    assert.equal(c.startEpoch, 1n);
    assert.equal(c.endEpoch, 2n);
  });

  it('6. claim event updates existing SlotRewardProjection rows in the claimed range', async () => {
    const p = new MockRewardsPrisma();
    p.seedSlotReward({ slotId: 4n, epochNumber: 1n, amount: '10', sampledAtHeight: 110n });
    p.seedSlotReward({ slotId: 4n, epochNumber: 2n, amount: '20', sampledAtHeight: 110n });
    p.seedSlotReward({ slotId: 4n, epochNumber: 3n, amount: '30', sampledAtHeight: 110n });
    seedClaim(p, { height: 120n });
    await projectRewardsSemanticHeight({ prisma: p, chainId: CHAIN_ID, height: 120n });

    const claimed = p.slotRewards.filter((r) => r.claimed);
    assert.deepEqual(claimed.map((r) => r.epochNumber).sort(), [1n, 2n]);
    assert.equal(p.slotRewards.find((r) => r.epochNumber === 3n).claimed, false);
    assert.equal(claimed[0].claimTxHash, 'CLAIM-120');
    assert.equal(claimed[0].claimedAtHeight, 120n);
  });

  it('7. claim with missing reward records records missing_reward_records and does not fabricate', async () => {
    const p = new MockRewardsPrisma();
    seedClaim(p, { height: 120n });
    await projectRewardsSemanticHeight({ prisma: p, chainId: CHAIN_ID, height: 120n });
    assert.equal(p.claims.size, 1);
    assert.equal(p.slotRewards.length, 0); // nothing fabricated
    assert.ok(failureKinds(p).includes('missing_reward_records'));
  });

  it('8. failed claim tx does not project', async () => {
    const p = new MockRewardsPrisma();
    p.transactions.push(failedTx('CLAIM-120', 120n));
    p.messages.push(claimMessage(1n, 'CLAIM-120', 120n));
    p.events.push(rewardClaimedEvent(10n, 'CLAIM-120', 120n));
    await projectRewardsSemanticHeight({ prisma: p, chainId: CHAIN_ID, height: 120n });
    assert.equal(p.claims.size, 0);
    assert.equal(p.failures.length, 0);
  });

  it('9. claim message without event records missing_event', async () => {
    const p = new MockRewardsPrisma();
    p.transactions.push(successTx('CLAIM-120', 120n));
    p.messages.push(claimMessage(1n, 'CLAIM-120', 120n));
    await projectRewardsSemanticHeight({ prisma: p, chainId: CHAIN_ID, height: 120n });
    assert.equal(p.claims.size, 0);
    assert.ok(failureKinds(p).includes('missing_event'));
  });

  it('10. reward_claimed event without message records missing_message', async () => {
    const p = new MockRewardsPrisma();
    p.transactions.push(successTx('CLAIM-120', 120n));
    p.events.push(rewardClaimedEvent(10n, 'CLAIM-120', 120n));
    await projectRewardsSemanticHeight({ prisma: p, chainId: CHAIN_ID, height: 120n });
    assert.equal(p.claims.size, 1); // recorded from event
    assert.ok(failureKinds(p).includes('missing_message'));
  });

  it('11. ambiguous claim events create claim_correlation_failed', async () => {
    const p = new MockRewardsPrisma();
    p.transactions.push(successTx('CLAIM-120', 120n));
    p.messages.push(claimMessage(1n, 'CLAIM-120', 120n));
    p.events.push(rewardClaimedEvent(10n, 'CLAIM-120', 120n));
    p.events.push(rewardClaimedEvent(11n, 'CLAIM-120', 120n));
    await projectRewardsSemanticHeight({ prisma: p, chainId: CHAIN_ID, height: 120n });
    assert.ok(failureKinds(p).includes('claim_correlation_failed'));
  });

  it('12. params_update_queued stores a queued params change', async () => {
    const p = new MockRewardsPrisma();
    p.transactions.push(successTx('PARAMS-130', 130n));
    p.messages.push(msg(1n, 'PARAMS-130', 130n, 0, REWARDS_UPDATE_PARAMS_TYPE_URL, {
      authority: 'twilight1auth', params: { epochLength: '100' },
    }));
    p.events.push(evt(10n, 130n, 'PARAMS-130', 0, 'params_update_queued', [{ key: 'msg_index', value: '0' }]));
    await projectRewardsSemanticHeight({ prisma: p, chainId: CHAIN_ID, height: 130n });
    assert.equal(p.paramsChanges.length, 1);
    assert.equal(p.paramsChanges[0].changeType, 'queued');
    assert.deepEqual(p.paramsChanges[0].paramsJson, { epochLength: '100' });
  });

  it('13. params_activated (EndBlock, no message) stores an activated params change', async () => {
    const p = new MockRewardsPrisma();
    p.events.push(evt(10n, 140n, null, null, 'params_activated', [{ key: 'authority', value: 'twilight1auth' }]));
    await projectRewardsSemanticHeight({ prisma: p, chainId: CHAIN_ID, height: 140n });
    assert.equal(p.paramsChanges.length, 1);
    assert.equal(p.paramsChanges[0].changeType, 'activated');
    assert.equal(p.paramsChanges[0].txHash, null);
  });

  it('14. rewards_paused stores a pause change', async () => {
    const p = new MockRewardsPrisma();
    p.transactions.push(successTx('PAUSE-150', 150n));
    p.messages.push(msg(1n, 'PAUSE-150', 150n, 0, REWARDS_PAUSE_TYPE_URL, { authority: 'twilight1auth' }));
    p.events.push(evt(10n, 150n, 'PAUSE-150', 0, 'rewards_paused', [{ key: 'msg_index', value: '0' }]));
    await projectRewardsSemanticHeight({ prisma: p, chainId: CHAIN_ID, height: 150n });
    assert.equal(p.paramsChanges.length, 1);
    assert.equal(p.paramsChanges[0].changeType, 'pause');
  });

  it('15. rewards_resumed stores a resume change', async () => {
    const p = new MockRewardsPrisma();
    p.transactions.push(successTx('RESUME-160', 160n));
    p.messages.push(msg(1n, 'RESUME-160', 160n, 0, REWARDS_RESUME_TYPE_URL, { authority: 'twilight1auth' }));
    p.events.push(evt(10n, 160n, 'RESUME-160', 0, 'rewards_resumed', [{ key: 'msg_index', value: '0' }]));
    await projectRewardsSemanticHeight({ prisma: p, chainId: CHAIN_ID, height: 160n });
    assert.equal(p.paramsChanges.length, 1);
    assert.equal(p.paramsChanges[0].changeType, 'resume');
  });

  it('16. treasury_paid is stored without changing claim truth', async () => {
    const p = new MockRewardsPrisma();
    p.events.push(evt(10n, 170n, null, null, 'treasury_paid', [
      { key: 'recipient', value: 'twilight1treasury' },
      { key: 'amount', value: '500' },
      { key: 'denom', value: 'utwlt' },
    ]));
    await projectRewardsSemanticHeight({ prisma: p, chainId: CHAIN_ID, height: 170n });
    assert.equal(p.treasury.size, 1);
    assert.equal(p.slotRewards.length, 0);
    assert.equal(p.claims.size, 0);
  });

  it('18. rerun is idempotent for rows and failures', async () => {
    const p = new MockRewardsPrisma();
    p.events.push(evt(1n, 100n, null, null, 'epoch_finalized', [{ key: 'epoch_number', value: '7' }]));
    seedClaim(p, { height: 100n });
    const run = () => projectRewardsSemanticRange({ prisma: p, chainId: CHAIN_ID, startHeight: 100n, endHeight: 100n });
    await run();
    await run();
    assert.equal(p.epochs.size, 1);
    assert.equal(p.claims.size, 1);
    // missing_reward_records (one) deduped by deterministic failureKey
    assert.equal(p.failures.length, 1);
  });

  it('19. unknown rewards event records unknown_semantic_type and does not crash', async () => {
    const p = new MockRewardsPrisma();
    p.events.push(evt(1n, 100n, null, null, 'rewards_supernova', [], 'rewards'));
    await projectRewardsSemanticHeight({ prisma: p, chainId: CHAIN_ID, height: 100n });
    assert.ok(failureKinds(p).includes('unknown_semantic_type'));
  });

  it('20. rewards projection source uses no staking/distribution/mint/gov routes', () => {
    for (const f of ['rewards-semantic.ts', 'rewards-snapshot.ts']) {
      const src = readFileSync(fileURLToPath(new URL(`../../src/projections/${f}`, import.meta.url)), 'utf8');
      assert.equal(/\/cosmos\/(staking|gov|mint|distribution)/.test(src), false, `${f} references unsupported route`);
    }
  });
});

describe('Rewards observed snapshot ingestion', () => {
  it('3. SlotRewards snapshot creates SlotRewardProjection rows tied to sampledAtHeight', async () => {
    const p = new MockRewardsPrisma();
    const client = mockClient({
      slotRewards: { 4: { rewards: [
        { epoch_number: '1', amount: '10', denom: 'utwlt', claimed: false },
        { epoch_number: '2', amount: '20', denom: 'utwlt', claimed: false },
      ] } },
    });
    await ingestRewardsSnapshot({ prisma: p, client, chainId: CHAIN_ID, height: 200n, slotIds: [4n] });
    assert.equal(p.slotRewards.length, 2);
    assert.equal(p.slotRewards[0].sampledAtHeight, 200n);
  });

  it('4. SlotRewards claimed=true is stored as claim truth', async () => {
    const p = new MockRewardsPrisma();
    const client = mockClient({
      slotRewards: { 4: { rewards: [
        { epoch_number: '1', amount: '10', denom: 'utwlt', claimed: true, claimed_at_height: '150' },
      ] } },
    });
    await ingestRewardsSnapshot({ prisma: p, client, chainId: CHAIN_ID, height: 200n, slotIds: [4n] });
    assert.equal(p.slotRewards[0].claimed, true);
    assert.equal(p.slotRewards[0].claimedAtHeight, 150n);
  });

  it('snapshot does not unset a claim already recorded by the semantic projector', async () => {
    const p = new MockRewardsPrisma();
    p.seedSlotReward({ slotId: 4n, epochNumber: 1n, amount: '10', claimed: true, claimTxHash: 'CLAIM-120' });
    const client = mockClient({
      slotRewards: { 4: { rewards: [{ epoch_number: '1', amount: '10', denom: 'utwlt', claimed: false }] } },
    });
    await ingestRewardsSnapshot({ prisma: p, client, chainId: CHAIN_ID, height: 200n, slotIds: [4n] });
    assert.equal(p.slotRewards[0].claimed, true); // not unset
  });

  it('module balances are stored as observed samples', async () => {
    const p = new MockRewardsPrisma();
    const client = mockClient({
      moduleBalances: { balances: [{ denom: 'utwlt', amount: '999', module_name: 'rewards' }] },
      cumulativeEmitted: { amount: '5000', denom: 'utwlt' },
    });
    await ingestRewardsSnapshot({ prisma: p, client, chainId: CHAIN_ID, height: 200n, slotIds: [] });
    assert.equal(p.balanceSamples.length, 2);
    assert.ok(p.balanceSamples.some((b) => b.sampleKind === 'module_balance'));
    assert.ok(p.balanceSamples.some((b) => b.sampleKind === 'cumulative_emitted'));
  });

  it('paginates getSlotRewards until next_key is exhausted', async () => {
    const p = new MockRewardsPrisma();
    let calls = 0;
    const client = {
      getSlotRewards: async (_slotId, pagination) => {
        calls += 1;
        if (!pagination?.key) {
          return { raw: { rewards: [{ epoch_number: '1', amount: '10', denom: 'utwlt' }], pagination: { next_key: 'PAGE2' } } };
        }
        return { raw: { rewards: [{ epoch_number: '2', amount: '20', denom: 'utwlt' }], pagination: { next_key: '' } } };
      },
      getModuleBalances: async () => ({ raw: { balances: [] } }),
      getCumulativeEmitted: async () => ({ raw: {} }),
    };
    const result = await ingestRewardsSnapshot({ prisma: p, client, chainId: CHAIN_ID, height: 200n, slotIds: [4n] });
    assert.equal(calls, 2); // followed next_key to page 2
    assert.equal(result.slotRewardRows, 2);
    assert.deepEqual(p.slotRewards.map((r) => r.epochNumber).sort(), [1n, 2n]);
  });

  it('builds a deterministic non-null sample key for null address/moduleName (cumulative)', () => {
    const key = buildBalanceSampleKey({
      height: 200n, sampleKind: 'cumulative_emitted', address: null, moduleName: null, denom: 'utwlt',
    });
    assert.equal(key, '200:cumulative_emitted:-:-:utwlt');
  });

  it('re-sampling the same height is idempotent for null-keyed balance samples', async () => {
    const p = new MockRewardsPrisma();
    const client = mockClient({ cumulativeEmitted: { amount: '5000', denom: 'utwlt' } });
    await ingestRewardsSnapshot({ prisma: p, client, chainId: CHAIN_ID, height: 200n, slotIds: [] });
    await ingestRewardsSnapshot({ prisma: p, client, chainId: CHAIN_ID, height: 200n, slotIds: [] });
    const cumulative = p.balanceSamples.filter((b) => b.sampleKind === 'cumulative_emitted');
    assert.equal(cumulative.length, 1); // upsert by sampleKey, not duplicated
  });
});

describe('Rewards reset safety', () => {
  it('17. reset deletes rewards rows and preserves generic + CoreSlot rows', async () => {
    const p = new MockRewardsPrisma();
    p.epochs.set('7', { epochNumber: 7n });
    p.seedSlotReward({ slotId: 4n, epochNumber: 1n, amount: '10' });
    p.claims.set('10', { sourceEventId: 10n });
    p.paramsChanges.push({ id: 1n, changeType: 'pause' });
    p.treasury.set('11', { sourceEventId: 11n });
    p.balanceSamples.push({ id: 1n });
    p.transactions.push(successTx('T', 1n));
    p.coreSlotRows = 3; // sentinel for "untouched CoreSlot domain"
    p.failures.push(
      { failureKey: 'a', projectionName: REWARDS_SEMANTIC_PROJECTION },
      { failureKey: 'b', projectionName: REWARDS_SNAPSHOT_PROJECTION },
      { failureKey: 'c', projectionName: 'coreslot_lifecycle_v1' },
    );
    p.seedCursor(REWARDS_SEMANTIC_PROJECTION, 100n);
    p.seedCursor('coreslot_lifecycle_v1', 100n);

    await resetRewardsProjections(p);

    assert.equal(p.epochs.size, 0);
    assert.equal(p.slotRewards.length, 0);
    assert.equal(p.claims.size, 0);
    assert.equal(p.paramsChanges.length, 0);
    assert.equal(p.treasury.size, 0);
    assert.equal(p.balanceSamples.length, 0);
    assert.equal(p.transactions.length, 1); // generic preserved
    assert.deepEqual(p.failures.map((f) => f.projectionName), ['coreslot_lifecycle_v1']);
    assert.deepEqual([...p.cursors.values()].map((c) => c.projectionName), ['coreslot_lifecycle_v1']);
  });
});

// --------------------------------------------------------------------------
// Fixtures + mock
// --------------------------------------------------------------------------

function failureKinds(p) {
  return p.failures.map((f) => f.failureKind);
}

function successTx(hash, height) {
  return { hash, height, status: 'success', code: 0 };
}
function failedTx(hash, height) {
  return { hash, height, status: 'failed', code: 7 };
}

function msg(id, txHash, height, msgIndex, typeUrl, decodedJson) {
  return { id, txHash, height, msgIndex, typeUrl, module: 'rewards', decodedJson, rawJson: {} };
}

function claimMessage(id, txHash, height) {
  return msg(id, txHash, height, 0, REWARDS_CLAIM_TYPE_URL, {
    slot_id: '4', start_epoch: '1', end_epoch: '2', claimant: CLAIMANT,
  });
}

function evt(id, height, txHash, msgIndex, type, attrs, module) {
  return { id, height, txHash, msgIndex, type, attributesJson: attrs, module: module ?? null };
}

function rewardClaimedEvent(id, txHash, height) {
  return evt(id, height, txHash, 0, 'reward_claimed', [
    { key: 'slot_id', value: '4' },
    { key: 'start_epoch', value: '1' },
    { key: 'end_epoch', value: '2' },
    { key: 'amount', value: '30' },
    { key: 'denom', value: 'utwlt' },
    { key: 'claimant', value: CLAIMANT },
    { key: 'msg_index', value: '0' },
  ]);
}

function seedClaim(p, { height }) {
  p.transactions.push(successTx(`CLAIM-${height}`, height));
  p.messages.push(claimMessage(1n, `CLAIM-${height}`, height));
  p.events.push(rewardClaimedEvent(10n, `CLAIM-${height}`, height));
}

function mockClient(data) {
  return {
    getSlotRewards: async (slotId) => ({ raw: data.slotRewards?.[Number(slotId)] ?? { rewards: [] } }),
    getModuleBalances: async () => ({ raw: data.moduleBalances ?? { balances: [] } }),
    getCumulativeEmitted: async () => ({ raw: data.cumulativeEmitted ?? {} }),
  };
}

class MockRewardsPrisma {
  constructor() {
    this.transactions = [];
    this.messages = [];
    this.events = [];
    this.epochs = new Map();
    this.slotRewards = [];
    this.nextSlotRewardId = 1n;
    this.claims = new Map();
    this.paramsChanges = [];
    this.nextParamsId = 1n;
    this.treasury = new Map();
    this.balanceSamples = [];
    this.failures = [];
    this.cursors = new Map();

    this.explorerTransaction = {
      findMany: async (args) => {
        const where = args?.where ?? {};
        return this.transactions.filter((t) => {
          if (where.height !== undefined && t.height !== where.height) return false;
          return t.status === 'success' || t.code === 0;
        });
      },
    };
    this.message = {
      findMany: async (args) => {
        const where = args?.where ?? {};
        const hashes = new Set(where.txHash?.in ?? []);
        const urls = new Set(where.typeUrl?.in ?? []);
        return this.messages.filter((m) => {
          if (where.height !== undefined && m.height !== where.height) return false;
          if (hashes.size > 0 && !hashes.has(m.txHash)) return false;
          if (where.module !== undefined && m.module !== where.module) return false;
          if (urls.size > 0 && !urls.has(m.typeUrl)) return false;
          return true;
        });
      },
    };
    this.event = {
      findMany: async (args) => {
        const where = args?.where ?? {};
        const types = new Set(where.type?.in ?? []);
        const notInTypes = new Set(where.NOT?.type?.in ?? []);
        return this.events.filter((e) => {
          if (where.height !== undefined && e.height !== where.height) return false;
          if (where.module !== undefined && e.module !== where.module) return false;
          if (types.size > 0 && !types.has(e.type)) return false;
          if (where.NOT && notInTypes.has(e.type)) return false;
          return true;
        });
      },
    };
    this.rewardEpochProjection = {
      upsert: async (args) => upsertMap(this.epochs, args.where.epochNumber.toString(), args),
    };
    this.rewardClaimEvent = {
      upsert: async (args) => upsertMap(this.claims, args.where.sourceEventId.toString(), args),
    };
    this.slotRewardProjection = {
      findMany: async (args) => {
        const w = args?.where ?? {};
        return this.slotRewards.filter((r) => {
          if (w.slotId !== undefined && r.slotId !== w.slotId) return false;
          if (w.epochNumber?.gte !== undefined && r.epochNumber < w.epochNumber.gte) return false;
          if (w.epochNumber?.lte !== undefined && r.epochNumber > w.epochNumber.lte) return false;
          return true;
        });
      },
      findUnique: async (args) => {
        const k = args.where.slotId_epochNumber;
        return this.slotRewards.find((r) => r.slotId === k.slotId && r.epochNumber === k.epochNumber) ?? null;
      },
      update: async (args) => {
        const row = this.slotRewards.find((r) => r.id === args.where.id);
        if (row) Object.assign(row, args.data);
        return row;
      },
      upsert: async (args) => {
        const k = args.where.slotId_epochNumber;
        const row = this.slotRewards.find((r) => r.slotId === k.slotId && r.epochNumber === k.epochNumber);
        if (row) {
          Object.assign(row, args.update);
          return row;
        }
        const created = { id: this.nextSlotRewardId, ...args.create };
        this.nextSlotRewardId += 1n;
        this.slotRewards.push(created);
        return created;
      },
    };
    this.rewardsParamsChange = {
      upsert: async (args) => {
        const w = args.where;
        const match = (r) =>
          (w.sourceEventId !== undefined && r.sourceEventId === w.sourceEventId)
          || (w.sourceMessageId !== undefined && r.sourceMessageId === w.sourceMessageId);
        const row = this.paramsChanges.find(match);
        if (row) {
          Object.assign(row, args.update);
          return row;
        }
        const created = { id: this.nextParamsId, ...args.create };
        this.nextParamsId += 1n;
        this.paramsChanges.push(created);
        return created;
      },
    };
    this.rewardsTreasuryPayment = {
      upsert: async (args) => upsertMap(this.treasury, args.where.sourceEventId.toString(), args),
    };
    this.rewardsBalanceSample = {
      upsert: async (args) => {
        const key = args.where.sampleKey;
        const row = this.balanceSamples.find((b) => b.sampleKey === key);
        if (row) { Object.assign(row, args.update); return row; }
        this.balanceSamples.push({ ...args.create });
        return args.create;
      },
    };
    this.coreSlotProjection = {
      findMany: async () => [],
    };
    this.projectionFailure = {
      upsert: async (args) => {
        const i = this.failures.findIndex((f) => f.failureKey === args.where.failureKey);
        if (i >= 0) { this.failures[i] = { ...this.failures[i], ...args.update }; return this.failures[i]; }
        this.failures.push({ ...args.create });
        return args.create;
      },
      deleteMany: async (args) => {
        const w = args?.where ?? {};
        const inNames = w.projectionName?.in ? new Set(w.projectionName.in) : null;
        this.failures = this.failures.filter((f) => {
          if (inNames) return !inNames.has(f.projectionName);
          if (w.projectionName !== undefined && f.projectionName !== w.projectionName) return true;
          if (w.sourceHeight !== undefined && f.sourceHeight !== w.sourceHeight) return true;
          if (w.resolved !== undefined && f.resolved !== w.resolved) return true;
          return false;
        });
        return { count: 0 };
      },
    };
    this.projectionCursor = {
      upsert: async (args) => {
        const key = cursorKey(args.where.projectionName_chainId ?? args.create);
        const existing = this.cursors.get(key);
        this.cursors.set(key, existing ? { ...existing, ...args.update } : { ...args.create });
        return this.cursors.get(key);
      },
      deleteMany: async (args) => {
        const inNames = args?.where?.projectionName?.in ? new Set(args.where.projectionName.in) : null;
        for (const [k, c] of [...this.cursors.entries()]) {
          if (inNames && inNames.has(c.projectionName)) this.cursors.delete(k);
        }
        return { count: 0 };
      },
    };

    // reset model deleteMany hooks
    for (const [field, store] of [
      ['rewardEpochProjection', 'epochs'],
      ['rewardClaimEvent', 'claims'],
      ['rewardsTreasuryPayment', 'treasury'],
    ]) {
      this[field].deleteMany = async () => { this[store].clear(); return { count: 0 }; };
    }
    this.slotRewardProjection.deleteMany = async () => { this.slotRewards = []; return { count: 0 }; };
    this.rewardsParamsChange.deleteMany = async () => { this.paramsChanges = []; return { count: 0 }; };
    this.rewardsBalanceSample.deleteMany = async () => { this.balanceSamples = []; return { count: 0 }; };
  }

  async $transaction(fn) {
    return fn(this);
  }

  seedSlotReward(row) {
    this.slotRewards.push({ id: this.nextSlotRewardId, claimed: false, denom: 'utwlt', ...row });
    this.nextSlotRewardId += 1n;
  }

  seedCursor(projectionName, height) {
    this.cursors.set(`${projectionName}:${CHAIN_ID}`, {
      projectionName, chainId: CHAIN_ID, lastProjectedHeight: height, status: 'idle',
    });
  }
}

function upsertMap(map, key, args) {
  const existing = map.get(key);
  const next = existing ? { ...existing, ...args.update } : { ...args.create };
  map.set(key, next);
  return next;
}

function cursorKey(value) {
  return `${value.projectionName}:${value.chainId}`;
}
