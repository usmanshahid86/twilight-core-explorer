import { createPrismaClient } from '@twilight-explorer/db';
import {
  resetProposerAttributionProjection,
  type ResetProposerAttributionProjectionPrisma,
} from './reset-proposer-attribution.js';

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for proposer attribution reset');
  }

  const prisma = createPrismaClient();
  try {
    await resetProposerAttributionProjection(
      prisma as unknown as ResetProposerAttributionProjectionPrisma,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
