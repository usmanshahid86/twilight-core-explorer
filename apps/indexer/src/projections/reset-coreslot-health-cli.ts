import { createPrismaClient } from '@twilight-explorer/db';
import {
  resetCoreSlotHealthProjection,
  type ResetCoreSlotHealthProjectionPrisma,
} from './reset-coreslot-health.js';

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for coreslot health reset');
  }

  const prisma = createPrismaClient();
  try {
    await resetCoreSlotHealthProjection(
      prisma as unknown as ResetCoreSlotHealthProjectionPrisma,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
