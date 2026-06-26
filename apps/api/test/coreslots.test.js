import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildServer } from '../dist/server.js';
import {
  MockPrisma,
  testConfig,
  coreSlot,
  lifecycleEvent,
  metadataChange,
  payoutChange,
  keyRotation,
  consensusWindow,
  livenessSummary,
  healthSnapshot,
  block,
} from './mock-prisma.js';

const build = (data) => buildServer({ config: testConfig, prisma: new MockPrisma(data) });

describe('coreslots list/detail', () => {
  it('lists slotId ASC with keyset pagination (N+1)', async () => {
    const app = await build({ coreSlots: [coreSlot(3), coreSlot(1), coreSlot(2)] });
    const res = await app.inject({ url: '/api/v1/coreslots?limit=2' });
    assert.deepEqual(res.json().data.map((s) => s.slotId), ['1', '2']);
    assert.ok(res.json().page.nextCursor);
    const res2 = await app.inject({
      url: `/api/v1/coreslots?limit=2&cursor=${encodeURIComponent(res.json().page.nextCursor)}`,
    });
    assert.deepEqual(res2.json().data.map((s) => s.slotId), ['3']);
    assert.equal(res2.json().page.nextCursor, null);
    await app.close();
  });

  it('filters by status and operatorAddress', async () => {
    const app = await build({
      coreSlots: [coreSlot(1, { status: 'ACTIVE' }), coreSlot(2, { status: 'INACTIVE' })],
    });
    const res = await app.inject({ url: '/api/v1/coreslots?status=INACTIVE' });
    assert.deepEqual(res.json().data.map((s) => s.slotId), ['2']);
    await app.close();
  });

  it('detail includes semantic state + health quick fields', async () => {
    const app = await build({ coreSlots: [coreSlot(2)], healthSnapshots: [healthSnapshot(2)] });
    const res = await app.inject({ url: '/api/v1/coreslots/2' });
    assert.equal(res.statusCode, 200);
    const d = res.json().data;
    assert.equal(d.slotId, '2');
    assert.equal(d.consensusPower, '10'); // BigInt as string
    assert.equal(d.health.healthStatus, 'healthy');
    assert.equal(d.health.uptimeBps, 10000);
    assert.equal(d.raw, undefined);
    await app.close();
  });

  it('detail health is null when no snapshot; include=raw adds rawSnapshotJson', async () => {
    const app = await build({ coreSlots: [coreSlot(2)] });
    const res = await app.inject({ url: '/api/v1/coreslots/2?include=raw' });
    assert.equal(res.json().data.health, null);
    assert.deepEqual(res.json().data.raw, { slotId: 2 });
    await app.close();
  });

  it('400 invalid_slot_id for a non-numeric id; 404 for a missing slot', async () => {
    const app = await build({ coreSlots: [coreSlot(1)] });
    const bad = await app.inject({ url: '/api/v1/coreslots/abc' });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.json().error.code, 'invalid_slot_id');
    const missing = await app.inject({ url: '/api/v1/coreslots/999' });
    assert.equal(missing.statusCode, 404);
    await app.close();
  });
});

describe('coreslot events', () => {
  it('merges lifecycle/metadata/payout newest-first with a composite cursor', async () => {
    const app = await build({
      coreSlots: [coreSlot(1)],
      lifecycleEvents: [lifecycleEvent(1, 10, 1)],
      metadataChanges: [metadataChange(1, 10, 2)],
      payoutChanges: [payoutChange(1, 9, 3)],
    });
    const res = await app.inject({ url: '/api/v1/coreslots/1/events?limit=2' });
    assert.deepEqual(res.json().data.map((e) => e.kind), ['lifecycle', 'metadata']); // 10/lifecycle, 10/metadata
    assert.deepEqual(res.json().data.map((e) => e.height), ['10', '10']);
    assert.ok(res.json().page.nextCursor);

    const res2 = await app.inject({
      url: `/api/v1/coreslots/1/events?limit=2&cursor=${encodeURIComponent(res.json().page.nextCursor)}`,
    });
    assert.deepEqual(res2.json().data.map((e) => e.kind), ['payout']); // 9/payout
    assert.equal(res2.json().page.nextCursor, null);
    await app.close();
  });

  it('filters by kind', async () => {
    const app = await build({
      coreSlots: [coreSlot(1)],
      lifecycleEvents: [lifecycleEvent(1, 10, 1)],
      payoutChanges: [payoutChange(1, 9, 3)],
    });
    const res = await app.inject({ url: '/api/v1/coreslots/1/events?kind=payout' });
    assert.deepEqual(res.json().data.map((e) => e.kind), ['payout']);
    await app.close();
  });

  it('404 when the slot does not exist; 200 empty when the slot exists with no events', async () => {
    const app = await build({ coreSlots: [coreSlot(1)] });
    const missing = await app.inject({ url: '/api/v1/coreslots/999/events' });
    assert.equal(missing.statusCode, 404);
    const empty = await app.inject({ url: '/api/v1/coreslots/1/events' });
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(empty.json().data, []);
    assert.equal(empty.json().page.nextCursor, null);
    await app.close();
  });
});

