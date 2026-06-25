import {
  haltProjectionCursorError,
  updateProjectionCursorSuccess,
  type ProjectionCursorPrisma,
} from './cursor.js';
import { findConsensusWindowAtHeight } from './coreslot-temporal-map.js';
import {
  BLOCK_SIGNATURES_PROJECTION,
  OPERATOR_SIGNING_ATTRIBUTION_STATUS,
  OPERATOR_SIGNING_EVIDENCE_PROJECTION,
  type ProjectionFailureInput,
  withProjectionFailureKey,
} from './types.js';

export interface ProjectOperatorSigningEvidenceRangeArgs {
  prisma: OperatorSigningEvidenceProjectionPrisma;
  chainId: string;
  startHeight: bigint;
  endHeight: bigint;
}

export interface ProjectOperatorSigningEvidenceHeightArgs {
  prisma: OperatorSigningEvidenceProjectionPrisma;
  chainId: string;
  sourceBlockHeight: bigint;
}

export interface ProjectOperatorSigningEvidenceResult {
  sourceBlockHeight: bigint;
  rowsWritten: number;
  failuresCreated: number;
}

export interface OperatorSigningEvidenceProjectionPrisma extends ProjectionCursorPrisma {
  blockSignature: {
    findMany(args: unknown): Promise<BlockSignatureSource[]>;
  };
  coreSlotConsensusWindow: {
    findFirst(args: unknown): Promise<ConsensusWindowSource | null>;
    findMany(args: unknown): Promise<ConsensusWindowSource[]>;
    create(args: unknown): Promise<ConsensusWindowSource>;
    update(args: unknown): Promise<ConsensusWindowSource>;
    deleteMany(args?: unknown): Promise<unknown>;
    count(args: unknown): Promise<number>;
  };
  operatorSigningEvidence: {
    upsert(args: unknown): Promise<unknown>;
  };
  projectionFailure: {
    findFirst(args: unknown): Promise<unknown | null>;
    upsert(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: OperatorSigningEvidenceProjectionPrisma) => Promise<T>): Promise<T>;
}

interface BlockSignatureSource {
  signatureKey: string;
  sourceBlockHeight: bigint;
  committedBlockHeight: bigint;
  signatureIndex: number;
  validatorAddress: string | null;
  blockIdFlag: string | null;
  blockIdFlagCode: number | null;
  signed: boolean;
  rawSignatureJson: unknown;
}

interface ConsensusWindowSource {
  id: bigint;
  slotId: bigint;
  operatorAddress: string | null;
  consensusAddress: string;
  status: string;
  consensusPower: bigint | null;
  validatorUpdateHeight: bigint | null;
  effectiveFromHeight: bigint;
  effectiveToHeight: bigint | null;
  openedByKind: string;
  openedByEventId: bigint | null;
  openedByRotationId: bigint | null;
  openedByLifecycleId: bigint | null;
  closedByKind: string | null;
  closedByEventId: bigint | null;
  closedByRotationId: bigint | null;
  closedByLifecycleId: bigint | null;
  rawOpenJson: unknown | null;
  rawCloseJson: unknown | null;
}

interface AttributionResult {
  attributionStatus: string;
  slotId: bigint | null;
  operatorAddress: string | null;
  consensusPower: bigint | null;
  consensusWindowId: bigint | null;
  failure?: Omit<ProjectionFailureInput, 'projectionName' | 'module' | 'sourceHeight'>;
}

interface Counters {
  rowsWritten: number;
  failuresCreated: number;
}

