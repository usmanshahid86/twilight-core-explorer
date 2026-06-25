import { CORESLOT_SEMANTIC_PROJECTIONS } from './types.js';

export interface ResetCoreSlotSemanticPrisma {
  coreSlotMetadataChange: {
    deleteMany(args?: unknown): Promise<unknown>;
  };
  coreSlotLifecycleEvent: {
    deleteMany(args?: unknown): Promise<unknown>;
  };
  coreSlotPayoutChange: {
    deleteMany(args?: unknown): Promise<unknown>;
  };
  coreSlotParameterChange: {
    deleteMany(args?: unknown): Promise<unknown>;
  };
  coreSlotConsensusKeyRotation: {
    deleteMany(args?: unknown): Promise<unknown>;
  };
  coreSlotConsensusWindow: {
    deleteMany(args?: unknown): Promise<unknown>;
  };
  coreSlotProjection: {
    deleteMany(args?: unknown): Promise<unknown>;
  };
  projectionFailure: {
    deleteMany(args: unknown): Promise<unknown>;
  };
  projectionCursor: {
    deleteMany(args: unknown): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: ResetCoreSlotSemanticPrisma) => Promise<T>): Promise<T>;
}

/**
 * Reset all currently implemented CoreSlot semantic projections
 * (metadata, lifecycle, payout, params) in a single transaction.
 *
 * Deletes only CoreSlot semantic rows and the CoreSlot projection cursors /
 * failures. Generic canonical rows (Block, ExplorerTransaction, Message, Event,
 * Account, DecodeFailure, IndexerCursor) are never touched, and projection
 * cursors / failures owned by non-CoreSlot projections are preserved because the
 * deletes are scoped to CORESLOT_SEMANTIC_PROJECTIONS.
 */
export async function resetCoreSlotSemanticProjections(
  prisma: ResetCoreSlotSemanticPrisma,
): Promise<void> {
  const projectionNames = [...CORESLOT_SEMANTIC_PROJECTIONS];

  await prisma.$transaction(async (tx) => {
    await tx.coreSlotMetadataChange.deleteMany();
    await tx.coreSlotLifecycleEvent.deleteMany();
    await tx.coreSlotPayoutChange.deleteMany();
    await tx.coreSlotParameterChange.deleteMany();
    await tx.coreSlotConsensusKeyRotation.deleteMany();
    await tx.coreSlotConsensusWindow.deleteMany();
    await tx.coreSlotProjection.deleteMany();
    await tx.projectionFailure.deleteMany({
      where: { projectionName: { in: projectionNames } },
    });
    await tx.projectionCursor.deleteMany({
      where: { projectionName: { in: projectionNames } },
    });
  });
}
