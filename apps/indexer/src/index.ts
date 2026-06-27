import { RestRpcChainClient } from '@twilight-explorer/chain-client';
import { loadConfig } from '@twilight-explorer/config';
import { createPrismaClient } from '@twilight-explorer/db';
import { withIndexerAdvisoryLock } from './advisory-lock.js';
import { assertChainIdMatches } from './chain-id-guard.js';
import { getOrCreateCursor } from './cursor.js';
import { ingestHeight, type IngestPrisma } from './ingest-height.js';

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for indexer persistence');
  }

  const config = loadConfig(process.env);
  const prisma = createPrismaClient();
  const client = new RestRpcChainClient({
    cometRpcUrl: config.cometRpcUrl,
    restUrl: config.restUrl,
    timeoutMs: config.requestTimeoutMs,
  });

  try {
    await withIndexerAdvisoryLock(prisma, async () => {
      const status = await client.getStatus();
      // Refuse to ingest under a chain-id the node disagrees with (e.g. CHAIN_ID unset -> the
      // config default mislabels every Block/cursor row and the API /status). See chain-id-guard.
      assertChainIdMatches(config.chainId, status.chainId);
      const latestChainHeight = parseHeight(status.latestBlockHeight);
      const cursor = await getOrCreateCursor(prisma as unknown as IngestPrisma, config.chainId);
      const cursorRecord = asRecord(cursor);
      const defaultStart = parseHeight(cursorRecord.lastIndexedHeight) + 1n;
      const startHeight = parseOptionalHeight(process.env.START_HEIGHT) ?? defaultStart;
      const endHeight = parseOptionalHeight(process.env.END_HEIGHT) ?? latestChainHeight;

      if (endHeight < startHeight) return;

      for (let height = startHeight; height <= endHeight; height += 1n) {
        await ingestHeight({
          chainId: config.chainId,
          height,
          latestChainHeight,
          client,
          prisma: prisma as unknown as IngestPrisma,
        });
      }
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

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
