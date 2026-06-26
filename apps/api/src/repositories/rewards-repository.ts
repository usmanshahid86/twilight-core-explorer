// Rewards reads. All DB-only over materialized rows; no chain access, no recomputation.

import type { PrismaClient } from '@twilight-explorer/db';

export async function listEpochs(
  prisma: PrismaClient,
  params: { beforeEpoch: bigint | undefined; limit: number },
) {
  return prisma.rewardEpochProjection.findMany({
    ...(params.beforeEpoch !== undefined ? { where: { epochNumber: { lt: params.beforeEpoch } } } : {}),
    orderBy: { epochNumber: 'desc' },
    take: params.limit,
  });
}

export async function getEpoch(prisma: PrismaClient, epochNumber: bigint) {
  return prisma.rewardEpochProjection.findUnique({ where: { epochNumber } });
}

export async function listSlotRewards(
  prisma: PrismaClient,
  params: { slotId: bigint; beforeEpoch: bigint | undefined; limit: number },
) {
  return prisma.slotRewardProjection.findMany({
    where: {
      slotId: params.slotId,
      ...(params.beforeEpoch !== undefined ? { epochNumber: { lt: params.beforeEpoch } } : {}),
    },
    orderBy: { epochNumber: 'desc' },
    take: params.limit,
  });
}

export interface ListClaimsParams {
  beforeHeight: bigint | undefined;
  beforeId: bigint | undefined;
  slotId: bigint | undefined;
  claimant: string | undefined;
  txHash: string | undefined;
  fromHeight: bigint | undefined;
  toHeight: bigint | undefined;
  limit: number;
}

export async function listClaims(prisma: PrismaClient, params: ListClaimsParams) {
  const heightRange =
    params.fromHeight !== undefined || params.toHeight !== undefined
      ? {
          height: {
            ...(params.fromHeight !== undefined ? { gte: params.fromHeight } : {}),
            ...(params.toHeight !== undefined ? { lte: params.toHeight } : {}),
          },
        }
      : {};
  return prisma.rewardClaimEvent.findMany({
    where: {
      ...(params.slotId !== undefined ? { slotId: params.slotId } : {}),
      ...(params.claimant !== undefined ? { claimant: params.claimant } : {}),
      ...(params.txHash !== undefined ? { txHash: params.txHash } : {}),
      ...heightRange,
      ...(params.beforeHeight !== undefined && params.beforeId !== undefined
        ? {
            OR: [
              { height: { lt: params.beforeHeight } },
              { height: params.beforeHeight, id: { lt: params.beforeId } },
            ],
          }
        : {}),
    },
    orderBy: [{ height: 'desc' }, { id: 'desc' }],
    take: params.limit,
  });
}

export async function listRewardsBalances(
  prisma: PrismaClient,
  params: {
    beforeId: bigint | undefined;
    sampleKind: string | undefined;
    denom: string | undefined;
    height: bigint | undefined;
    limit: number;
  },
) {
  return prisma.rewardsBalanceSample.findMany({
    where: {
      // exclude supply by default; an explicit ?sampleKind=supply opts back in
      ...(params.sampleKind !== undefined ? { sampleKind: params.sampleKind } : { sampleKind: { not: 'supply' } }),
      ...(params.denom !== undefined ? { denom: params.denom } : {}),
      ...(params.height !== undefined ? { height: params.height } : {}),
      ...(params.beforeId !== undefined ? { id: { lt: params.beforeId } } : {}),
    },
    orderBy: { id: 'desc' },
    take: params.limit,
  });
}

export async function listParamsChanges(
  prisma: PrismaClient,
  params: { beforeId: bigint | undefined; changeType: string | undefined; limit: number },
) {
  return prisma.rewardsParamsChange.findMany({
    where: {
      ...(params.changeType !== undefined ? { changeType: params.changeType } : {}),
      ...(params.beforeId !== undefined ? { id: { lt: params.beforeId } } : {}),
    },
    orderBy: { id: 'desc' },
    take: params.limit,
  });
}

export async function listTreasuryPayments(
  prisma: PrismaClient,
  params: { beforeId: bigint | undefined; limit: number },
) {
  return prisma.rewardsTreasuryPayment.findMany({
    ...(params.beforeId !== undefined ? { where: { id: { lt: params.beforeId } } } : {}),
    orderBy: { id: 'desc' },
    take: params.limit,
  });
}
