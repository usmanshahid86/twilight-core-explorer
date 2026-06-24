import { PROJECTION_STATUS } from './types.js';

export interface ProjectionCursorPrisma {
  projectionCursor: {
    upsert(args: unknown): Promise<unknown>;
  };
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
