import { CORESLOT_PARAMS_PROJECTION } from './types.js';

export interface ResetParamsProjectionPrisma {
  coreSlotParameterChange: {
    deleteMany(args?: unknown): Promise<unknown>;
  };
  projectionFailure: {
    deleteMany(args: unknown): Promise<unknown>;
  };
  projectionCursor: {
    deleteMany(args: unknown): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: ResetParamsProjectionPrisma) => Promise<T>): Promise<T>;
}

export async function resetCoreSlotParamsProjection(
  prisma: ResetParamsProjectionPrisma,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.coreSlotParameterChange.deleteMany();
    await tx.projectionFailure.deleteMany({
      where: { projectionName: CORESLOT_PARAMS_PROJECTION },
    });
    await tx.projectionCursor.deleteMany({
      where: { projectionName: CORESLOT_PARAMS_PROJECTION },
    });
  });
}
