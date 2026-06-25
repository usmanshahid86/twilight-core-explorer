import { createPrismaClient } from '@twilight-explorer/db';
import { withProjectionAdvisoryLock } from './advisory-lock.js';
import { getOrCreateProjectionCursor } from './cursor.js';
import {
  projectCoreSlotHealth,
  type CoreSlotHealthProjectionPrisma,
} from './coreslot-health.js';
import {
  resetCoreSlotHealthProjection,
  type ResetCoreSlotHealthProjectionPrisma,
} from './reset-coreslot-health.js';
import { CORESLOT_HEALTH_PROJECTION } from './types.js';

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for coreslot health projection');
  }

  const chainId = process.env.CHAIN_ID ?? 'twilight-localnet-1';
  const prisma = createPrismaClient();

  try {
    await withProjectionAdvisoryLock(prisma, async () => {
      if (process.env.RESET_PROJECTION === 'true') {
        await resetCoreSlotHealthProjection(
          prisma as unknown as ResetCoreSlotHealthProjectionPrisma,
        );
      }

      // Cursor exists for observability/lag; the projection is a full recompute over summaries.
      await getOrCreateProjectionCursor(prisma, CORESLOT_HEALTH_PROJECTION, chainId);

      await projectCoreSlotHealth({
        prisma: prisma as unknown as CoreSlotHealthProjectionPrisma,
        chainId,
      });
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
