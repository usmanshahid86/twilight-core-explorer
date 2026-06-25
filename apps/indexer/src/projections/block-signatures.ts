import {
  haltProjectionCursorError,
  updateProjectionCursorSuccess,
  type ProjectionCursorPrisma,
} from './cursor.js';
import {
  BLOCK_SIGNATURES_PROJECTION,
  type ProjectionFailureInput,
  type ProjectionFailureKind,
  withProjectionFailureKey,
} from './types.js';

export interface ProjectBlockSignaturesRangeArgs {
  prisma: BlockSignaturesProjectionPrisma;
  chainId: string;
  startHeight: bigint;
  endHeight: bigint;
}

export interface ProjectBlockSignaturesHeightArgs {
  prisma: BlockSignaturesProjectionPrisma;
  chainId: string;
  height: bigint;
}

export interface ProjectBlockSignaturesResult {
  height: bigint;
  rowsWritten: number;
  failuresCreated: number;
}

export interface BlockSignaturesProjectionPrisma extends ProjectionCursorPrisma {
  block: {
    findMany(args: unknown): Promise<Array<Pick<BlockSource, 'height'>>>;
    findUnique(args: unknown): Promise<BlockSource | null>;
  };
  blockSignature: { upsert(args: unknown): Promise<unknown> };
  projectionFailure: {
    upsert(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: BlockSignaturesProjectionPrisma) => Promise<T>): Promise<T>;
}

interface BlockSource {
  height: bigint;
  rawJson: unknown;
}

interface Counters {
  rowsWritten: number;
  failuresCreated: number;
}

interface LastCommitSource {
  height: bigint | undefined;
  hasInvalidHeight: boolean;
  signatures: unknown[] | undefined;
  raw: unknown;
}

export interface ExtractedCommitSignature {
  signatureKey: string;
  sourceBlockHeight: bigint;
  committedBlockHeight: bigint;
  signatureIndex: number;
  validatorAddress: string | null;
  blockIdFlag: string | null;
  blockIdFlagCode: number | null;
  timestamp: Date | null;
  signature: string | null;
  signed: boolean;
  rawSignatureJson: unknown;
  failure?: {
    failureKind: ProjectionFailureKind;
    error: string;
    rawSignatureJson: unknown;
  } | undefined;
}

export async function projectBlockSignaturesRange(
  args: ProjectBlockSignaturesRangeArgs,
): Promise<ProjectBlockSignaturesResult[]> {
  const results: ProjectBlockSignaturesResult[] = [];

  // The projection operates over indexed blocks, not over every numeric height in a sparse
  // local smoke DB. A missing height is not evidence of missing raw block data unless that
  // specific height is projected directly.
  const blocks = await args.prisma.block.findMany({
    where: { height: { gte: args.startHeight, lte: args.endHeight } },
    select: { height: true },
    orderBy: [{ height: 'asc' }],
  });

  for (const block of blocks) {
    const height = block.height;
    results.push(await projectBlockSignaturesHeight({
      prisma: args.prisma,
      chainId: args.chainId,
      height,
    }));
  }

  if (args.endHeight >= args.startHeight) {
    await updateProjectionCursorSuccess(
      args.prisma,
      BLOCK_SIGNATURES_PROJECTION,
      args.chainId,
      args.endHeight,
    );
  }
  return results;
}

