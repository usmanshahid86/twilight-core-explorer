import { RestRpcChainClient } from '@twilight-explorer/chain-client';
import { loadConfig } from '@twilight-explorer/config';
import { createPrismaClient } from '@twilight-explorer/db';
import { withProjectionAdvisoryLock } from './advisory-lock.js';
import { getOrCreateProjectionCursor } from './cursor.js';
import {
  minUpstreamCursorHeight,
  projectCoreSlotTemporalMapRange,
  type CoreSlotTemporalMapProjectionPrisma,
  type UpstreamCursorReaderPrisma,
} from './coreslot-temporal-map.js';
import {
  resetCoreSlotTemporalMapProjection,
  type ResetTemporalMapProjectionPrisma,
} from './reset-temporal-map.js';
import { CORESLOT_TEMPORAL_MAP_PROJECTION } from './types.js';

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for CoreSlot temporal map projection');
  }

  const config = loadConfig(process.env);
  const chainId = config.chainId;
  const prisma = createPrismaClient();
  const client = new RestRpcChainClient({
    cometRpcUrl: config.cometRpcUrl,
    restUrl: config.restUrl,
    timeoutMs: config.requestTimeoutMs,
  });

  try {
    await withProjectionAdvisoryLock(prisma, async () => {
      if (process.env.RESET_PROJECTION === 'true') {
        await resetCoreSlotTemporalMapProjection(
          prisma as unknown as ResetTemporalMapProjectionPrisma,
        );
      }

      const cursor = await getOrCreateProjectionCursor(
        prisma,
        CORESLOT_TEMPORAL_MAP_PROJECTION,
        chainId,
      );
      const startHeight = parseOptionalHeight(process.env.START_HEIGHT)
        ?? parseHeight(asRecord(cursor).lastProjectedHeight) + 1n;
      const requestedEnd = parseOptionalHeight(process.env.END_HEIGHT)
        ?? await getMaxBlockHeight(prisma as unknown as BlockAggregatePrisma);
      // ISSUE #56: cap endHeight at the UPSTREAM projections' cursors. The temporal map reads rows
      // produced by coreslot-lifecycle (CoreSlotLifecycleEvent) and coreslot-key-rotation
      // (CoreSlotConsensusKeyRotation). If we processed beyond where those have projected, we'd find no
      // events at those heights, open NO window, yet advance our own cursor past them — a permanent silent
      // gap (a window is never built, so the slot is invisible to liveness/health). Never outrun the
      // data sources. (On a temporal-map-only RESET the upstreams are already at tip, so cap == maxBlock
      // and the full replay runs; if an upstream is behind, we process only up to it and extend later.)
      const upstreamCap = await minUpstreamCursorHeight(
        prisma as unknown as UpstreamCursorReaderPrisma,
        chainId,
      );
      const endHeight = requestedEnd < upstreamCap ? requestedEnd : upstreamCap;

      if (endHeight < startHeight) return;

      await projectCoreSlotTemporalMapRange({
        prisma: prisma as unknown as CoreSlotTemporalMapProjectionPrisma,
        chainId,
        startHeight,
        endHeight,
        client,
        seedGenesis: process.env.RESET_PROJECTION === 'true',
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
  block: { aggregate(args: unknown): Promise<{ _max?: { height?: bigint | null } | undefined }> };
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
