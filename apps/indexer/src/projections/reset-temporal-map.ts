import { CORESLOT_TEMPORAL_MAP_PROJECTION } from './types.js';

export interface ResetTemporalMapProjectionPrisma {
  coreSlotConsensusWindow: {
    deleteMany(args?: unknown): Promise<unknown>;
  };
  projectionFailure: {
    deleteMany(args: unknown): Promise<unknown>;
  };
  projectionCursor: {
    deleteMany(args: unknown): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: ResetTemporalMapProjectionPrisma) => Promise<T>): Promise<T>;
}

export async function resetCoreSlotTemporalMapProjection(
  prisma: ResetTemporalMapProjectionPrisma,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.coreSlotConsensusWindow.deleteMany();
    await tx.projectionFailure.deleteMany({
      where: { projectionName: CORESLOT_TEMPORAL_MAP_PROJECTION },
    });
    await tx.projectionCursor.deleteMany({
      where: { projectionName: CORESLOT_TEMPORAL_MAP_PROJECTION },
    });
  });
}
