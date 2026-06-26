import {
  haltProjectionCursorError,
  updateProjectionCursorSuccess,
  type ProjectionCursorPrisma,
} from './cursor.js';
import {
  findConsensusWindowAtHeight,
  type ConsensusWindowSource,
} from './coreslot-temporal-map.js';
import {
  PROPOSER_ATTRIBUTION_PROJECTION,
  PROPOSER_ATTRIBUTION_STATUS,
  type ProjectionFailureInput,
  withProjectionFailureKey,
} from './types.js';

export interface ProjectProposerAttributionRangeArgs {
  prisma: ProposerAttributionProjectionPrisma;
  chainId: string;
  startHeight: bigint;
  endHeight: bigint;
}

export interface ProjectProposerAttributionHeightArgs {
  prisma: ProposerAttributionProjectionPrisma;
  chainId: string;
  height: bigint;
}

export interface ProjectProposerAttributionResult {
  height: bigint;
  rowsWritten: number;
  failuresCreated: number;
}

export interface ProposerAttributionProjectionPrisma extends ProjectionCursorPrisma {
  block: {
    findMany(args: unknown): Promise<BlockProposerSource[]>;
  };
  coreSlotConsensusWindow: {
    findFirst(args: unknown): Promise<ConsensusWindowSource | null>;
    findMany(args: unknown): Promise<ConsensusWindowSource[]>;
    create(args: unknown): Promise<ConsensusWindowSource>;
    update(args: unknown): Promise<ConsensusWindowSource>;
    deleteMany(args?: unknown): Promise<unknown>;
    count(args: unknown): Promise<number>;
  };
  blockProposerAttribution: {
    upsert(args: unknown): Promise<unknown>;
  };
  projectionFailure: {
    upsert(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: ProposerAttributionProjectionPrisma) => Promise<T>): Promise<T>;
}

interface BlockProposerSource {
  height: bigint;
  proposerAddress: string | null;
}

interface Attribution {
  attributionStatus: string;
  proposerAddress: string | null;
  slotId: bigint | null;
  operatorAddress: string | null;
  consensusWindowId: bigint | null;
  failure?: Omit<ProjectionFailureInput, 'projectionName' | 'module' | 'sourceHeight'>;
}

interface Counters {
  rowsWritten: number;
  failuresCreated: number;
}

export async function projectProposerAttributionRange(
  args: ProjectProposerAttributionRangeArgs,
): Promise<ProjectProposerAttributionResult[]> {
  const blocks = await args.prisma.block.findMany({
    where: { height: { gte: args.startHeight, lte: args.endHeight } },
    select: { height: true },
    orderBy: [{ height: 'asc' }],
  });

  const results: ProjectProposerAttributionResult[] = [];
  for (const block of blocks) {
    results.push(await projectProposerAttributionHeight({
      prisma: args.prisma,
      chainId: args.chainId,
      height: block.height,
    }));
  }

  if (args.endHeight >= args.startHeight) {
    await updateProjectionCursorSuccess(
      args.prisma,
      PROPOSER_ATTRIBUTION_PROJECTION,
      args.chainId,
      args.endHeight,
    );
  }
  return results;
}

export async function projectProposerAttributionHeight(
  args: ProjectProposerAttributionHeightArgs,
): Promise<ProjectProposerAttributionResult> {
  const { prisma, chainId, height } = args;

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.projectionFailure.deleteMany({
        where: {
          projectionName: PROPOSER_ATTRIBUTION_PROJECTION,
          sourceHeight: height,
          resolved: false,
        },
      });

      const counters: Counters = { rowsWritten: 0, failuresCreated: 0 };
      const blocks = await tx.block.findMany({
        where: { height },
        select: { height: true, proposerAddress: true },
      });

      for (const block of blocks) {
        const attribution = await classifyProposer(tx, block);
        if (attribution.failure) {
          await createFailure(tx, { sourceHeight: height, ...attribution.failure });
          counters.failuresCreated += 1;
        }
        await tx.blockProposerAttribution.upsert({
          where: { attributionKey: `${PROPOSER_ATTRIBUTION_PROJECTION}:${block.height}` },
          create: attributionData(block, attribution),
          update: attributionUpdateData(block, attribution),
        });
        counters.rowsWritten += 1;
      }

      await updateProjectionCursorSuccess(tx, PROPOSER_ATTRIBUTION_PROJECTION, chainId, height);
      return { height, ...counters };
    });
  } catch (error) {
    await haltProjectionCursorError(prisma, PROPOSER_ATTRIBUTION_PROJECTION, chainId, height, error);
    throw error;
  }
}

