import { createPrismaClient } from '@twilight-explorer/db';
import {
  resetRewardsProjections,
  type ResetRewardsProjectionPrisma,
} from './reset-rewards.js';

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for the rewards projection reset');
  }

  const prisma = createPrismaClient();
  try {
    await resetRewardsProjections(prisma as unknown as ResetRewardsProjectionPrisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
