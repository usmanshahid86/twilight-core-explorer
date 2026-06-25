import { CORESLOT_LIVENESS_PROJECTION } from './types.js';

export interface ResetCoreSlotLivenessProjectionPrisma {
  coreSlotLivenessEvidence: { deleteMany(args?: unknown): Promise<unknown> };
  projectionFailure: { deleteMany(args: unknown): Promise<unknown> };
  projectionCursor: { deleteMany(args: unknown): Promise<unknown> };
  $transaction<T>(
    fn: (tx: ResetCoreSlotLivenessProjectionPrisma) => Promise<T>,
  ): Promise<T>;
}

/**
 * Reset only the derived CoreSlot liveness projection. Generic rows, CoreSlot semantic rows,
 * CoreSlotConsensusWindow, Phase 8a/8b signature evidence, and rewards rows are preserved.
 */
export async function resetCoreSlotLivenessProjection(
  prisma: ResetCoreSlotLivenessProjectionPrisma,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.coreSlotLivenessEvidence.deleteMany();
    await tx.projectionFailure.deleteMany({
      where: { projectionName: CORESLOT_LIVENESS_PROJECTION },
    });
    await tx.projectionCursor.deleteMany({
      where: { projectionName: CORESLOT_LIVENESS_PROJECTION },
    });
  });
}