export async function projectOperatorSigningEvidenceRange(
  args: ProjectOperatorSigningEvidenceRangeArgs,
): Promise<ProjectOperatorSigningEvidenceResult[]> {
  const signatures = await args.prisma.blockSignature.findMany({
    where: {
      sourceBlockHeight: { gte: args.startHeight, lte: args.endHeight },
    },
    select: { sourceBlockHeight: true },
    distinct: ['sourceBlockHeight'],
    orderBy: [{ sourceBlockHeight: 'asc' }],
  });

  const results: ProjectOperatorSigningEvidenceResult[] = [];
  for (const signature of signatures) {
    results.push(await projectOperatorSigningEvidenceHeight({
      prisma: args.prisma,
      chainId: args.chainId,
      sourceBlockHeight: signature.sourceBlockHeight,
    }));
  }

  // The cursor/range axis intentionally matches block_signatures_v1: containing block
  // sourceBlockHeight. Attribution itself uses committedBlockHeight.
  if (args.endHeight >= args.startHeight) {
    await updateProjectionCursorSuccess(
      args.prisma,
      OPERATOR_SIGNING_EVIDENCE_PROJECTION,
      args.chainId,
      args.endHeight,
    );
  }
  return results;
}

export async function projectOperatorSigningEvidenceHeight(
  args: ProjectOperatorSigningEvidenceHeightArgs,
): Promise<ProjectOperatorSigningEvidenceResult> {
  const { prisma, chainId, sourceBlockHeight } = args;

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.projectionFailure.deleteMany({
        where: {
          projectionName: OPERATOR_SIGNING_EVIDENCE_PROJECTION,
          sourceHeight: sourceBlockHeight,
          resolved: false,
        },
      });

      const counters: Counters = { rowsWritten: 0, failuresCreated: 0 };
      const signatures = await tx.blockSignature.findMany({
        where: { sourceBlockHeight },
        orderBy: [{ sourceBlockHeight: 'asc' }, { signatureIndex: 'asc' }],
      });

      for (const signature of signatures) {
        const attribution = await classifySignature(tx, signature);
        if (attribution.failure) {
          await createFailure(tx, {
            sourceHeight: sourceBlockHeight,
            ...attribution.failure,
          });
          counters.failuresCreated += 1;
        }

        await tx.operatorSigningEvidence.upsert({
          where: { signatureKey: signature.signatureKey },
          create: evidenceData(signature, attribution),
          update: evidenceUpdateData(signature, attribution),
        });
        counters.rowsWritten += 1;
      }

      await updateProjectionCursorSuccess(
        tx,
        OPERATOR_SIGNING_EVIDENCE_PROJECTION,
        chainId,
        sourceBlockHeight,
      );
      return { sourceBlockHeight, ...counters };
    });
  } catch (error) {
    await haltProjectionCursorError(
      prisma,
      OPERATOR_SIGNING_EVIDENCE_PROJECTION,
      chainId,
      sourceBlockHeight,
      error,
    );
    throw error;
  }
}

async function classifySignature(
  prisma: OperatorSigningEvidenceProjectionPrisma,
  signature: BlockSignatureSource,
): Promise<AttributionResult> {
  if (signature.committedBlockHeight < 0n) {
    return malformed(
      OPERATOR_SIGNING_ATTRIBUTION_STATUS.noConsensusWindow,
      'invalid_committed_height',
      `Committed block height is invalid for signature ${signature.signatureKey}.`,
    );
  }

  if (!signature.signatureKey || signature.sourceBlockHeight === undefined) {
    return malformed(
      OPERATOR_SIGNING_ATTRIBUTION_STATUS.unknownShape,
      'missing_required_block_signature_field',
      'BlockSignature row is missing a required attribution field.',
    );
  }

  if (signature.validatorAddress === null) {
    if (signature.blockIdFlagCode === 1) {
      return status(OPERATOR_SIGNING_ATTRIBUTION_STATUS.absentNoValidator);
    }

    if (await hasInvalidValidatorAddressFailure(prisma, signature)) {
      return status(OPERATOR_SIGNING_ATTRIBUTION_STATUS.invalidValidatorAddress);
    }

    return malformed(
      OPERATOR_SIGNING_ATTRIBUTION_STATUS.unknownShape,
      'unknown_operator_signing_evidence_shape',
      `Signature ${signature.signatureKey} has no validator address but is not an absent vote.`,
    );
  }

  if (!/^[0-9a-f]{40}$/.test(signature.validatorAddress)) {
    return malformed(
      OPERATOR_SIGNING_ATTRIBUTION_STATUS.invalidValidatorAddress,
      'invalid_validator_address',
      `Validator address is not normalized lowercase 40-character hex: ${signature.validatorAddress}`,
    );
  }

  const window = await findConsensusWindowAtHeight(
    prisma,
    signature.validatorAddress,
    signature.committedBlockHeight,
  );
  if (window) {
    return {
      attributionStatus: OPERATOR_SIGNING_ATTRIBUTION_STATUS.attributed,
      slotId: window.slotId,
      operatorAddress: window.operatorAddress,
      consensusPower: window.consensusPower,
      consensusWindowId: window.id,
    };
  }

  const hasCoverage = await hasAnyConsensusWindowAtHeight(
    prisma,
    signature.committedBlockHeight,
  );
  return status(
    hasCoverage
      ? OPERATOR_SIGNING_ATTRIBUTION_STATUS.unmappedValidator
      : OPERATOR_SIGNING_ATTRIBUTION_STATUS.noConsensusWindow,
  );
}

