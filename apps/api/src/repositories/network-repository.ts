// Network-level reads: proposer leaderboard, validator set at a height, and the current network
// halt-risk snapshot. No live validator queries — the validator set is the materialized window set.

import type { PrismaClient } from '@twilight-explorer/db';

export async function getProposerLeaderboard(prisma: PrismaClient) {
  const grouped = await prisma.blockProposerAttribution.groupBy({
    by: ['slotId', 'operatorAddress'],
    where: { attributionStatus: 'attributed' },
    _count: { _all: true },
  });
  return grouped
    .filter((g) => g.slotId !== null)
    .map((g) => ({
      slotId: g.slotId as bigint,
      operatorAddress: g.operatorAddress,
      blocksProposed: g._count._all,
    }))
    // blocksProposed DESC, then slotId ASC as a deterministic tie-break (groupBy order is otherwise
    // unspecified, which would make tied rows order non-deterministic).
    .sort(
      (a, b) =>
        b.blocksProposed - a.blocksProposed ||
        (a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0),
    );
}

/** Active CoreSlot windows at `height`: effectiveFrom <= height AND (effectiveTo IS NULL OR > height). */
export async function getValidatorSetAtHeight(prisma: PrismaClient, height: bigint) {
  return prisma.coreSlotConsensusWindow.findMany({
    where: {
      effectiveFromHeight: { lte: height },
      OR: [{ effectiveToHeight: null }, { effectiveToHeight: { gt: height } }],
    },
    orderBy: { slotId: 'asc' },
  });
}

export async function getNetworkRisk(prisma: PrismaClient) {
  return prisma.networkLivenessRiskSnapshot.findFirst({ orderBy: { updatedAtDb: 'desc' } });
}
