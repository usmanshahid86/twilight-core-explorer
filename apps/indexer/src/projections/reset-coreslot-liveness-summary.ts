import { CORESLOT_LIVENESS_SUMMARY_PROJECTION } from './types.js';

export interface ResetCoreSlotLivenessSummaryProjectionPrisma {
  coreSlotLivenessSummary: { deleteMany(args?: unknown): Promise<unknown> };
  projectionFailure: { deleteMany(args: unknown): Promise<unknown> };
  projectionCursor: { deleteMany(args: unknown): Promise<unknown> };
  $transaction<T>(
    fn: (tx: ResetCoreSlotLivenessSummaryProjectionPrisma) => Promise<T>,
  ): Promise<T>;
}

/**
 * Reset only the derived liveness summary projection. CoreSlotLivenessEvidence, signature
 * evidence, CoreSlot semantic rows, CoreSlotConsensusWindow, and rewards rows are preserved.
 */
export async function resetCoreSlotLivenessSummaryProjection(
  prisma: ResetCoreSlotLivenessSummaryProjectionPrisma,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.coreSlotLivenessSummary.deleteMany();
    await tx.projectionFailure.deleteMany({
      where: { projectionName: CORESLOT_LIVENESS_SUMMARY_PROJECTION },
    });
    await tx.projectionCursor.deleteMany({
      where: { projectionName: CORESLOT_LIVENESS_SUMMARY_PROJECTION },
    });
  });
}
