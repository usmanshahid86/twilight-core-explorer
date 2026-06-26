export { PrismaClient } from '@prisma/client';
import { PrismaClient } from '@prisma/client';

/**
 * Create a Prisma client. With no argument the datasource URL comes from the schema's
 * env("DATABASE_URL") (the indexer's behavior, unchanged). Pass an explicit URL to override it —
 * the API uses this to connect with its own API_DATABASE_URL (a read-only role).
 */
export function createPrismaClient(databaseUrl?: string): PrismaClient {
  return databaseUrl === undefined
    ? new PrismaClient()
    : new PrismaClient({ datasourceUrl: databaseUrl });
}
