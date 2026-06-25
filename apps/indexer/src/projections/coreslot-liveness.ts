import {
  haltProjectionCursorError,
  updateProjectionCursorSuccess,
  type ProjectionCursorPrisma,
} from './cursor.js';
import {
  findActiveCoreSlotWindowsAtHeight,
  type ConsensusWindowSource,
} from './coreslot-temporal-map.js';
import {
  CORESLOT_LIVENESS_MISS_CAUSE,
  CORESLOT_LIVENESS_PROJECTION,
  CORESLOT_LIVENESS_STATUS,
  OPERATOR_SIGNING_ATTRIBUTION_STATUS,
  type ProjectionFailureInput,
  withProjectionFailureKey,
} from './types.js';

export interface ProjectCoreSlotLivenessRangeArgs {
  prisma: CoreSlotLivenessProjectionPrisma;
  chainId: string;
  startHeight: bigint;
  endHeight: bigint;
}

export interface ProjectCoreSlotLivenessHeightArgs {
  prisma: CoreSlotLivenessProjectionPrisma;
  chainId: string;
  sourceBlockHeight: bigint;
}

export interface ProjectCoreSlotLivenessResult {
  sourceBlockHeight: bigint;
  rowsWritten: number;
  failuresCreated: number;
}

export interface CoreSlotLivenessProjectionPrisma extends ProjectionCursorPrisma {
  operatorSigningEvidence: {
    findMany(args: unknown): Promise<OperatorSigningEvidenceSource[]>;
  };
  coreSlotConsensusWindow: {
    findMany(args: unknown): Promise<ConsensusWindowSource[]>;
  };
  coreSlotLivenessEvidence: {
    deleteMany(args?: unknown): Promise<unknown>;
    createMany(args: unknown): Promise<unknown>;
  };
  projectionFailure: {
    upsert(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: CoreSlotLivenessProjectionPrisma) => Promise<T>): Promise<T>;
}

interface OperatorSigningEvidenceSource {
  signatureKey: string;
  sourceBlockHeight: bigint;
  committedBlockHeight: bigint;
  slotId: bigint | null;
  operatorAddress: string | null;
  consensusPower: bigint | null;
  consensusWindowId: bigint | null;
  attributionStatus: string;
  blockIdFlag: string | null;
  blockIdFlagCode: number | null;
  signed: boolean;
}

interface Counters {
  rowsWritten: number;
  failuresCreated: number;
}

type HeightFailure = Omit<ProjectionFailureInput, 'projectionName' | 'module' | 'sourceHeight'>;

const FLAG_COMMIT = 2;
const FLAG_NIL = 3;
const FLAG_ABSENT = 1;

export async function projectCoreSlotLivenessRange(
  args: ProjectCoreSlotLivenessRangeArgs,
): Promise<ProjectCoreSlotLivenessResult[]> {
  // Cursor/range axis matches 8a/8b: containing block sourceBlockHeight. The committed heights
  // we actually evaluate are READ from OperatorSigningEvidence.committedBlockHeight, never derived.
  const sources = await args.prisma.operatorSigningEvidence.findMany({
    where: { sourceBlockHeight: { gte: args.startHeight, lte: args.endHeight } },
    select: { sourceBlockHeight: true },
    distinct: ['sourceBlockHeight'],
    orderBy: [{ sourceBlockHeight: 'asc' }],
  });

  const results: ProjectCoreSlotLivenessResult[] = [];
  for (const source of sources) {
    results.push(await projectCoreSlotLivenessHeight({
      prisma: args.prisma,
      chainId: args.chainId,
      sourceBlockHeight: source.sourceBlockHeight,
    }));
  }

  if (args.endHeight >= args.startHeight) {
    await updateProjectionCursorSuccess(
      args.prisma,
      CORESLOT_LIVENESS_PROJECTION,
      args.chainId,
      args.endHeight,
    );
  }
  return results;
}