async function hasAnyConsensusWindowAtHeight(
  prisma: Pick<OperatorSigningEvidenceProjectionPrisma, 'coreSlotConsensusWindow'>,
  height: bigint,
): Promise<boolean> {
  const count = await prisma.coreSlotConsensusWindow.count({
    where: {
      effectiveFromHeight: { lte: height },
      OR: [{ effectiveToHeight: null }, { effectiveToHeight: { gt: height } }],
    },
  });
  return count > 0;
}

async function hasInvalidValidatorAddressFailure(
  prisma: Pick<OperatorSigningEvidenceProjectionPrisma, 'projectionFailure'>,
  signature: BlockSignatureSource,
): Promise<boolean> {
  const failure = await prisma.projectionFailure.findFirst({
    where: {
      projectionName: BLOCK_SIGNATURES_PROJECTION,
      sourceHeight: signature.sourceBlockHeight,
      failureKind: 'invalid_validator_address',
      resolved: false,
    },
  });
  return failure !== null;
}

function status(attributionStatus: string): AttributionResult {
  return {
    attributionStatus,
    slotId: null,
    operatorAddress: null,
    consensusPower: null,
    consensusWindowId: null,
  };
}

function malformed(
  attributionStatus: string,
  failureKind: ProjectionFailureInput['failureKind'],
  error: string,
): AttributionResult {
  return {
    ...status(attributionStatus),
    failure: { failureKind, error },
  };
}

function evidenceData(
  signature: BlockSignatureSource,
  attribution: AttributionResult,
): Record<string, unknown> {
  return {
    signatureKey: signature.signatureKey,
    sourceBlockHeight: signature.sourceBlockHeight,
    committedBlockHeight: signature.committedBlockHeight,
    signatureIndex: signature.signatureIndex,
    validatorAddress: signature.validatorAddress,
    slotId: attribution.slotId,
    operatorAddress: attribution.operatorAddress,
    consensusPower: attribution.consensusPower,
    consensusWindowId: attribution.consensusWindowId,
    attributionStatus: attribution.attributionStatus,
    blockIdFlag: signature.blockIdFlag,
    blockIdFlagCode: signature.blockIdFlagCode,
    signed: signature.signed,
    rawSignatureJson: signature.rawSignatureJson,
  };
}

function evidenceUpdateData(
  signature: BlockSignatureSource,
  attribution: AttributionResult,
): Record<string, unknown> {
  const data = evidenceData(signature, attribution);
  delete data.signatureKey;
  delete data.sourceBlockHeight;
  delete data.signatureIndex;
  return data;
}

async function createFailure(
  prisma: OperatorSigningEvidenceProjectionPrisma,
  input: Omit<ProjectionFailureInput, 'projectionName' | 'module'>,
): Promise<void> {
  const data = withProjectionFailureKey({
    projectionName: OPERATOR_SIGNING_EVIDENCE_PROJECTION,
    module: 'cometbft',
    ...input,
  });
  await prisma.projectionFailure.upsert({
    where: { failureKey: data.failureKey },
    create: data,
    update: { ...data, resolved: false, resolvedAt: null },
  });
}