export async function projectBlockSignaturesHeight(
  args: ProjectBlockSignaturesHeightArgs,
): Promise<ProjectBlockSignaturesResult> {
  const { prisma, chainId, height } = args;
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.projectionFailure.deleteMany({
        where: {
          projectionName: BLOCK_SIGNATURES_PROJECTION,
          sourceHeight: height,
          resolved: false,
        },
      });

      const counters: Counters = { rowsWritten: 0, failuresCreated: 0 };
      const block = await tx.block.findUnique({
        where: { height },
        select: { height: true, rawJson: true },
      });

      if (!block || block.rawJson === null || block.rawJson === undefined) {
        await createFailure(tx, {
          sourceHeight: height,
          failureKind: 'missing_block_raw',
          error: `Block ${height} is missing or has no rawJson payload.`,
        });
        counters.failuresCreated += 1;
        await updateProjectionCursorSuccess(tx, BLOCK_SIGNATURES_PROJECTION, chainId, height);
        return { height, ...counters };
      }

      const lastCommit = extractLastCommit(block.rawJson);
      if (!lastCommit) {
        if (height > 1n) {
          await createFailure(tx, {
            sourceHeight: height,
            failureKind: 'missing_last_commit',
            rawEventJson: block.rawJson,
            error: `Block ${height} rawJson does not contain last_commit.`,
          });
          counters.failuresCreated += 1;
        }
        await updateProjectionCursorSuccess(tx, BLOCK_SIGNATURES_PROJECTION, chainId, height);
        return { height, ...counters };
      }

      const committedBlockHeight = resolveCommittedBlockHeight(height, lastCommit);
      if (lastCommit.hasInvalidHeight) {
        await createFailure(tx, {
          sourceHeight: height,
          failureKind: 'invalid_height',
          rawEventJson: lastCommit.raw,
          error: `Block ${height} last_commit.height is invalid; used sourceBlockHeight - 1 fallback.`,
        });
        counters.failuresCreated += 1;
      }

      if (!lastCommit.signatures || lastCommit.signatures.length === 0) {
        if (height > 1n) {
          await createFailure(tx, {
            sourceHeight: height,
            failureKind: 'missing_signatures',
            rawEventJson: lastCommit.raw,
            error: `Block ${height} last_commit contains no signatures.`,
          });
          counters.failuresCreated += 1;
        }
        await updateProjectionCursorSuccess(tx, BLOCK_SIGNATURES_PROJECTION, chainId, height);
        return { height, ...counters };
      }

      for (let index = 0; index < lastCommit.signatures.length; index += 1) {
        const extracted = extractCommitSignature({
          sourceBlockHeight: height,
          committedBlockHeight,
          signatureIndex: index,
          rawSignature: lastCommit.signatures[index],
        });

        if (extracted.failure) {
          await createFailure(tx, {
            sourceHeight: height,
            failureKind: extracted.failure.failureKind,
            rawEventJson: extracted.failure.rawSignatureJson,
            error: extracted.failure.error,
          });
          counters.failuresCreated += 1;
        }

        if (!isRecord(extracted.rawSignatureJson)) continue;

        await tx.blockSignature.upsert({
          where: { signatureKey: extracted.signatureKey },
          create: {
            signatureKey: extracted.signatureKey,
            sourceBlockHeight: extracted.sourceBlockHeight,
            committedBlockHeight: extracted.committedBlockHeight,
            signatureIndex: extracted.signatureIndex,
            validatorAddress: extracted.validatorAddress,
            blockIdFlag: extracted.blockIdFlag,
            blockIdFlagCode: extracted.blockIdFlagCode,
            timestamp: extracted.timestamp,
            signature: extracted.signature,
            signed: extracted.signed,
            rawSignatureJson: extracted.rawSignatureJson,
          },
          update: {
            committedBlockHeight: extracted.committedBlockHeight,
            validatorAddress: extracted.validatorAddress,
            blockIdFlag: extracted.blockIdFlag,
            blockIdFlagCode: extracted.blockIdFlagCode,
            timestamp: extracted.timestamp,
            signature: extracted.signature,
            signed: extracted.signed,
            rawSignatureJson: extracted.rawSignatureJson,
          },
        });
        counters.rowsWritten += 1;
      }

      await updateProjectionCursorSuccess(tx, BLOCK_SIGNATURES_PROJECTION, chainId, height);
      return { height, ...counters };
    });
  } catch (error) {
    await haltProjectionCursorError(prisma, BLOCK_SIGNATURES_PROJECTION, chainId, height, error);
    throw error;
  }
}

export function extractLastCommit(rawJson: unknown): LastCommitSource | null {
  const root = asRecord(rawJson);
  const result = asRecord(root.result);
  const resultBlock = asRecord(result.block);
  const rootBlock = asRecord(root.block);
  const block =
    resultBlock.last_commit !== undefined || resultBlock.lastCommit !== undefined
      ? resultBlock
      : rootBlock;
  const lastCommit = asRecord(block.last_commit ?? block.lastCommit);
  if (Object.keys(lastCommit).length === 0) return null;

  const heightValue = lastCommit.height ?? lastCommit.Height;
  const parsedHeight = parseBigInt(readString(heightValue));
  return {
    height: parsedHeight,
    hasInvalidHeight: heightValue !== undefined && parsedHeight === undefined,
    signatures: Array.isArray(lastCommit.signatures) ? lastCommit.signatures : undefined,
    raw: lastCommit,
  };
}

export function extractCommitSignatures(rawJson: unknown): unknown[] {
  return extractLastCommit(rawJson)?.signatures ?? [];
}

