import {
  projectCoreSlotMetadataRange,
  type CoreSlotMetadataProjectionPrisma,
} from './coreslot-metadata.js';
import {
  projectCoreSlotLifecycleRange,
  type CoreSlotLifecycleProjectionPrisma,
} from './coreslot-lifecycle.js';
import {
  projectCoreSlotPayoutRange,
  type CoreSlotPayoutProjectionPrisma,
} from './coreslot-payout.js';
import {
  projectCoreSlotParamsRange,
  type CoreSlotParamsProjectionPrisma,
} from './coreslot-params.js';
import {
  projectCoreSlotKeyRotationRange,
  type CoreSlotKeyRotationProjectionPrisma,
} from './coreslot-key-rotation.js';
import {
  projectCoreSlotTemporalMapRange,
  type CoreSlotTemporalMapProjectionPrisma,
} from './coreslot-temporal-map.js';
import {
  resetCoreSlotSemanticProjections,
  type ResetCoreSlotSemanticPrisma,
} from './reset-semantic.js';
import {
  CORESLOT_KEY_ROTATION_PROJECTION,
  CORESLOT_LIFECYCLE_PROJECTION,
  CORESLOT_METADATA_PROJECTION,
  CORESLOT_PARAMS_PROJECTION,
  CORESLOT_PAYOUT_PROJECTION,
  CORESLOT_TEMPORAL_MAP_PROJECTION,
} from './types.js';

/**
 * Deterministic CoreSlot semantic rebuild order.
 *
 * metadata     -> establishes CoreSlotProjection.metadataJson
 * lifecycle    -> establishes status/operator/consensus/power without clearing metadata
 * payout       -> establishes payoutAddress without clearing metadata/lifecycle fields
 * params       -> global module-change history only, never mutates CoreSlotProjection
 * key_rotation -> applies confirmed consensus-address rotations after the base state
 * temporal_map -> derives ACTIVE consensus-address windows from lifecycle + rotations
 */
export const CORESLOT_SEMANTIC_REBUILD_ORDER = [
  CORESLOT_METADATA_PROJECTION,
  CORESLOT_LIFECYCLE_PROJECTION,
  CORESLOT_PAYOUT_PROJECTION,
  CORESLOT_PARAMS_PROJECTION,
  CORESLOT_KEY_ROTATION_PROJECTION,
  CORESLOT_TEMPORAL_MAP_PROJECTION,
] as const;

export interface CoreSlotSemanticRebuildStep {
  projectionName: string;
  run(args: { startHeight: bigint; endHeight: bigint }): Promise<void>;
}

export interface CoreSlotSemanticRebuildResult {
  reset: boolean;
  startHeight: bigint;
  endHeight: bigint;
  ranProjections: string[];
}

export class CoreSlotSemanticRebuildError extends Error {
  readonly projectionName: string;
  readonly ranProjections: string[];

