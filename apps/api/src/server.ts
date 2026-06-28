// App factory. Kept separate from index.ts (which binds a port) so tests can construct the app and
// drive it via app.inject() with an injected mock Prisma — no DB and no open socket required.

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider, TypeBoxValidatorCompiler } from '@fastify/type-provider-typebox';
import type { PrismaClient } from '@twilight-explorer/db';
import type { ApiConfig } from './config.js';
import { registerErrorHandling } from './lib/errors.js';
import { attachPrisma } from './plugins/prisma.js';
import { registerCors } from './plugins/cors.js';
import { registerSecurityHeaders } from './plugins/security-headers.js';
import { registerRateLimit } from './plugins/rate-limit.js';
import { registerCacheControl } from './plugins/cache-control.js';
import { attachBuildInfo } from './plugins/build-info.js';
import { registerOpenapi } from './plugins/openapi.js';
import { healthRoutes } from './routes/health.js';
import { statusRoutes } from './routes/status.js';
import { blocksRoutes } from './routes/blocks.js';
import { transactionsRoutes } from './routes/transactions.js';
import { accountsRoutes } from './routes/accounts.js';
import { searchRoutes } from './routes/search.js';
import { decodeFailuresRoutes } from './routes/decode-failures.js';
import { projectionsRoutes } from './routes/projections.js';
import { coreslotsRoutes } from './routes/coreslots.js';
import { networkRoutes } from './routes/network.js';
import { rewardsRoutes } from './routes/rewards.js';
import { balancesRoutes } from './routes/balances.js';

export interface BuildServerOptions {
  config: ApiConfig;
  /** Inject a (mock) Prisma client. When omitted the server owns a real client. */
  prisma?: PrismaClient;
  logger?: boolean;
}

export async function buildServer(opts: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false })
    .setValidatorCompiler(TypeBoxValidatorCompiler)
    .withTypeProvider<TypeBoxTypeProvider>();

  registerErrorHandling(app);
  // Transport hardening (13c): headers first, then CORS (so a rate-limited 429 still carries CORS
  // headers), then the per-IP limiter, then ETag + Cache-Control. All additive — envelopes unchanged.
  await registerSecurityHeaders(app, opts.config);
  await registerCors(app, opts.config);
  await registerRateLimit(app, opts.config);
  await registerCacheControl(app);
  attachPrisma(
    app,
    opts.prisma !== undefined ? { prisma: opts.prisma } : { databaseUrl: opts.config.databaseUrl },
  );
  attachBuildInfo(app, opts.config.env); // build/env metadata for /status — no chain access
  await registerOpenapi(app, opts.config); // before routes: collects their schemas

  await app.register(healthRoutes);
  await app.register(statusRoutes, { prefix: '/api/v1' });
  await app.register(blocksRoutes, { prefix: '/api/v1' });
  await app.register(transactionsRoutes, { prefix: '/api/v1' });
  await app.register(accountsRoutes, { prefix: '/api/v1' });
  await app.register(searchRoutes, { prefix: '/api/v1' });
  await app.register(decodeFailuresRoutes, { prefix: '/api/v1' });
  await app.register(projectionsRoutes, { prefix: '/api/v1' });
  await app.register(coreslotsRoutes, { prefix: '/api/v1' });
  await app.register(networkRoutes, { prefix: '/api/v1' });
  await app.register(rewardsRoutes, { prefix: '/api/v1' });
  await app.register(balancesRoutes, { prefix: '/api/v1' });

  return app;
}
