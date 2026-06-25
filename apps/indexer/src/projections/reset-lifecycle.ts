import { CORESLOT_LIFECYCLE_PROJECTION } from './types.js';

export interface ResetLifecycleProjectionPrisma {
  coreSlotLifecycleEvent: {
    deleteMany(args?: unknown): Promise<unknown>;
  };
  projectionFailure: {
    deleteMany(args: unknown): Promise<unknown>;
  };
  projectionCursor: {
    deleteMany(args: unknown): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: ResetLifecycleProjectionPrisma) => Promise<T>): Promise<T>;
}

export async function resetCoreSlotLifecycleProjection(
  prisma: ResetLifecycleProjectionPrisma,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.coreSlotLifecycleEvent.deleteMany();
    await tx.projectionFailure.deleteMany({
      where: { projectionName: CORESLOT_LIFECYCLE_PROJECTION },
    });
    await tx.projectionCursor.deleteMany({
      where: { projectionName: CORESLOT_LIFECYCLE_PROJECTION },
    });
  });
}
