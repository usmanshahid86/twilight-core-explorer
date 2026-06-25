import { CORESLOT_HEALTH_PROJECTION } from './types.js';

export interface ResetCoreSlotHealthProjectionPrisma {
  coreSlotHealthSnapshot: { deleteMany(args?: unknown): Promise<unknown> };
  networkLivenessRiskSnapshot: { deleteMany(args?: unknown): Promise<unknown> };
  projectionFailure: { deleteMany(args: unknown): Promise<unknown> };
  projectionCursor: { deleteMany(args: unknown): Promise<unknown> };
  $transaction<T>(
    fn: (tx: ResetCoreSlotHealthProjectionPrisma) => Promise<T>,
  ): Promise<T>;
}

/**
 * Reset only the derived health/risk projection. CoreSlotLivenessSummary, CoreSlotLivenessEvidence,
 * signature evidence, CoreSlotConsensusWindow, CoreSlot semantic rows, and rewards rows are preserved.
 */
export async function resetCoreSlotHealthProjection(
  prisma: ResetCoreSlotHealthProjectionPrisma,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.coreSlotHealthSnapshot.deleteMany();
    await tx.networkLivenessRiskSnapshot.deleteMany();
    await tx.projectionFailure.deleteMany({
      where: { projectionName: CORESLOT_HEALTH_PROJECTION },
    });
    await tx.projectionCursor.deleteMany({
      where: { projectionName: CORESLOT_HEALTH_PROJECTION },
    });
  });
}
