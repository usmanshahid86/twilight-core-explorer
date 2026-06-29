import { createPrismaClient } from '@twilight-explorer/db';
import { withProjectionAdvisoryLock } from './advisory-lock.js';
import { reconcilePendingClaims, type RewardsSnapshotPrisma } from './rewards-snapshot.js';

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

/**
 * `project:rewards-reconcile` — a DB-only break-glass reconcile. Resolves any rewards-semantic
 * `missing_reward_records` ProjectionFailure whose claim is already covered by observed
 * `SlotRewardProjection` rows, stamping the claim provenance.
 *
 * The same reconcile runs automatically inside every `rewards-snapshot` (the routine path). This CLI
 * exists for the case the snapshot cannot serve: it does **no chain read**, so it can clear lingering
 * failures from rows that already exist when REST is down, or after a pre-fix deploy, or without
 * advancing the sample height. It needs only DATABASE_URL — no COMET_RPC_URL/REST_URL. Idempotent.
 */
async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for the rewards reconcile');
  }

  const prisma = createPrismaClient();
  try {
    await withProjectionAdvisoryLock(prisma, async () => {
      const resolved = await prisma.$transaction((tx) =>
        reconcilePendingClaims(tx as unknown as RewardsSnapshotPrisma),
      );
      console.log(
        `[rewards-reconcile] resolved ${resolved} missing_reward_records failure(s) from existing rows`,
      );
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
