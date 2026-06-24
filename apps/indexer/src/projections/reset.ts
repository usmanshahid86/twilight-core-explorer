import { CORESLOT_METADATA_PROJECTION } from './types.js';

export interface ResetProjectionPrisma {
  coreSlotMetadataChange: {
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
  $transaction<T>(fn: (tx: ResetProjectionPrisma) => Promise<T>): Promise<T>;
}

export async function resetCoreSlotMetadataProjection(
  prisma: ResetProjectionPrisma,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.coreSlotMetadataChange.deleteMany();
    await tx.coreSlotProjection.deleteMany();
    await tx.projectionFailure.deleteMany({
      where: { projectionName: CORESLOT_METADATA_PROJECTION },
    });
    await tx.projectionCursor.deleteMany({
      where: { projectionName: CORESLOT_METADATA_PROJECTION },
    });
  });
}
