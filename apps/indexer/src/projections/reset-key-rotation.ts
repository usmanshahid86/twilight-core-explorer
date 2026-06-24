import { CORESLOT_KEY_ROTATION_PROJECTION } from './types.js';

export interface ResetKeyRotationProjectionPrisma {
  coreSlotConsensusKeyRotation: {
    deleteMany(args?: unknown): Promise<unknown>;
  };
  projectionFailure: {
    deleteMany(args: unknown): Promise<unknown>;
  };
  projectionCursor: {
    deleteMany(args: unknown): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: ResetKeyRotationProjectionPrisma) => Promise<T>): Promise<T>;
}

export async function resetCoreSlotKeyRotationProjection(
  prisma: ResetKeyRotationProjectionPrisma,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.coreSlotConsensusKeyRotation.deleteMany();
    await tx.projectionFailure.deleteMany({
      where: { projectionName: CORESLOT_KEY_ROTATION_PROJECTION },
    });
    await tx.projectionCursor.deleteMany({
      where: { projectionName: CORESLOT_KEY_ROTATION_PROJECTION },
    });
  });
}
