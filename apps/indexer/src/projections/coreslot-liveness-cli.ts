import { createPrismaClient } from '@twilight-explorer/db';
import { withProjectionAdvisoryLock } from './advisory-lock.js';
import { getOrCreateProjectionCursor } from './cursor.js';
import {
  projectCoreSlotLivenessRange,
  type CoreSlotLivenessProjectionPrisma,
} from './coreslot-liveness.js';
import {
  resetCoreSlotLivenessProjection,
  type ResetCoreSlotLivenessProjectionPrisma,
} from './reset-coreslot-liveness.js';
import { CORESLOT_LIVENESS_PROJECTION } from './types.js';

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for coreslot liveness projection');
  }

  const chainId = process.env.CHAIN_ID ?? 'twilight-localnet-1';
  const prisma = createPrismaClient();

  try {
    await withProjectionAdvisoryLock(prisma, async () => {
      if (process.env.RESET_PROJECTION === 'true') {
        await resetCoreSlotLivenessProjection(
          prisma as unknown as ResetCoreSlotLivenessProjectionPrisma,
        );
      }

      const cursor = await getOrCreateProjectionCursor(
        prisma,
        CORESLOT_LIVENESS_PROJECTION,
        chainId,
      );
      const startHeight = parseOptionalHeight(process.env.START_HEIGHT)
        ?? parseHeight(asRecord(cursor).lastProjectedHeight) + 1n;
      const endHeight = parseOptionalHeight(process.env.END_HEIGHT)
        ?? await getMaxSourceBlockHeight(prisma as unknown as EvidenceAggregatePrisma);

      if (endHeight < startHeight) return;

      await projectCoreSlotLivenessRange({
        prisma: prisma as unknown as CoreSlotLivenessProjectionPrisma,
        chainId,
        startHeight,
        endHeight,
      });
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

interface EvidenceAggregatePrisma {
  operatorSigningEvidence: {
    aggregate(args: unknown): Promise<{ _max?: { sourceBlockHeight?: bigint | null } | undefined }>;
  };
}

async function getMaxSourceBlockHeight(prisma: EvidenceAggregatePrisma): Promise<bigint> {
  const result = await prisma.operatorSigningEvidence.aggregate({
    _max: { sourceBlockHeight: true },
  });
  return result._max?.sourceBlockHeight ?? 0n;
}

function parseOptionalHeight(value: string | undefined): bigint | undefined {
  if (!value?.trim()) return undefined;
  return BigInt(value);
}

function parseHeight(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string' && value.trim()) return BigInt(value);
  return 0n;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
