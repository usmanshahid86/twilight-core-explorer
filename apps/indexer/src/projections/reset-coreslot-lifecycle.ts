import { createPrismaClient } from '@twilight-explorer/db';
import {
  resetCoreSlotLifecycleProjection,
  type ResetLifecycleProjectionPrisma,
} from './reset-lifecycle.js';

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for CoreSlot lifecycle projection reset');
  }

  const prisma = createPrismaClient();
  try {
    await resetCoreSlotLifecycleProjection(prisma as unknown as ResetLifecycleProjectionPrisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