  constructor(
    projectionName: string,
    ranProjections: string[],
    options?: { cause?: unknown },
  ) {
    const causeMessage = options?.cause instanceof Error ? `: ${options.cause.message}` : '';
    super(`CoreSlot semantic rebuild failed during ${projectionName} projection${causeMessage}`);
    this.name = 'CoreSlotSemanticRebuildError';
    this.projectionName = projectionName;
    this.ranProjections = ranProjections;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export interface RunCoreSlotSemanticRebuildArgs {
  reset: boolean;
  resetSemantic: () => Promise<void>;
  steps: CoreSlotSemanticRebuildStep[];
  startHeight: bigint;
  endHeight: bigint;
}

/**
 * Core orchestration. Resets first (when requested), then runs each projection
 * step in the given order over the same height range. If a step throws, no later
 * step runs and a CoreSlotSemanticRebuildError naming the failed projection is
 * raised. Generic canonical rows are never touched here; only the injected steps
 * and reset closure read/write the database.
 */
export async function runCoreSlotSemanticRebuild(
  args: RunCoreSlotSemanticRebuildArgs,
): Promise<CoreSlotSemanticRebuildResult> {
  if (args.reset) {
    await args.resetSemantic();
  }

  const ranProjections: string[] = [];
  for (const step of args.steps) {
    try {
      await step.run({ startHeight: args.startHeight, endHeight: args.endHeight });
    } catch (error) {
      throw new CoreSlotSemanticRebuildError(step.projectionName, [...ranProjections], {
        cause: error,
      });
    }
    ranProjections.push(step.projectionName);
  }

  return {
    reset: args.reset,
    startHeight: args.startHeight,
    endHeight: args.endHeight,
    ranProjections,
  };
}

export interface CoreSlotSemanticRebuildProjectors {
  projectMetadata: typeof projectCoreSlotMetadataRange;
  projectLifecycle: typeof projectCoreSlotLifecycleRange;
  projectPayout: typeof projectCoreSlotPayoutRange;
  projectParams: typeof projectCoreSlotParamsRange;
  projectKeyRotation: typeof projectCoreSlotKeyRotationRange;
  projectTemporalMap: typeof projectCoreSlotTemporalMapRange;
}

export interface BuildCoreSlotSemanticRebuildStepsArgs {
  prisma: unknown;
  chainId: string;
  projectors?: Partial<CoreSlotSemanticRebuildProjectors>;
}

/**
 * Build the default ordered step list that wires the real range projectors.
 * Each projector keeps and advances its own ProjectionCursor; the combined
 * command does not introduce a separate combined cursor.
 */
export function buildCoreSlotSemanticRebuildSteps(
  args: BuildCoreSlotSemanticRebuildStepsArgs,
): CoreSlotSemanticRebuildStep[] {
  const { prisma, chainId } = args;
  const projectMetadata = args.projectors?.projectMetadata ?? projectCoreSlotMetadataRange;
  const projectLifecycle = args.projectors?.projectLifecycle ?? projectCoreSlotLifecycleRange;
  const projectPayout = args.projectors?.projectPayout ?? projectCoreSlotPayoutRange;
  const projectParams = args.projectors?.projectParams ?? projectCoreSlotParamsRange;
  const projectKeyRotation = args.projectors?.projectKeyRotation ?? projectCoreSlotKeyRotationRange;
  const projectTemporalMap = args.projectors?.projectTemporalMap ?? projectCoreSlotTemporalMapRange;

  return [
    {
      projectionName: CORESLOT_METADATA_PROJECTION,
      run: async ({ startHeight, endHeight }) => {
        await projectMetadata({
          prisma: prisma as CoreSlotMetadataProjectionPrisma,
          chainId,
          startHeight,
          endHeight,
        });
      },
    },
    {
      projectionName: CORESLOT_LIFECYCLE_PROJECTION,
      run: async ({ startHeight, endHeight }) => {
        await projectLifecycle({
          prisma: prisma as CoreSlotLifecycleProjectionPrisma,
          chainId,
          startHeight,
          endHeight,
        });
      },
    },
    {
      projectionName: CORESLOT_PAYOUT_PROJECTION,
      run: async ({ startHeight, endHeight }) => {
        await projectPayout({
          prisma: prisma as CoreSlotPayoutProjectionPrisma,
          chainId,
          startHeight,
          endHeight,
        });
      },
    },
    {
      projectionName: CORESLOT_PARAMS_PROJECTION,
      run: async ({ startHeight, endHeight }) => {
        await projectParams({
          prisma: prisma as CoreSlotParamsProjectionPrisma,
          chainId,
          startHeight,
          endHeight,
        });
      },
    },
    {
      projectionName: CORESLOT_KEY_ROTATION_PROJECTION,
      run: async ({ startHeight, endHeight }) => {
        await projectKeyRotation({
          prisma: prisma as CoreSlotKeyRotationProjectionPrisma,
          chainId,
          startHeight,
          endHeight,
        });
      },
    },
    {
      projectionName: CORESLOT_TEMPORAL_MAP_PROJECTION,
      run: async ({ startHeight, endHeight }) => {
        await projectTemporalMap({
          prisma: prisma as CoreSlotTemporalMapProjectionPrisma,
          chainId,
          startHeight,
          endHeight,
        });
      },
    },
  ];
}

export interface ProjectCoreSlotSemanticRebuildArgs {
  prisma: unknown;
  chainId: string;
  startHeight: bigint;
  endHeight: bigint;
  reset: boolean;
  resetSemantic?: (prisma: ResetCoreSlotSemanticPrisma) => Promise<void>;
  projectors?: Partial<CoreSlotSemanticRebuildProjectors>;
}

/**
 * High-level combined CoreSlot semantic rebuild. Wires the default reset and the
 * default ordered projectors against a single prisma client, then delegates to
 * runCoreSlotSemanticRebuild. Test seams (`resetSemantic`, `projectors`) allow
 * verifying ordering / reset-before-project / failure-stop behavior without a DB.
 */
export async function projectCoreSlotSemanticRebuild(
  args: ProjectCoreSlotSemanticRebuildArgs,
): Promise<CoreSlotSemanticRebuildResult> {
  const resetSemantic = args.resetSemantic ?? resetCoreSlotSemanticProjections;
  const steps = buildCoreSlotSemanticRebuildSteps({
    prisma: args.prisma,
    chainId: args.chainId,
    ...(args.projectors ? { projectors: args.projectors } : {}),
  });

  return runCoreSlotSemanticRebuild({
    reset: args.reset,
    resetSemantic: () => resetSemantic(args.prisma as ResetCoreSlotSemanticPrisma),
    steps,
    startHeight: args.startHeight,
    endHeight: args.endHeight,
  });
}
