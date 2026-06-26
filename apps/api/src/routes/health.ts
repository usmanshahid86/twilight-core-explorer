import type { FastifyInstance } from 'fastify';
import { HealthLiveResponse, HealthReadyResponse } from '../dto/health.js';
import { ErrorResponse } from '../dto/common.js';
import { checkDatabase, checkMigrations } from '../repositories/health-repository.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // Liveness: the process can respond. Intentionally touches NO DB.
  app.get(
    '/health/live',
    { schema: { tags: ['health'], summary: 'Liveness probe', response: { 200: HealthLiveResponse } } },
    async () => ({ data: { status: 'live' as const } }),
  );

  // Readiness: DB connectivity + a clean Prisma migration ledger. 503 (error envelope) when not ready.
  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['health'],
        summary: 'Readiness probe',
        response: { 200: HealthReadyResponse, 503: ErrorResponse },
      },
    },
    async (_request, reply) => {
      const databaseOk = await checkDatabase(app.prisma);
      const migrations = databaseOk ? await checkMigrations(app.prisma) : 'error';

      if (databaseOk && migrations === 'ok') {
        return { data: { status: 'ready' as const, checks: { database: 'ok' as const, migrations: 'ok' as const } } };
      }

      return reply.code(503).send({
        error: {
          code: 'not_ready',
          message: 'service not ready',
          details: { database: databaseOk ? 'ok' : 'error', migrations },
        },
      });
    },
  );
}