async function classifyProposer(
  prisma: ProposerAttributionProjectionPrisma,
  block: BlockProposerSource,
): Promise<Attribution> {
  if (block.proposerAddress === null || block.proposerAddress.trim() === '') {
    return status(PROPOSER_ATTRIBUTION_STATUS.missingProposer, null);
  }

  // Block.proposerAddress is CometBFT uppercase hex; CoreSlotConsensusWindow.consensusAddress is
  // lowercase. Normalize before the join.
  const normalized = block.proposerAddress.toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    return {
      ...status(PROPOSER_ATTRIBUTION_STATUS.invalidProposerAddress, normalized),
      failure: {
        failureKind: 'invalid_proposer_address',
        error: `Block ${block.height} proposer address is not 40-char hex: ${block.proposerAddress}`,
      },
    };
  }

  // The proposer of block N belongs to height N (no -1 shift).
  const window = await findConsensusWindowAtHeight(prisma, normalized, block.height);
  if (window) {
    return {
      attributionStatus: PROPOSER_ATTRIBUTION_STATUS.attributed,
      proposerAddress: normalized,
      slotId: window.slotId,
      operatorAddress: window.operatorAddress,
      consensusWindowId: window.id,
    };
  }

  const hasCoverage = await hasAnyConsensusWindowAtHeight(prisma, block.height);
  return status(
    hasCoverage
      ? PROPOSER_ATTRIBUTION_STATUS.unmappedValidator
      : PROPOSER_ATTRIBUTION_STATUS.noConsensusWindow,
    normalized,
  );
}

async function hasAnyConsensusWindowAtHeight(
  prisma: Pick<ProposerAttributionProjectionPrisma, 'coreSlotConsensusWindow'>,
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

function status(attributionStatus: string, proposerAddress: string | null): Attribution {
  return {
    attributionStatus,
    proposerAddress,
    slotId: null,
    operatorAddress: null,
    consensusWindowId: null,
  };
}

function attributionData(
  block: BlockProposerSource,
  attribution: Attribution,
): Record<string, unknown> {
  return {
    attributionKey: `${PROPOSER_ATTRIBUTION_PROJECTION}:${block.height}`,
    height: block.height,
    proposerAddress: attribution.proposerAddress,
    rawProposerAddress: block.proposerAddress,
    slotId: attribution.slotId,
    operatorAddress: attribution.operatorAddress,
    consensusWindowId: attribution.consensusWindowId,
    attributionStatus: attribution.attributionStatus,
  };
}

function attributionUpdateData(
  block: BlockProposerSource,
  attribution: Attribution,
): Record<string, unknown> {
  const data = attributionData(block, attribution);
  delete data.attributionKey;
  delete data.height;
  return data;
}

async function createFailure(
  prisma: Pick<ProposerAttributionProjectionPrisma, 'projectionFailure'>,
  input: Omit<ProjectionFailureInput, 'projectionName' | 'module'>,
): Promise<void> {
  const data = withProjectionFailureKey({
    projectionName: PROPOSER_ATTRIBUTION_PROJECTION,
    module: 'cometbft',
    ...input,
  });
  await prisma.projectionFailure.upsert({
    where: { failureKey: data.failureKey },
    create: data,
    update: { ...data, resolved: false, resolvedAt: null },
  });
}
