import { REWARDS_PROJECTIONS } from './types.js';

export interface ResetRewardsProjectionPrisma {
  rewardEpochProjection: { deleteMany(args?: unknown): Promise<unknown> };
  slotRewardProjection: { deleteMany(args?: unknown): Promise<unknown> };
  rewardClaimEvent: { deleteMany(args?: unknown): Promise<unknown> };
  rewardsParamsChange: { deleteMany(args?: unknown): Promise<unknown> };
  rewardsTreasuryPayment: { deleteMany(args?: unknown): Promise<unknown> };
  rewardsBalanceSample: { deleteMany(args?: unknown): Promise<unknown> };
  projectionFailure: { deleteMany(args: unknown): Promise<unknown> };
  projectionCursor: { deleteMany(args: unknown): Promise<unknown> };
  $transaction<T>(fn: (tx: ResetRewardsProjectionPrisma) => Promise<T>): Promise<T>;
}

/**
 * Reset all rewards projection rows (both the rebuildable rewards_semantic_v1 rows and the
 * observed rewards_snapshot_v1 samples) plus the rewards projection cursors/failures.
 *
 * Deletes only rewards rows. Generic canonical rows, CoreSlot semantic rows, and CoreSlot
 * projection cursors/failures are never touched (the failure/cursor deletes are scoped to
 * REWARDS_PROJECTIONS).
 */
export async function resetRewardsProjections(
  prisma: ResetRewardsProjectionPrisma,
): Promise<void> {
  const projectionNames = [...REWARDS_PROJECTIONS];
  await prisma.$transaction(async (tx) => {
    await tx.rewardEpochProjection.deleteMany();
    await tx.slotRewardProjection.deleteMany();
    await tx.rewardClaimEvent.deleteMany();
    await tx.rewardsParamsChange.deleteMany();
    await tx.rewardsTreasuryPayment.deleteMany();
    await tx.rewardsBalanceSample.deleteMany();
    await tx.projectionFailure.deleteMany({
      where: { projectionName: { in: projectionNames } },
    });
    await tx.projectionCursor.deleteMany({
      where: { projectionName: { in: projectionNames } },
    });
  });
}
