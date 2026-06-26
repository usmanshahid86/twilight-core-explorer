// Prisma lifecycle. Decorates the ROOT instance (not a sub-plugin) so `app.prisma` is visible to all
// routes without pulling in fastify-plugin. One client per process; disconnected on close. The client
// is the ONLY transport this service has — there is no chain client anywhere in apps/api.

import { createPrismaClient } from '@twilight-explorer/db';
import type { PrismaClient } from '@twilight-explorer/db';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export interface AttachPrismaOptions {
  /** Inject a client (tests pass a mock). When omitted, the plugin owns a real client and disconnects it. */
  prisma?: PrismaClient;
  /** Datasource URL for the owned client (the API's API_DATABASE_URL). Ignored when `prisma` is injected. */
  databaseUrl?: string;
}

export function attachPrisma(app: FastifyInstance, opts: AttachPrismaOptions = {}): void {
  const injected = opts.prisma;
  const client = injected ?? createPrismaClient(opts.databaseUrl);
  const ownsClient = injected === undefined;

  app.decorate('prisma', client);
  app.addHook('onClose', async () => {
    if (ownsClient) {
      await client.$disconnect();
    }
  });
}
