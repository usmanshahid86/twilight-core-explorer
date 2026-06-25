import { createPrismaClient } from '@twilight-explorer/db';
import {
  resetCoreSlotLivenessSummaryProjection,
  type ResetCoreSlotLivenessSummaryProjectionPrisma,
} from './reset-coreslot-liveness-summary.js';

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for coreslot liveness summary reset');
  }

  const prisma = createPrismaClient();
  try {
    await resetCoreSlotLivenessSummaryProjection(
      prisma as unknown as ResetCoreSlotLivenessSummaryProjectionPrisma,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
