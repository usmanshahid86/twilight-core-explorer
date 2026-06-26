// Liveness summaries + current health snapshot for a CoreSlot. Reads only the materialized 8c
// projection tables — never raw evidence.

import type { PrismaClient } from '@twilight-explorer/db';

export async function listLivenessSummaries(
  prisma: PrismaClient,
  params: { slotId: bigint; windowKind: string | undefined },
) {
  return prisma.coreSlotLivenessSummary.findMany({
    where: { slotId: params.slotId, ...(params.windowKind !== undefined ? { windowKind: params.windowKind } : {}) },
    orderBy: { windowKind: 'asc' },
  });
}

export async function getHealthSnapshot(prisma: PrismaClient, slotId: bigint) {
  return prisma.coreSlotHealthSnapshot.findFirst({ where: { slotId } });
}
