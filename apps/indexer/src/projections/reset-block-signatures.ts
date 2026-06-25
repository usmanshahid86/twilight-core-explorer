import { BLOCK_SIGNATURES_PROJECTION } from './types.js';

export interface ResetBlockSignaturesProjectionPrisma {
  blockSignature: { deleteMany(args?: unknown): Promise<unknown> };
  projectionFailure: { deleteMany(args: unknown): Promise<unknown> };
  projectionCursor: { deleteMany(args: unknown): Promise<unknown> };
  $transaction<T>(fn: (tx: ResetBlockSignaturesProjectionPrisma) => Promise<T>): Promise<T>;
}

/**
 * Reset only the derived block-signature projection. Generic block rows and all CoreSlot /
 * rewards semantic rows are preserved.
 */
export async function resetBlockSignaturesProjection(
  prisma: ResetBlockSignaturesProjectionPrisma,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.blockSignature.deleteMany();
    await tx.projectionFailure.deleteMany({
      where: { projectionName: BLOCK_SIGNATURES_PROJECTION },
    });
    await tx.projectionCursor.deleteMany({
      where: { projectionName: BLOCK_SIGNATURES_PROJECTION },
    });
  });
}
