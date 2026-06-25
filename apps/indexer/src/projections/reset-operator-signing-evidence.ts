import { OPERATOR_SIGNING_EVIDENCE_PROJECTION } from './types.js';

export interface ResetOperatorSigningEvidenceProjectionPrisma {
  operatorSigningEvidence: { deleteMany(args?: unknown): Promise<unknown> };
  projectionFailure: { deleteMany(args: unknown): Promise<unknown> };
  projectionCursor: { deleteMany(args: unknown): Promise<unknown> };
  $transaction<T>(
    fn: (tx: ResetOperatorSigningEvidenceProjectionPrisma) => Promise<T>,
  ): Promise<T>;
}

/**
 * Reset only the derived operator-signing attribution projection. Phase 8a
 * BlockSignature evidence, generic rows, CoreSlot semantic rows, and rewards rows
 * are preserved.
 */
export async function resetOperatorSigningEvidenceProjection(
  prisma: ResetOperatorSigningEvidenceProjectionPrisma,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.operatorSigningEvidence.deleteMany();
    await tx.projectionFailure.deleteMany({
      where: { projectionName: OPERATOR_SIGNING_EVIDENCE_PROJECTION },
    });
    await tx.projectionCursor.deleteMany({
      where: { projectionName: OPERATOR_SIGNING_EVIDENCE_PROJECTION },
    });
  });
}
