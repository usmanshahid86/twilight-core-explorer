import { createPrismaClient } from '@twilight-explorer/db';
import { withProjectionAdvisoryLock } from './advisory-lock.js';
import { getOrCreateProjectionCursor } from './cursor.js';
import {
  projectCoreSlotLivenessSummary,
  type CoreSlotLivenessSummaryProjectionPrisma,
} from './coreslot-liveness-summary.js';
import {
  resetCoreSlotLivenessSummaryProjection,
  type ResetCoreSlotLivenessSummaryProjectionPrisma,
} from './reset-coreslot-liveness-summary.js';
import { CORESLOT_LIVENESS_SUMMARY_PROJECTION } from './types.js';

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for coreslot liveness summary projection');
  }

  const chainId = process.env.CHAIN_ID ?? 'twilight-localnet-1';
  const prisma = createPrismaClient();

  try {
    await withProjectionAdvisoryLock(prisma, async () => {
      if (process.env.RESET_PROJECTION === 'true') {
        await resetCoreSlotLivenessSummaryProjection(
          prisma as unknown as ResetCoreSlotLivenessSummaryProjectionPrisma,
        );
      }

      // Cursor exists for observability/lag; the projection is a full recompute over evidence.
      await getOrCreateProjectionCursor(prisma, CORESLOT_LIVENESS_SUMMARY_PROJECTION, chainId);
      const endHeight = parseOptionalHeight(process.env.END_HEIGHT);

      await projectCoreSlotLivenessSummary({
        prisma: prisma as unknown as CoreSlotLivenessSummaryProjectionPrisma,
        chainId,
        endHeight,
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

function parseOptionalHeight(value: string | undefined): bigint | undefined {
  if (!value?.trim()) return undefined;
  return BigInt(value);
}
