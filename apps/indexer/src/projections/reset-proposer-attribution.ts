import { PROPOSER_ATTRIBUTION_PROJECTION } from './types.js';

export interface ResetProposerAttributionProjectionPrisma {
  blockProposerAttribution: { deleteMany(args?: unknown): Promise<unknown> };
  projectionFailure: { deleteMany(args: unknown): Promise<unknown> };
  projectionCursor: { deleteMany(args: unknown): Promise<unknown> };
  $transaction<T>(
    fn: (tx: ResetProposerAttributionProjectionPrisma) => Promise<T>,
  ): Promise<T>;
}

/**
 * Reset only the derived proposer attribution projection. Generic Block rows, CoreSlot semantic
 * rows, CoreSlotConsensusWindow, signature evidence, and rewards rows are preserved.
 */
export async function resetProposerAttributionProjection(
  prisma: ResetProposerAttributionProjectionPrisma,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.blockProposerAttribution.deleteMany();
    await tx.projectionFailure.deleteMany({
      where: { projectionName: PROPOSER_ATTRIBUTION_PROJECTION },
    });
    await tx.projectionCursor.deleteMany({
      where: { projectionName: PROPOSER_ATTRIBUTION_PROJECTION },
    });
  });
}
