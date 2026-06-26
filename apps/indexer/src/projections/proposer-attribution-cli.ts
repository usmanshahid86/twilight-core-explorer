import { createPrismaClient } from '@twilight-explorer/db';
import { withProjectionAdvisoryLock } from './advisory-lock.js';
import { getOrCreateProjectionCursor } from './cursor.js';
import {
  projectProposerAttributionRange,
  type ProposerAttributionProjectionPrisma,
} from './proposer-attribution.js';
import {
  resetProposerAttributionProjection,
  type ResetProposerAttributionProjectionPrisma,
} from './reset-proposer-attribution.js';
import { PROPOSER_ATTRIBUTION_PROJECTION } from './types.js';

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for proposer attribution projection');
  }

  const chainId = process.env.CHAIN_ID ?? 'twilight-localnet-1';
  const prisma = createPrismaClient();

  try {
    await withProjectionAdvisoryLock(prisma, async () => {
      if (process.env.RESET_PROJECTION === 'true') {
        await resetProposerAttributionProjection(
          prisma as unknown as ResetProposerAttributionProjectionPrisma,
        );
      }

      const cursor = await getOrCreateProjectionCursor(prisma, PROPOSER_ATTRIBUTION_PROJECTION, chainId);
      const startHeight = parseOptionalHeight(process.env.START_HEIGHT)
        ?? parseHeight(asRecord(cursor).lastProjectedHeight) + 1n;
      const endHeight = parseOptionalHeight(process.env.END_HEIGHT)
        ?? await getMaxBlockHeight(prisma as unknown as BlockAggregatePrisma);

      if (endHeight < startHeight) return;

      await projectProposerAttributionRange({
        prisma: prisma as unknown as ProposerAttributionProjectionPrisma,
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

interface BlockAggregatePrisma {
  block: {
    aggregate(args: unknown): Promise<{ _max?: { height?: bigint | null } | undefined }>;
  };
}

async function getMaxBlockHeight(prisma: BlockAggregatePrisma): Promise<bigint> {
  const result = await prisma.block.aggregate({ _max: { height: true } });
  return result._max?.height ?? 0n;
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
