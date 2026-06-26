// Decode-failure reads. Keyset by id DESC (autoincrement, stable). Raw payloads are never selected
// for the public list in 9b.

import type { PrismaClient } from '@twilight-explorer/db';

export interface ListDecodeFailuresParams {
  beforeId: bigint | undefined;
  resolved: boolean | undefined;
  failureKind: string | undefined;
  height: bigint | undefined;
  limit: number;
}

export async function listDecodeFailures(prisma: PrismaClient, params: ListDecodeFailuresParams) {
  return prisma.decodeFailure.findMany({
    where: {
      ...(params.resolved !== undefined ? { resolved: params.resolved } : {}),
      ...(params.failureKind !== undefined ? { failureKind: params.failureKind } : {}),
      ...(params.height !== undefined ? { height: params.height } : {}),
      ...(params.beforeId !== undefined ? { id: { lt: params.beforeId } } : {}),
    },
    orderBy: { id: 'desc' },
    take: params.limit,
  });
}
