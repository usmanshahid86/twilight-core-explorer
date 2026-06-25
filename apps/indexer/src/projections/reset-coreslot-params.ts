import { createPrismaClient } from '@twilight-explorer/db';
import {
  resetCoreSlotParamsProjection,
  type ResetParamsProjectionPrisma,
} from './reset-params.js';

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for CoreSlot params projection reset');
  }

  const prisma = createPrismaClient();
  try {
    await resetCoreSlotParamsProjection(prisma as unknown as ResetParamsProjectionPrisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
