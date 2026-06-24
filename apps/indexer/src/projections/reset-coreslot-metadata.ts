import { createPrismaClient } from '@twilight-explorer/db';
import {
  resetCoreSlotMetadataProjection,
  type ResetProjectionPrisma,
} from './reset.js';

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for CoreSlot metadata projection reset');
  }

  const prisma = createPrismaClient();
  try {
    await resetCoreSlotMetadataProjection(prisma as unknown as ResetProjectionPrisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
