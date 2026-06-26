import { RestRpcChainClient } from '@twilight-explorer/chain-client';
import { loadConfig } from '@twilight-explorer/config';
import { createPrismaClient } from '@twilight-explorer/db';
import { withProjectionAdvisoryLock } from './advisory-lock.js';
import {
  projectBalanceSnapshot,
  type BalanceSnapshotChainClient,
  type BalanceSnapshotPrisma,
} from './balance-snapshot.js';

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for the balance snapshot ingestion');
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
      const height =
        parseOptionalHeight(process.env.SAMPLE_HEIGHT) ??
        parseOptionalHeight(process.env.END_HEIGHT) ??
        (await getMaxBlockHeight(prisma as unknown as BlockAggregatePrisma));

      const extraAddresses = parseAddresses(process.env.EXTRA_BALANCE_ADDRESSES);

      const result = await projectBalanceSnapshot({
        prisma: prisma as unknown as BalanceSnapshotPrisma,
        client: client as unknown as BalanceSnapshotChainClient,
        chainId: config.chainId,
        height,
        ...(extraAddresses ? { extraAddresses } : {}),
      });

      if (result.failed) {
        console.error(`[balance-snapshot] chain read failed at height ${result.height}; cursor halted, no rows written`);
        process.exitCode = 1;
        return;
      }
      console.log(
        `[balance-snapshot] sampled at height ${result.height}: ` +
          `${result.supplyRows} supply rows, ${result.accountRows} account balance rows ` +
          `across ${result.addressCount} addresses`,
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

function parseAddresses(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined;
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
