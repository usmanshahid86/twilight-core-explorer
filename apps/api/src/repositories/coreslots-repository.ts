// CoreSlot reads. The unified /events feed merges three single-height histories (lifecycle, metadata,
// payout) with an over-fetch + in-memory merge so the composite cursor [height, kind, eventId] stays
// stable. Key-rotations (multi-phase heights) and params (network-scoped) are NOT in this feed.

import type { PrismaClient } from '@twilight-explorer/db';
import { EVENT_KINDS } from '../dto/coreslots.js';
import type { EventCandidate, EventKind } from '../dto/coreslots.js';

const kindRank = (k: EventKind): number => EVENT_KINDS.indexOf(k);

export async function listCoreSlots(
  prisma: PrismaClient,
  params: {
    afterSlotId: bigint | undefined;
    status: string | undefined;
    operatorAddress: string | undefined;
    consensusAddress: string | undefined;
    payoutAddress: string | undefined;
    limit: number;
  },
) {
  return prisma.coreSlotProjection.findMany({
    where: {
      ...(params.status !== undefined ? { status: params.status } : {}),
      ...(params.operatorAddress !== undefined ? { operatorAddress: params.operatorAddress } : {}),
      ...(params.consensusAddress !== undefined ? { consensusAddress: params.consensusAddress } : {}),
      ...(params.payoutAddress !== undefined ? { payoutAddress: params.payoutAddress } : {}),
      ...(params.afterSlotId !== undefined ? { slotId: { gt: params.afterSlotId } } : {}),
    },
    orderBy: { slotId: 'asc' },
    take: params.limit,
  });
}

export async function getCoreSlot(prisma: PrismaClient, slotId: bigint) {
  return prisma.coreSlotProjection.findUnique({ where: { slotId } });
}

export interface EventCursor {
  height: bigint;
  kind: EventKind;
  id: bigint;
}

/** Merge lifecycle/metadata/payout into one newest-first feed (≤ limit+1 candidates returned). */
export async function listSlotEvents(
  prisma: PrismaClient,
  params: { slotId: bigint; cursor: EventCursor | undefined; kind: EventKind | undefined; limit: number },
): Promise<EventCandidate[]> {
  const want = params.limit + 1;
  const kinds: EventKind[] = params.kind ? [params.kind] : [...EVENT_KINDS];
  const heightFilter = params.cursor ? { height: { lte: params.cursor.height } } : {};

  const perTable = await Promise.all(
    kinds.map((kind) => fetchKind(prisma, kind, params.slotId, heightFilter, want)),
  );

  let candidates = perTable.flat();
  if (params.cursor) {
    const c = params.cursor;
    candidates = candidates.filter((e) => isAfter(e, c));
  }
  candidates.sort(compareDesc);
  return candidates.slice(0, want);
}

function isAfter(e: EventCandidate, c: EventCursor): boolean {
  if (e.height !== c.height) return e.height < c.height;
  if (e.kind !== c.kind) return kindRank(e.kind) > kindRank(c.kind);
  return e.id < c.id;
}

function compareDesc(a: EventCandidate, b: EventCandidate): number {
  if (a.height !== b.height) return a.height > b.height ? -1 : 1;
  if (a.kind !== b.kind) return kindRank(a.kind) - kindRank(b.kind);
  return a.id > b.id ? -1 : a.id < b.id ? 1 : 0;
}

async function fetchKind(
  prisma: PrismaClient,
  kind: EventKind,
  slotId: bigint,
  heightFilter: object,
  take: number,
): Promise<EventCandidate[]> {
  if (kind === 'lifecycle') {
    const rows = await prisma.coreSlotLifecycleEvent.findMany({
      where: { slotId, ...heightFilter },
      orderBy: [{ height: 'desc' }, { id: 'desc' }],
      take,
    });
    return rows.map((r) => ({
      kind,
      height: r.height,
      id: r.id,
      txHash: r.txHash,
      msgIndex: r.msgIndex,
      detail: {
        eventType: r.eventType,
        oldStatus: r.oldStatus,
        newStatus: r.newStatus,
        operatorAddress: r.operatorAddress,
        consensusAddress: r.consensusAddress,
        power: r.power === null ? null : r.power.toString(),
        reason: r.reason,
        authority: r.authority,
      },
    }));
  }
  if (kind === 'metadata') {
    const rows = await prisma.coreSlotMetadataChange.findMany({
      where: { slotId, ...heightFilter },
      orderBy: [{ height: 'desc' }, { id: 'desc' }],
      take,
    });
    return rows.map((r) => ({
      kind,
      height: r.height,
      id: r.id,
      txHash: r.txHash,
      msgIndex: r.msgIndex,
      detail: { operatorAddress: r.operatorAddress, metadata: r.metadataJson },
    }));
  }
  const rows = await prisma.coreSlotPayoutChange.findMany({
    where: { slotId, ...heightFilter },
    orderBy: [{ height: 'desc' }, { id: 'desc' }],
    take,
  });
  return rows.map((r) => ({
    kind,
    height: r.height,
    id: r.id,
    txHash: r.txHash,
    msgIndex: r.msgIndex,
    detail: { operatorAddress: r.operatorAddress, newPayoutAddress: r.newPayoutAddress },
  }));
}

export async function listWindows(
  prisma: PrismaClient,
  params: { slotId: bigint; beforeFrom: bigint | undefined; beforeId: bigint | undefined; limit: number },
) {
  return prisma.coreSlotConsensusWindow.findMany({
    where: {
      slotId: params.slotId,
      ...(params.beforeFrom !== undefined && params.beforeId !== undefined
        ? {
            OR: [
              { effectiveFromHeight: { lt: params.beforeFrom } },
              { effectiveFromHeight: params.beforeFrom, id: { lt: params.beforeId } },
            ],
          }
        : {}),
    },
    orderBy: [{ effectiveFromHeight: 'desc' }, { id: 'desc' }],
    take: params.limit,
  });
}

export async function listKeyRotations(
  prisma: PrismaClient,
  params: { slotId: bigint; beforeId: bigint | undefined; limit: number },
) {
  return prisma.coreSlotConsensusKeyRotation.findMany({
    where: { slotId: params.slotId, ...(params.beforeId !== undefined ? { id: { lt: params.beforeId } } : {}) },
    orderBy: { id: 'desc' },
    take: params.limit,
  });
}

export async function listProposedBlocks(
  prisma: PrismaClient,
  params: { slotId: bigint; beforeHeight: bigint | undefined; limit: number },
) {
  return prisma.blockProposerAttribution.findMany({
    where: {
      slotId: params.slotId,
      ...(params.beforeHeight !== undefined ? { height: { lt: params.beforeHeight } } : {}),
    },
    orderBy: { height: 'desc' },
    take: params.limit,
  });
}

export async function getBlockTimes(
  prisma: PrismaClient,
  heights: bigint[],
): Promise<Map<bigint, Date | null>> {
  if (heights.length === 0) return new Map();
  const rows = await prisma.block.findMany({
    where: { height: { in: heights } },
    select: { height: true, time: true },
  });
  return new Map(rows.map((r) => [r.height, r.time]));
}
