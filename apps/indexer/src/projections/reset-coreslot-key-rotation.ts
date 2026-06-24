import { createPrismaClient } from '@twilight-explorer/db';
import {
  resetCoreSlotKeyRotationProjection,
  type ResetKeyRotationProjectionPrisma,
} from './reset-key-rotation.js';

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for CoreSlot key rotation projection reset');
  }

  const prisma = createPrismaClient();
  try {
    await resetCoreSlotKeyRotationProjection(prisma as unknown as ResetKeyRotationProjectionPrisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
