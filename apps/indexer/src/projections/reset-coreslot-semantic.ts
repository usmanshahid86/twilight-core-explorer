import { createPrismaClient } from '@twilight-explorer/db';
import {
  resetCoreSlotSemanticProjections,
  type ResetCoreSlotSemanticPrisma,
} from './reset-semantic.js';

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for the CoreSlot semantic projection reset');
  }

  const prisma = createPrismaClient();
  try {
    await resetCoreSlotSemanticProjections(prisma as unknown as ResetCoreSlotSemanticPrisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
