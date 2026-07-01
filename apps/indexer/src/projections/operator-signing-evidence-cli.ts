import { createPrismaClient } from '@twilight-explorer/db';
import { withProjectionAdvisoryLock } from './advisory-lock.js';
import {
  getOrCreateProjectionCursor,
  type ProjectionCursorReadPrisma,
} from './cursor.js';
import { capEndHeightAtTemporalMapCursor } from './coreslot-temporal-map.js';
import {
  projectOperatorSigningEvidenceRange,
  type OperatorSigningEvidenceProjectionPrisma,
} from './operator-signing-evidence.js';
import {
  resetOperatorSigningEvidenceProjection,
  type ResetOperatorSigningEvidenceProjectionPrisma,
} from './reset-operator-signing-evidence.js';
import { OPERATOR_SIGNING_EVIDENCE_PROJECTION } from './types.js';

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for operator signing evidence projection');
  }

  const chainId = process.env.CHAIN_ID ?? 'twilight-localnet-1';
  const prisma = createPrismaClient();

  try {
    await withProjectionAdvisoryLock(prisma, async () => {
      if (process.env.RESET_PROJECTION === 'true') {
        await resetOperatorSigningEvidenceProjection(
          prisma as unknown as ResetOperatorSigningEvidenceProjectionPrisma,
        );
      }

      const cursor = await getOrCreateProjectionCursor(
        prisma,
        OPERATOR_SIGNING_EVIDENCE_PROJECTION,
        chainId,
      );
      const startHeight = parseOptionalHeight(process.env.START_HEIGHT)
        ?? parseHeight(asRecord(cursor).lastProjectedHeight) + 1n;
      const requestedEnd = parseOptionalHeight(process.env.END_HEIGHT)
        ?? await getMaxSourceBlockHeight(prisma as unknown as BlockSignatureAggregatePrisma);
      // ISSUE #59: attribution reads consensus windows produced by temporal-map (a SPARSE upstream). The
      // dense BlockSignature cap above does not know whether temporal-map is behind, so also cap at
      // temporal-map's cursor: never attribute a height whose window is not built yet (that would silently
      // mis-attribute it as noConsensusWindow, then advance our cursor past it — a permanent gap).
      const { endHeight, temporalMapCursor } = await capEndHeightAtTemporalMapCursor(
        prisma as unknown as ProjectionCursorReadPrisma,
        chainId,
        requestedEnd,
      );
      if (temporalMapCursor < requestedEnd) {
        console.warn(
          `[operator-signing-evidence] endHeight capped ${requestedEnd} -> ${temporalMapCursor}: `
          + 'temporal-map (consensus windows) is behind; deferring until its windows are built.',
        );
      }

      if (endHeight < startHeight) return;

      await projectOperatorSigningEvidenceRange({
        prisma: prisma as unknown as OperatorSigningEvidenceProjectionPrisma,
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

interface BlockSignatureAggregatePrisma {
  blockSignature: {
    aggregate(args: unknown): Promise<{ _max?: { sourceBlockHeight?: bigint | null } | undefined }>;
  };
}

async function getMaxSourceBlockHeight(
  prisma: BlockSignatureAggregatePrisma,
): Promise<bigint> {
  const result = await prisma.blockSignature.aggregate({ _max: { sourceBlockHeight: true } });
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
