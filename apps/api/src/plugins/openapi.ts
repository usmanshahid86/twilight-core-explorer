// OpenAPI. @fastify/swagger collects each route's TypeBox schema into a spec; that spec is exported
// to docs/reference/openapi.json (committed contract) and guarded by a drift test. Swagger UI (/docs)
// is mounted only in non-prod. Must be registered BEFORE routes so the onRoute hook sees them.

import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import type { ApiConfig } from '../config.js';

export const OPENAPI_INFO = {
  title: 'Twilight Core Explorer API',
  description: 'Read-only public API for the Twilight Core explorer (Phase 9a foundation).',
  version: '0.1.0',
} as const;

export async function registerOpenapi(app: FastifyInstance, config: ApiConfig): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: OPENAPI_INFO,
      tags: [
        { name: 'health', description: 'Liveness and readiness probes' },
        { name: 'status', description: 'Indexer and projection status' },
        { name: 'blocks', description: 'Canonical blocks' },
      ],
    },
  });

  if (!config.isProduction) {
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }
}