export async function projectCoreSlotLivenessHeight(
  args: ProjectCoreSlotLivenessHeightArgs,
): Promise<ProjectCoreSlotLivenessResult> {
  const { prisma, chainId, sourceBlockHeight } = args;

  try {
    return await prisma.$transaction(async (tx) => {
      // Clear stale unresolved failures for this source block; re-created below only if still bad.
      await tx.projectionFailure.deleteMany({
        where: {
          projectionName: CORESLOT_LIVENESS_PROJECTION,
          sourceHeight: sourceBlockHeight,
          resolved: false,
        },
      });

      const counters: Counters = { rowsWritten: 0, failuresCreated: 0 };

      const evidence = await tx.operatorSigningEvidence.findMany({
        where: { sourceBlockHeight },
        orderBy: [{ committedBlockHeight: 'asc' }, { signatureIndex: 'asc' }],
      });

      // One source block normally carries exactly one committed height, but group defensively.
      const byCommitted = groupByCommittedHeight(evidence);

      for (const [committedHeight, rows] of byCommitted) {
        await projectCommittedHeight(tx, sourceBlockHeight, committedHeight, rows, counters);
      }

      await updateProjectionCursorSuccess(
        tx,
        CORESLOT_LIVENESS_PROJECTION,
        chainId,
        sourceBlockHeight,
      );
      return { sourceBlockHeight, ...counters };
    });
  } catch (error) {
    await haltProjectionCursorError(
      prisma,
      CORESLOT_LIVENESS_PROJECTION,
      chainId,
      sourceBlockHeight,
      error,
    );
    throw error;
  }
}

async function projectCommittedHeight(
  tx: CoreSlotLivenessProjectionPrisma,
  sourceBlockHeight: bigint,
  committedHeight: bigint,
  rows: OperatorSigningEvidenceSource[],
  counters: Counters,
): Promise<void> {
  const expected = await findActiveCoreSlotWindowsAtHeight(tx, committedHeight);

  const evaluation = evaluateHeight(committedHeight, expected, rows);
  if (evaluation.failure) {
    await createFailure(tx, { sourceHeight: sourceBlockHeight, committedHeight, ...evaluation.failure });
    counters.failuresCreated += 1;
    // Hard failure INVALIDATES the committed height: delete any existing rows for H so stale
    // evidence from an earlier successful run can never persist, then write no new rows.
    await tx.coreSlotLivenessEvidence.deleteMany({ where: { committedBlockHeight: committedHeight } });
    return;
  }

  // Per-height idempotent replace: clear this height's rows, then write the fresh set.
  await tx.coreSlotLivenessEvidence.deleteMany({ where: { committedBlockHeight: committedHeight } });
  if (evaluation.rows.length > 0) {
    await tx.coreSlotLivenessEvidence.createMany({ data: evaluation.rows });
  }
  counters.rowsWritten += evaluation.rows.length;
}

interface HeightEvaluation {
  rows: Record<string, unknown>[];
  failure?: HeightFailure;
}