export function extractCommitSignature(args: {
  sourceBlockHeight: bigint;
  committedBlockHeight: bigint;
  signatureIndex: number;
  rawSignature: unknown;
}): ExtractedCommitSignature {
  const raw = args.rawSignature;
  if (!isRecord(raw)) {
    return {
      signatureKey: makeSignatureKey({
        sourceBlockHeight: args.sourceBlockHeight,
        committedBlockHeight: args.committedBlockHeight,
        signatureIndex: args.signatureIndex,
        validatorAddress: null,
      }),
      sourceBlockHeight: args.sourceBlockHeight,
      committedBlockHeight: args.committedBlockHeight,
      signatureIndex: args.signatureIndex,
      validatorAddress: null,
      blockIdFlag: null,
      blockIdFlagCode: null,
      timestamp: null,
      signature: null,
      signed: false,
      rawSignatureJson: raw ?? null,
      failure: {
        failureKind: 'invalid_signature_payload',
        error: `Signature ${args.signatureIndex} in block ${args.sourceBlockHeight} is not an object.`,
        rawSignatureJson: raw ?? null,
      },
    };
  }

  const validatorAddressRaw = readString(raw.validator_address ?? raw.validatorAddress);
  const validatorAddressResult = normalizeConsensusAddress(validatorAddressRaw);
  const flag = parseBlockIdFlag(raw.block_id_flag ?? raw.blockIdFlag);
  const timestamp = parseDate(raw.timestamp);
  const signature = readString(raw.signature) ?? null;
  const validatorAddress = validatorAddressResult.value;

  return {
    signatureKey: makeSignatureKey({
      sourceBlockHeight: args.sourceBlockHeight,
      committedBlockHeight: args.committedBlockHeight,
      signatureIndex: args.signatureIndex,
      validatorAddress,
    }),
    sourceBlockHeight: args.sourceBlockHeight,
    committedBlockHeight: args.committedBlockHeight,
    signatureIndex: args.signatureIndex,
    validatorAddress,
    blockIdFlag: flag.raw,
    blockIdFlagCode: flag.code,
    timestamp,
    signature,
    signed: flag.signed,
    rawSignatureJson: raw,
    failure: validatorAddressResult.error
      ? {
          failureKind: 'invalid_validator_address',
          error: validatorAddressResult.error,
          rawSignatureJson: raw,
        }
      : undefined,
  };
}

export function normalizeConsensusAddress(
  address: string | undefined,
): { value: string | null; error?: string | undefined } {
  if (address === undefined || address.trim() === '') {
    return { value: null };
  }
  const value = address.trim();
  if (!/^[0-9a-fA-F]{40}$/.test(value)) {
    return {
      value: null,
      error: `Validator address is not a 40-character hex consensus address: ${value}`,
    };
  }
  return { value: value.toLowerCase() };
}

export function parseBlockIdFlag(value: unknown): {
  raw: string | null;
  code: number | null;
  signed: boolean;
} {
  const raw = readString(value) ?? null;
  const normalized = raw?.trim().toLowerCase();
  let code: number | null = null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    code = Math.trunc(value);
  } else if (normalized && /^\d+$/.test(normalized)) {
    code = Number(normalized);
  } else if (normalized === 'block_id_flag_absent' || normalized === 'absent') {
    code = 1;
  } else if (
    normalized === 'block_id_flag_commit'
    || normalized === 'commit'
    || normalized === 'signed'
  ) {
    code = 2;
  } else if (normalized === 'block_id_flag_nil' || normalized === 'nil') {
    code = 3;
  }

  return { raw, code, signed: code === 2 };
}

export function makeSignatureKey(args: {
  sourceBlockHeight: bigint;
  committedBlockHeight: bigint;
  signatureIndex: number;
  validatorAddress: string | null;
}): string {
  return [
    args.sourceBlockHeight.toString(),
    args.committedBlockHeight.toString(),
    args.signatureIndex.toString(),
    args.validatorAddress ?? '',
  ].join(':');
}

function resolveCommittedBlockHeight(
  sourceBlockHeight: bigint,
  lastCommit: LastCommitSource,
): bigint {
  return lastCommit.height ?? (sourceBlockHeight > 0n ? sourceBlockHeight - 1n : 0n);
}

async function createFailure(
  prisma: BlockSignaturesProjectionPrisma,
  input: Omit<ProjectionFailureInput, 'projectionName' | 'module'>,
): Promise<void> {
  const data = withProjectionFailureKey({
    projectionName: BLOCK_SIGNATURES_PROJECTION,
    module: 'cometbft',
    ...input,
  });
  await prisma.projectionFailure.upsert({
    where: { failureKey: data.failureKey },
    create: data,
    update: { ...data, resolved: false, resolvedAt: null },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString();
  return undefined;
}

function parseBigInt(value: string | undefined): bigint | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function parseDate(value: unknown): Date | null {
  const text = readString(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
