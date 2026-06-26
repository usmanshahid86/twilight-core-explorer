import type { FastifyInstance } from 'fastify';
import { ProjectionsResponse, toProjectionDiagnostic } from '../dto/projections.js';
import {
  getFailureKindCounts,
  getProjectionCursors,
} from '../repositories/projections-repository.js';

export async function projectionsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/projections',
    {
      schema: {
        tags: ['diagnostics'],
        summary: 'Per-projection cursor + unresolved-failure diagnostics',
        response: { 200: ProjectionsResponse },
      },
    },
    async () => {
      const [cursors, failures] = await Promise.all([
        getProjectionCursors(app.prisma),
        getFailureKindCounts(app.prisma),
      ]);
      return { data: cursors.map((c) => toProjectionDiagnostic(c, failures)) };
    },
  );
}