describe('coreslot windows / key-rotations / proposed-blocks', () => {
  it('lists windows newest-first by effectiveFromHeight', async () => {
    const app = await build({
      coreSlots: [coreSlot(1)],
      windows: [consensusWindow(1, 1, 5, 52), consensusWindow(1, 2, 52, null)],
    });
    const res = await app.inject({ url: '/api/v1/coreslots/1/windows' });
    assert.deepEqual(res.json().data.map((w) => w.effectiveFromHeight), ['52', '5']);
    assert.equal(res.json().data[0].effectiveToHeight, null);
    await app.close();
  });

  it('lists key-rotations id DESC', async () => {
    const app = await build({
      coreSlots: [coreSlot(1)],
      keyRotations: [keyRotation(1, 1), keyRotation(1, 2)],
    });
    const res = await app.inject({ url: '/api/v1/coreslots/1/key-rotations' });
    assert.deepEqual(res.json().data.map((k) => k.id), ['2', '1']);
    assert.equal(res.json().data[0].status, 'applied');
    await app.close();
  });

  it('lists proposed-blocks height DESC with block time', async () => {
    const app = await build({
      coreSlots: [coreSlot(1)],
      attributions: [
        { height: 5n, slotId: 1n, proposerAddress: 'p', attributionStatus: 'attributed' },
        { height: 7n, slotId: 1n, proposerAddress: 'p', attributionStatus: 'attributed' },
      ],
      blocks: [block(5), block(7)],
    });
    const res = await app.inject({ url: '/api/v1/coreslots/1/proposed-blocks' });
    assert.deepEqual(res.json().data.map((b) => b.height), ['7', '5']);
    assert.equal(res.json().data[0].time, '2026-06-26T00:00:00.000Z');
    await app.close();
  });
});

describe('coreslot liveness / health', () => {
  it('returns liveness summaries (all window kinds), filterable by windowKind', async () => {
    const app = await build({
      coreSlots: [coreSlot(1)],
      livenessSummaries: [
        livenessSummary(1, 'lifetime'),
        livenessSummary(1, 'recent_100', { uptimeBps: 5900, missedCount: 41 }),
      ],
    });
    const all = await app.inject({ url: '/api/v1/coreslots/1/liveness' });
    assert.deepEqual(all.json().data.map((s) => s.windowKind).sort(), ['lifetime', 'recent_100']);
    const filtered = await app.inject({ url: '/api/v1/coreslots/1/liveness?windowKind=recent_100' });
    assert.equal(filtered.json().data.length, 1);
    assert.equal(filtered.json().data[0].uptimeBps, 5900);
    await app.close();
  });

  it('liveness 404 for missing slot, 200 empty for slot with no summaries', async () => {
    const app = await build({ coreSlots: [coreSlot(1)] });
    assert.equal((await app.inject({ url: '/api/v1/coreslots/999/liveness' })).statusCode, 404);
    const empty = await app.inject({ url: '/api/v1/coreslots/1/liveness' });
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(empty.json().data, []);
    await app.close();
  });

  it('returns health snapshot with status verbatim; 404 when absent', async () => {
    const app = await build({
      coreSlots: [coreSlot(1)],
      healthSnapshots: [healthSnapshot(1, { healthStatus: 'degraded', healthReason: 'low uptime' })],
    });
    const res = await app.inject({ url: '/api/v1/coreslots/1/health' });
    assert.equal(res.json().data.healthStatus, 'degraded');
    assert.equal(res.json().data.healthReason, 'low uptime');
    const absent = await app.inject({ url: '/api/v1/coreslots/2/health' });
    assert.equal(absent.statusCode, 404);
    await app.close();
  });
});
