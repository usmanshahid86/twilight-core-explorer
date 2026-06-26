// Supply + account-balance reads. Supply comes ONLY from RewardsBalanceSample(sampleKind="supply")
// (never summed from balances); account balances come ONLY from AccountBalanceCurrent.

import type { PrismaClient } from '@twilight-explorer/db';

const SUPPLY_KIND = 'supply';

/** Height of the most recent supply sample, or null if none exist. */
export async function getLatestSupplyHeight(prisma: PrismaClient): Promise<bigint | null> {
  const row = await prisma.rewardsBalanceSample.findFirst({
    where: { sampleKind: SUPPLY_KIND },
    orderBy: { height: 'desc' },
    select: { height: true },
  });
  return row?.height ?? null;
}

export async function getSupplyAtHeight(
  prisma: PrismaClient,
  height: bigint,
  denom: string | undefined,
) {
  return prisma.rewardsBalanceSample.findMany({
    where: {
      sampleKind: SUPPLY_KIND,
      height,
      ...(denom !== undefined ? { denom } : {}),
    },
    orderBy: { denom: 'asc' },
    select: { height: true, denom: true, amount: true },
  });
}

export async function getAccountBalances(prisma: PrismaClient, address: string) {
  return prisma.accountBalanceCurrent.findMany({
    where: { address },
    orderBy: { denom: 'asc' },
    select: { denom: true, amount: true, sampledAtHeight: true },
  });
}
