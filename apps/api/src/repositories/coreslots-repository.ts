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

/** Merge lifecycle/metadata/payout into one newest-first feed (≤ limit+1 candidates returned).
 *  The cursor predicate is pushed into EACH per-kind query (not applied post-fetch), so deep pages
 *  can't skip older rows that share a height with more than limit+1 newer rows of the same kind. */
export async function listSlotEvents(
  prisma: PrismaClient,
  params: { slotId: bigint; cursor: EventCursor | undefined; kind: EventKind | undefined; limit: number },
): Promise<EventCandidate[]> {
  const want = params.limit + 1;
  const kinds: EventKind[] = params.kind ? [params.kind] : [...EVENT_KINDS];

  const perTable = await Promise.all(
    kinds.map((kind) => fetchKind(prisma, kind, params.slotId, params.cursor, want)),
  );

  const candidates = perTable.flat();
  candidates.sort(compareDesc);
  return candidates.slice(0, want);
}

function compareDesc(a: EventCandidate, b: EventCandidate): number {
  if (a.height !== b.height) return a.height > b.height ? -1 : 1;
  if (a.kind !== b.kind) return kindRank(a.kind) - kindRank(b.kind);
  return a.id > b.id ? -1 : a.id < b.id ? 1 : 0;
}

/** WHERE fragment selecting this kind's rows strictly AFTER the cursor in the global
 *  (height desc, kindRank, id desc) ordering. Spread into the per-kind query. */
function cursorFilter(kind: EventKind, cursor: EventCursor | undefined) {
  if (!cursor) return {};
  const sameHeightClause =
    kind === cursor.kind
      ? [{ height: cursor.height, id: { lt: cursor.id } }]
      : kindRank(kind) > kindRank(cursor.kind)
        ? [{ height: cursor.height }]
        : [];
  return { OR: [{ height: { lt: cursor.height } }, ...sameHeightClause] };
}

async function fetchKind(
  prisma: PrismaClient,
  kind: EventKind,
  slotId: bigint,
  cursor: EventCursor | undefined,
  take: number,
): Promise<EventCandidate[]> {
  const orderBy = [{ height: 'desc' as const }, { id: 'desc' as const }];
  if (kind === 'lifecycle') {
    const rows = await prisma.coreSlotLifecycleEvent.findMany({
      where: { slotId, ...cursorFilter(kind, cursor) },
      orderBy,
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
      where: { slotId, ...cursorFilter(kind, cursor) },
      orderBy,
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
    where: { slotId, ...cursorFilter(kind, cursor) },
    orderBy,
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
