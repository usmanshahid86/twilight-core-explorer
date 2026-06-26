// Projection diagnostics reads. Cursors + unresolved-failure counts grouped by (projection, kind).
// Reads ONLY ProjectionCursor + ProjectionFailure — no raw signature/liveness evidence.

import type { PrismaClient } from '@twilight-explorer/db';

export async function getProjectionCursors(prisma: PrismaClient) {
  return prisma.projectionCursor.findMany({ orderBy: { projectionName: 'asc' } });
}

export async function getFailureKindCounts(prisma: PrismaClient) {
  const grouped = await prisma.projectionFailure.groupBy({
    by: ['projectionName', 'failureKind'],
    where: { resolved: false },
    _count: { _all: true },
  });
  return grouped.map((g) => ({
    projectionName: g.projectionName,
    failureKind: g.failureKind,
    count: g._count._all,
  }));
}
