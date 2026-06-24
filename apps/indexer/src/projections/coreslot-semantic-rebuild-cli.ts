import { createPrismaClient } from '@twilight-explorer/db';
import { withProjectionAdvisoryLock } from './advisory-lock.js';
import {
  CORESLOT_SEMANTIC_REBUILD_ORDER,
  CoreSlotSemanticRebuildError,
  projectCoreSlotSemanticRebuild,
} from './coreslot-semantic-rebuild.js';
import { CORESLOT_SEMANTIC_PROJECTIONS } from './types.js';

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

interface BlockAggregatePrisma {
  block: {
    aggregate(args: unknown): Promise<{
      _max?: { height?: bigint | null } | undefined;
      _min?: { height?: bigint | null } | undefined;
    }>;
  };
}

interface ProjectionCursorReaderPrisma {
  projectionCursor: {
    findMany(args: unknown): Promise<CursorRow[]>;
  };
}

interface CursorRow {
  projectionName: string;
  lastProjectedHeight: bigint;
  status: string;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for the CoreSlot semantic rebuild');
  }

  const chainId = process.env.CHAIN_ID ?? 'twilight-localnet-1';
  const reset = process.env.RESET_PROJECTION === 'true';
  const dryRun = process.env.DRY_RUN === 'true';
  const prisma = createPrismaClient();

  try {
    await withProjectionAdvisoryLock(prisma, async () => {
      const endHeight = parseOptionalHeight(process.env.END_HEIGHT)
        ?? await getMaxBlockHeight(prisma as unknown as BlockAggregatePrisma);
      const startHeight = await resolveStartHeight(prisma, reset);

      if (dryRun) {
        await printPlan(prisma, chainId, { startHeight, endHeight, reset });
        return;
      }

      if (endHeight < startHeight) {
        console.log(
          `[coreslot-semantic] nothing to project: endHeight ${endHeight} < startHeight ${startHeight}`,
        );
        return;
      }

      try {
        const result = await projectCoreSlotSemanticRebuild({
          prisma,
          chainId,
          startHeight,
          endHeight,
          reset,
        });
        console.log(
          `[coreslot-semantic] rebuilt ${result.ranProjections.join(' -> ')} `
            + `over ${startHeight}..${endHeight} (reset=${reset})`,
        );
      } catch (error) {
        if (error instanceof CoreSlotSemanticRebuildError) {
          console.error(
            `[coreslot-semantic] failed during ${error.projectionName}; `
              + `completed: ${error.ranProjections.join(', ') || 'none'}`,
          );
        }
        throw error;
      }

      await printCursors(prisma, chainId);
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function resolveStartHeight(prisma: unknown, reset: boolean): Promise<bigint> {
  const explicit = parseOptionalHeight(process.env.START_HEIGHT);
  if (explicit !== undefined) return explicit;
  if (reset) return getMinBlockHeight(prisma as BlockAggregatePrisma);
  throw new Error(
    'START_HEIGHT is required for a non-reset combined CoreSlot rebuild to avoid '
      + 'cursor ambiguity across projections. Set RESET_PROJECTION=true or provide START_HEIGHT.',
  );
}

async function printPlan(
  prisma: unknown,
  chainId: string,
  plan: { startHeight: bigint; endHeight: bigint; reset: boolean },
): Promise<void> {
  console.log('[coreslot-semantic] dry run');
  console.log(`  chainId:    ${chainId}`);
  console.log(`  startHeight: ${plan.startHeight}`);
  console.log(`  endHeight:   ${plan.endHeight}`);
  console.log(`  reset:       ${plan.reset}`);
  console.log(`  order:       ${CORESLOT_SEMANTIC_REBUILD_ORDER.join(' -> ')}`);
  console.log('  current cursors:');
  await printCursors(prisma, chainId, '    ');
}

async function printCursors(prisma: unknown, chainId: string, indent = '  '): Promise<void> {
  const cursors = await (prisma as ProjectionCursorReaderPrisma).projectionCursor.findMany({
    where: {
      chainId,
      projectionName: { in: [...CORESLOT_SEMANTIC_PROJECTIONS] },
    },
  });
  const byName = new Map(cursors.map((cursor) => [cursor.projectionName, cursor]));
  for (const name of CORESLOT_SEMANTIC_PROJECTIONS) {
    const cursor = byName.get(name);
    if (cursor) {
      console.log(`${indent}${name}: height ${cursor.lastProjectedHeight} (${cursor.status})`);
    } else {
      console.log(`${indent}${name}: no cursor`);
    }
  }
}

async function getMaxBlockHeight(prisma: BlockAggregatePrisma): Promise<bigint> {
  const result = await prisma.block.aggregate({ _max: { height: true } });
  return result._max?.height ?? 0n;
}

async function getMinBlockHeight(prisma: BlockAggregatePrisma): Promise<bigint> {
  const result = await prisma.block.aggregate({ _min: { height: true } });
  return result._min?.height ?? 0n;
}

function parseOptionalHeight(value: string | undefined): bigint | undefined {
  if (!value?.trim()) return undefined;
  return BigInt(value);
}
