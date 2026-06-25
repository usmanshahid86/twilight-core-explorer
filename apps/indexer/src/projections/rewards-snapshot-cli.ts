import { RestRpcChainClient } from '@twilight-explorer/chain-client';
import { loadConfig } from '@twilight-explorer/config';
import { createPrismaClient } from '@twilight-explorer/db';
import { withProjectionAdvisoryLock } from './advisory-lock.js';
import {
  ingestRewardsSnapshot,
  type RewardsSnapshotChainClient,
  type RewardsSnapshotPrisma,
} from './rewards-snapshot.js';

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for the rewards snapshot ingestion');
  }

  const config = loadConfig(process.env);
  const prisma = createPrismaClient();
  const client = new RestRpcChainClient({
    cometRpcUrl: config.cometRpcUrl,
    restUrl: config.restUrl,
    timeoutMs: config.requestTimeoutMs,
  });

  try {
    await withProjectionAdvisoryLock(prisma, async () => {
      const height = parseOptionalHeight(process.env.SAMPLE_HEIGHT)
        ?? parseOptionalHeight(process.env.END_HEIGHT)
        ?? await getMaxBlockHeight(prisma as unknown as BlockAggregatePrisma);

      const slotIds = parseSlotIds(process.env.SLOT_IDS);

      const result = await ingestRewardsSnapshot({
        prisma: prisma as unknown as RewardsSnapshotPrisma,
        client: client as unknown as RewardsSnapshotChainClient,
        chainId: config.chainId,
        height,
        ...(slotIds ? { slotIds } : {}),
      });
      console.log(
        `[rewards-snapshot] sampled at height ${result.height}: `
          + `${result.slotRewardRows} slot reward rows, ${result.balanceSamples} balance samples`,
      );
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

function parseSlotIds(value: string | undefined): bigint[] | undefined {
  if (!value?.trim()) return undefined;
  return value.split(',').map((part) => BigInt(part.trim()));
}