function evaluateHeight(
  committedHeight: bigint,
  expected: ConsensusWindowSource[],
  rows: OperatorSigningEvidenceSource[],
): HeightEvaluation {
  // Expected active CoreSlots at H (CoreSlots-only), keyed by slotId.
  const expectedBySlot = new Map<string, ConsensusWindowSource>();
  for (const window of expected) {
    const key = window.slotId.toString();
    if (expectedBySlot.has(key)) {
      return fail('duplicate_expected_slot_at_height',
        `Multiple active CoreSlot windows cover committed height ${committedHeight} for slot ${key}.`);
    }
    expectedBySlot.set(key, window);
  }

  const signedBySlot = new Map<string, OperatorSigningEvidenceSource>();
  const nilBySlot = new Map<string, OperatorSigningEvidenceSource>();
  let anonymousAbsentCount = 0;

  for (const row of rows) {
    if (row.attributionStatus === OPERATOR_SIGNING_ATTRIBUTION_STATUS.absentNoValidator
        && row.blockIdFlagCode === FLAG_ABSENT) {
      anonymousAbsentCount += 1;
      continue;
    }

    if (row.attributionStatus !== OPERATOR_SIGNING_ATTRIBUTION_STATUS.attributed) {
      // Out of CoreSlot scope (unmapped_validator / no_consensus_window / invalid / unknown).
      continue;
    }

    // Attributed rows must carry a slot id and an address-bearing flag (commit=2 or nil=3).
    if (row.slotId === null) {
      return fail('malformed_liveness_input',
        `Attributed signing evidence at committed height ${committedHeight} has no slotId (${row.signatureKey}).`);
    }
    const slotKey = row.slotId.toString();

    if (row.blockIdFlagCode === FLAG_COMMIT && row.signed) {
      if (signedBySlot.has(slotKey)) {
        return fail('duplicate_observed_signed_slot_at_height',
          `Multiple attributed commit signatures for slot ${slotKey} at committed height ${committedHeight}.`);
      }
      signedBySlot.set(slotKey, row);
    } else if (row.blockIdFlagCode === FLAG_NIL && !row.signed) {
      nilBySlot.set(slotKey, row);
    } else {
      return fail('unknown_liveness_shape',
        `Attributed evidence for slot ${slotKey} at committed height ${committedHeight} has an unexpected (signed=${row.signed}, flag=${row.blockIdFlagCode}) shape.`);
    }
  }

  // A slot cannot both commit and nil-vote the same height.
  for (const slotKey of signedBySlot.keys()) {
    if (nilBySlot.has(slotKey)) {
      return fail('nil_and_signed_same_slot_height',
        `Slot ${slotKey} has both a commit and a nil vote at committed height ${committedHeight}.`);
    }
  }

  // Every attributed CoreSlot observation must belong to a slot expected at H.
  for (const slotKey of [...signedBySlot.keys(), ...nilBySlot.keys()]) {
    if (!expectedBySlot.has(slotKey)) {
      return fail('observed_attributed_slot_not_expected',
        `Attributed CoreSlot ${slotKey} observed at committed height ${committedHeight} is not in the active expected set.`);
    }
  }

  // Candidate-absent = expected slots that neither committed nor nil-voted. They must be exactly
  // accounted for by the anonymous flag-1 absent entries before being assigned cause=absent.
  let candidateAbsentCount = 0;
  for (const slotKey of expectedBySlot.keys()) {
    if (!signedBySlot.has(slotKey) && !nilBySlot.has(slotKey)) candidateAbsentCount += 1;
  }
  if (candidateAbsentCount !== anonymousAbsentCount) {
    return fail('liveness_absent_count_mismatch',
      `Committed height ${committedHeight}: ${candidateAbsentCount} expected CoreSlots missing but ${anonymousAbsentCount} anonymous absent entries.`);
  }

  // All guards passed -> materialize one row per expected slot.
  const evidenceRows: Record<string, unknown>[] = [];
  for (const [slotKey, window] of expectedBySlot) {
    const signedRow = signedBySlot.get(slotKey);
    const nilRow = nilBySlot.get(slotKey);
    const observed = signedRow ?? nilRow ?? null;

    let statusValue: string;
    let missCause: string | null;
    if (signedRow) {
      statusValue = CORESLOT_LIVENESS_STATUS.signed;
      missCause = null;
    } else if (nilRow) {
      statusValue = CORESLOT_LIVENESS_STATUS.missed;
      missCause = CORESLOT_LIVENESS_MISS_CAUSE.nil;
    } else {
      statusValue = CORESLOT_LIVENESS_STATUS.missed;
      missCause = CORESLOT_LIVENESS_MISS_CAUSE.absent;
    }

    evidenceRows.push({
      evidenceKey: `${CORESLOT_LIVENESS_PROJECTION}:${committedHeight}:${slotKey}`,
      committedBlockHeight: committedHeight,
      // Only SIGNED rows carry an observed source block; misses (nil/absent) keep it null.
      sourceBlockHeight: signedRow ? signedRow.sourceBlockHeight : null,
      slotId: window.slotId,
      operatorAddress: window.operatorAddress,
      consensusAddress: window.consensusAddress,
      consensusPower: window.consensusPower,
      consensusWindowId: window.id,
      status: statusValue,
      missCause,
      observedSignatureKey: observed ? observed.signatureKey : null,
      observedBlockIdFlag: observed ? observed.blockIdFlag : null,
      observedBlockIdFlagCode: observed ? observed.blockIdFlagCode : null,
      observedSigned: observed ? observed.signed : null,
      observedAttributionStatus: observed ? observed.attributionStatus : null,
    });
  }

  return { rows: evidenceRows };
}

function fail(
  failureKind: ProjectionFailureInput['failureKind'],
  error: string,
): HeightEvaluation {
  return { rows: [], failure: { failureKind, error } };
}

function groupByCommittedHeight(
  rows: OperatorSigningEvidenceSource[],
): Map<bigint, OperatorSigningEvidenceSource[]> {
  const grouped = new Map<bigint, OperatorSigningEvidenceSource[]>();
  for (const row of rows) {
    const existing = grouped.get(row.committedBlockHeight);
    if (existing) existing.push(row);
    else grouped.set(row.committedBlockHeight, [row]);
  }
  return grouped;
}

async function createFailure(
  prisma: Pick<CoreSlotLivenessProjectionPrisma, 'projectionFailure'>,
  input: Omit<ProjectionFailureInput, 'projectionName' | 'module'>,
): Promise<void> {
  const data = withProjectionFailureKey({
    projectionName: CORESLOT_LIVENESS_PROJECTION,
    module: 'cometbft',
    ...input,
  });
  await prisma.projectionFailure.upsert({
    where: { failureKey: data.failureKey },
    create: data,
    update: { ...data, resolved: false, resolvedAt: null },
  });
}
