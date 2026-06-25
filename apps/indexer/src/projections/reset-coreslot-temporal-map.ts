import { createPrismaClient } from '@twilight-explorer/db';
import {
  resetCoreSlotTemporalMapProjection,
  type ResetTemporalMapProjectionPrisma,
} from './reset-temporal-map.js';

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for CoreSlot temporal map projection reset');
  }

  const prisma = createPrismaClient();
  try {
    await resetCoreSlotTemporalMapProjection(
      prisma as unknown as ResetTemporalMapProjectionPrisma,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
