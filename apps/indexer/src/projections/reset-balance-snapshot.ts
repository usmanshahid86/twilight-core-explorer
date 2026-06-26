import { BALANCE_SNAPSHOT_PROJECTION, SUPPLY_SAMPLE_KIND } from './types.js';

export interface ResetBalanceSnapshotPrisma {
  accountBalanceCurrent: { deleteMany(args?: unknown): Promise<unknown> };
  rewardsBalanceSample: { deleteMany(args: unknown): Promise<unknown> };
  projectionFailure: { deleteMany(args: unknown): Promise<unknown> };
  projectionCursor: { deleteMany(args: unknown): Promise<unknown> };
  $transaction<T>(fn: (tx: ResetBalanceSnapshotPrisma) => Promise<T>): Promise<T>;
}

/**
 * Reset only the balance_snapshot_v1 outputs: all AccountBalanceCurrent rows, the supply rows in
 * RewardsBalanceSample (sampleKind = "supply"), and the balance_snapshot_v1 cursor/failures.
 *
 * Preserves everything else — rewards/module-balance RewardsBalanceSample rows (module_balance,
 * cumulative_emitted, treasury), CoreSlot semantic rows, generic canonical rows, and all other
 * projection cursors/failures.
 */
export async function resetBalanceSnapshotProjection(
  prisma: ResetBalanceSnapshotPrisma,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.accountBalanceCurrent.deleteMany();
    await tx.rewardsBalanceSample.deleteMany({ where: { sampleKind: SUPPLY_SAMPLE_KIND } });
    await tx.projectionFailure.deleteMany({ where: { projectionName: BALANCE_SNAPSHOT_PROJECTION } });
    await tx.projectionCursor.deleteMany({ where: { projectionName: BALANCE_SNAPSHOT_PROJECTION } });
  });
}
