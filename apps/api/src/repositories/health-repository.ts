// Readiness checks. Read-only and safe under a read-only DB role: a connectivity probe plus a read
// of the Prisma migration ledger. The API never APPLIES migrations — it only verifies them.

import type { PrismaClient } from '@twilight-explorer/db';

export type MigrationState = 'ok' | 'failed' | 'error';

export async function checkDatabase(prisma: PrismaClient): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/** 'ok' = all migrations applied cleanly; 'failed' = a rolled-back or stuck row exists; 'error' =
 *  the ledger could not be read. */
export async function checkMigrations(prisma: PrismaClient): Promise<MigrationState> {
  try {
    const rows = await prisma.$queryRaw<Array<{ failed: number }>>`
      SELECT count(*)::int AS failed
      FROM _prisma_migrations
      WHERE rolled_back_at IS NOT NULL
         OR (finished_at IS NULL AND rolled_back_at IS NULL)
    `;
    const failed = Number(rows[0]?.failed ?? 0);
    return failed > 0 ? 'failed' : 'ok';
  } catch {
    return 'error';
  }
}
