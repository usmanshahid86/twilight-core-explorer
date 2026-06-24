import { CORESLOT_PAYOUT_PROJECTION } from './types.js';

export interface ResetPayoutProjectionPrisma {
  coreSlotPayoutChange: {
    deleteMany(args?: unknown): Promise<unknown>;
  };
  projectionFailure: {
    deleteMany(args: unknown): Promise<unknown>;
  };
  projectionCursor: {
    deleteMany(args: unknown): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: ResetPayoutProjectionPrisma) => Promise<T>): Promise<T>;
}

export async function resetCoreSlotPayoutProjection(
  prisma: ResetPayoutProjectionPrisma,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.coreSlotPayoutChange.deleteMany();
    await tx.projectionFailure.deleteMany({
      where: { projectionName: CORESLOT_PAYOUT_PROJECTION },
    });
    await tx.projectionCursor.deleteMany({
      where: { projectionName: CORESLOT_PAYOUT_PROJECTION },
    });
  });
}
