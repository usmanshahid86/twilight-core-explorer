import { PrismaClient } from '@prisma/client';

const datasourceUrl = process.env.DATABASE_URL;

if (!datasourceUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: {
    db: { url: datasourceUrl },
  },
});

try {
  const [
    blocks,
    transactions,
    messages,
    events,
    accounts,
    cursors,
    decodeFailures,
    cursorRows,
  ] = await Promise.all([
    prisma.block.count(),
    prisma.explorerTransaction.count(),
    prisma.message.count(),
    prisma.event.count(),
    prisma.account.count(),
    prisma.indexerCursor.count(),
    prisma.decodeFailure.count(),
    prisma.indexerCursor.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 10,
    }),
  ]);

  console.log(JSON.stringify({
    counts: {
      Block: blocks,
      ExplorerTransaction: transactions,
      Message: messages,
      Event: events,
      Account: accounts,
      IndexerCursor: cursors,
      DecodeFailure: decodeFailures,
    },
    cursors: cursorRows.map((cursor) => ({
      chainId: cursor.chainId,
      lastIndexedHeight: cursor.lastIndexedHeight.toString(),
      lastIndexedHash: cursor.lastIndexedHash,
      latestChainHeight: cursor.latestChainHeight?.toString() ?? null,
      status: cursor.status,
      error: cursor.error,
      updatedAt: cursor.updatedAt.toISOString(),
    })),
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
