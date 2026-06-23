export const CURSOR_STATUS = {
  idle: 'idle',
  running: 'running',
  haltedHashMismatch: 'halted_hash_mismatch',
  haltedError: 'halted_error',
} as const;

export interface CursorPrisma {
  indexerCursor: {
    findUnique(args: unknown): Promise<unknown>;
    upsert(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
}

export async function getOrCreateCursor(prisma: CursorPrisma, chainId: string): Promise<unknown> {
  return prisma.indexerCursor.upsert({
    where: { chainId },
    create: {
      chainId,
      lastIndexedHeight: 0n,
      status: CURSOR_STATUS.idle,
    },
    update: {},
  });
}

export async function updateCursorSuccess(
  prisma: CursorPrisma,
  chainId: string,
  height: bigint,
  hash: string | undefined,
  latestChainHeight?: bigint | undefined,
): Promise<unknown> {
  return prisma.indexerCursor.upsert({
    where: { chainId },
    create: {
      chainId,
      lastIndexedHeight: height,
      lastIndexedHash: hash ?? null,
      latestChainHeight: latestChainHeight ?? null,
      status: CURSOR_STATUS.idle,
      error: null,
    },
    update: {
      lastIndexedHeight: height,
      lastIndexedHash: hash ?? null,
      latestChainHeight: latestChainHeight ?? null,
      status: CURSOR_STATUS.idle,
      error: null,
    },
  });
}

export async function haltCursorHashMismatch(
  prisma: CursorPrisma,
  chainId: string,
  height: bigint,
  expectedHash: string | undefined,
  actualHash: string | undefined,
): Promise<unknown> {
  const error = `Hash mismatch at height ${height.toString()}: stored=${expectedHash ?? 'missing'} fetched=${actualHash ?? 'missing'}`;
  return prisma.indexerCursor.upsert({
    where: { chainId },
    create: {
      chainId,
      lastIndexedHeight: previousHeight(height),
      status: CURSOR_STATUS.haltedHashMismatch,
      error,
    },
    update: {
      status: CURSOR_STATUS.haltedHashMismatch,
      error,
    },
  });
}

export async function haltCursorError(
  prisma: CursorPrisma,
  chainId: string,
  height: bigint,
  error: unknown,
): Promise<unknown> {
  return prisma.indexerCursor.upsert({
    where: { chainId },
    create: {
      chainId,
      lastIndexedHeight: previousHeight(height),
      status: CURSOR_STATUS.haltedError,
      error: formatError(error),
    },
    update: {
      status: CURSOR_STATUS.haltedError,
      error: formatError(error),
    },
  });
}

function previousHeight(height: bigint): bigint {
  return height > 0n ? height - 1n : 0n;
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
