import { PROJECTION_STATUS } from './types.js';

export interface ProjectionCursorPrisma {
  projectionCursor: {
    upsert(args: unknown): Promise<unknown>;
  };
}

export interface ProjectionCursorReadPrisma {
  projectionCursor: {
    findFirst(args: unknown): Promise<{ lastProjectedHeight: unknown } | null>;
  };
}

// Read another projection's cursor height (its lastProjectedHeight), or 0n if it has never run. Downstream
// projections use this to cap their endHeight at an UPSTREAM projection's progress, so they never process /
// attribute a height whose upstream rows (e.g. consensus windows produced by temporal-map) do not exist yet.
// That is the #56 / #59 bug class: outrun the upstream -> emit nothing / mis-attribute -> advance the cursor
// past it -> a permanent, silent gap. A missing upstream cursor reads as 0n, which stalls the downstream
// until the upstream has run.
export async function readProjectionCursorHeight(
  prisma: ProjectionCursorReadPrisma,
  projectionName: string,
  chainId: string,
): Promise<bigint> {
  const row = await prisma.projectionCursor.findFirst({ where: { projectionName, chainId } });
  return toCursorHeight(row?.lastProjectedHeight);
}

function toCursorHeight(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string' && value.trim()) return BigInt(value);
  return 0n;
}

export async function getOrCreateProjectionCursor(
  prisma: ProjectionCursorPrisma,
  projectionName: string,
  chainId: string,
): Promise<unknown> {
  return prisma.projectionCursor.upsert({
    where: { projectionName_chainId: { projectionName, chainId } },
    create: {
      projectionName,
      chainId,
      lastProjectedHeight: 0n,
      status: PROJECTION_STATUS.idle,
    },
    update: {},
  });
}

export async function updateProjectionCursorSuccess(
  prisma: ProjectionCursorPrisma,
  projectionName: string,
  chainId: string,
  height: bigint,
): Promise<unknown> {
  return prisma.projectionCursor.upsert({
    where: { projectionName_chainId: { projectionName, chainId } },
    create: {
      projectionName,
      chainId,
      lastProjectedHeight: height,
      status: PROJECTION_STATUS.idle,
      error: null,
    },
    update: {
      lastProjectedHeight: height,
      status: PROJECTION_STATUS.idle,
      error: null,
    },
  });
}

export async function haltProjectionCursorError(
  prisma: ProjectionCursorPrisma,
  projectionName: string,
  chainId: string,
  height: bigint,
  error: unknown,
): Promise<unknown> {
  return prisma.projectionCursor.upsert({
    where: { projectionName_chainId: { projectionName, chainId } },
    create: {
      projectionName,
      chainId,
      lastProjectedHeight: previousHeight(height),
      status: PROJECTION_STATUS.haltedError,
      error: formatError(error),
    },
    update: {
      status: PROJECTION_STATUS.haltedError,
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
