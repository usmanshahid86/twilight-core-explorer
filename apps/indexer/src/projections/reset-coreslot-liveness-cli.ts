import { createPrismaClient } from '@twilight-explorer/db';
import {
  resetCoreSlotLivenessProjection,
  type ResetCoreSlotLivenessProjectionPrisma,
} from './reset-coreslot-liveness.js';

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for coreslot liveness reset');
  }

  const prisma = createPrismaClient();
  try {
    await resetCoreSlotLivenessProjection(
      prisma as unknown as ResetCoreSlotLivenessProjectionPrisma,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
