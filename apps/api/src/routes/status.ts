import type { FastifyInstance } from 'fastify';
import { ApiStatusResponse, toIndexerStatus, toProjectionStatus } from '../dto/status.js';
import {
  getIndexerCursor,
  getProjectionCursors,
  getUnresolvedFailureCounts,
} from '../repositories/status-repository.js';

export async function statusRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/status',
    { schema: { tags: ['status'], summary: 'Indexer and projection status', response: { 200: ApiStatusResponse } } },
    async () => {
      const [cursor, projections, failureGroups] = await Promise.all([
        getIndexerCursor(app.prisma),
        getProjectionCursors(app.prisma),
        getUnresolvedFailureCounts(app.prisma),
      ]);

      const byProjection = failureGroups.map((g) => ({
        projectionName: g.projectionName,
        count: g._count._all,
      }));
      const unresolvedCount = byProjection.reduce((sum, p) => sum + p.count, 0);

      return {
        data: {
          chainId: cursor?.chainId ?? null,
          build: app.buildInfo,
          indexer: cursor ? toIndexerStatus(cursor) : null,
          projections: projections.map(toProjectionStatus),
          projectionFailures: { unresolvedCount, byProjection },
        },
      };
    },
  );
}
