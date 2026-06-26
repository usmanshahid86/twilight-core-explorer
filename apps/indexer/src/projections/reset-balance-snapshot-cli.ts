import { createPrismaClient } from '@twilight-explorer/db';
import {
  resetBalanceSnapshotProjection,
  type ResetBalanceSnapshotPrisma,
} from './reset-balance-snapshot.js';

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for the balance snapshot projection reset');
  }

  const prisma = createPrismaClient();
  try {
    await resetBalanceSnapshotProjection(prisma as unknown as ResetBalanceSnapshotPrisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
