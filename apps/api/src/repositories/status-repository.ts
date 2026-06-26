// Indexer + projection status reads. DB-only: the chain tip is whatever the indexer last observed
// and persisted on IndexerCursor (no live RPC). Single-chain deployment -> one IndexerCursor row.

import type { PrismaClient } from '@twilight-explorer/db';

export async function getIndexerCursor(prisma: PrismaClient) {
  return prisma.indexerCursor.findFirst({ orderBy: { updatedAt: 'desc' } });
}

export async function getProjectionCursors(prisma: PrismaClient) {
  return prisma.projectionCursor.findMany({ orderBy: { projectionName: 'asc' } });
}

export async function getUnresolvedFailureCounts(prisma: PrismaClient) {
  return prisma.projectionFailure.groupBy({
    by: ['projectionName'],
    where: { resolved: false },
    _count: { _all: true },
  });
}
