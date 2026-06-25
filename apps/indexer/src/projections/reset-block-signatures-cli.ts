import { createPrismaClient } from '@twilight-explorer/db';
import {
  resetBlockSignaturesProjection,
  type ResetBlockSignaturesProjectionPrisma,
} from './reset-block-signatures.js';

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for block signature projection reset');
  }

  const prisma = createPrismaClient();
  try {
    await resetBlockSignaturesProjection(
      prisma as unknown as ResetBlockSignaturesProjectionPrisma,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
