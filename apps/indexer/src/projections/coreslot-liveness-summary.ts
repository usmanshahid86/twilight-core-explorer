import {
  haltProjectionCursorError,
  updateProjectionCursorSuccess,
  type ProjectionCursorPrisma,
} from './cursor.js';
import {
  CORESLOT_LIVENESS_MISS_CAUSE,
  CORESLOT_LIVENESS_PROJECTION,
  CORESLOT_LIVENESS_RECENT_WINDOWS,
  CORESLOT_LIVENESS_STATUS,
  CORESLOT_LIVENESS_SUMMARY_PROJECTION,
  CORESLOT_LIVENESS_SUMMARY_STATUS,
  CORESLOT_LIVENESS_WINDOW_KIND,
  type ProjectionFailureInput,
  withProjectionFailureKey,
} from './types.js';

export interface ProjectCoreSlotLivenessSummaryArgs {
  prisma: CoreSlotLivenessSummaryProjectionPrisma;
  chainId: string;
  endHeight?: bigint | undefined;
}

export interface ProjectCoreSlotLivenessSummaryResult {
  slotsSummarized: number;
  rowsWritten: number;
  failuresCreated: number;
  maxCommittedHeight: bigint;
}

export interface CoreSlotLivenessSummaryProjectionPrisma extends ProjectionCursorPrisma {
  coreSlotLivenessEvidence: {
    findMany(args: unknown): Promise<EvidenceSource[]>;
  };
  coreSlotLivenessSummary: {
    deleteMany(args?: unknown): Promise<unknown>;
    createMany(args: unknown): Promise<unknown>;
  };
  projectionFailure: {
    findMany(args: unknown): Promise<FailureHeightSource[]>;
    upsert(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
  };
  $transaction<T>(
    fn: (tx: CoreSlotLivenessSummaryProjectionPrisma) => Promise<T>,
    options?: { timeout?: number; maxWait?: number },
  ): Promise<T>;
}

interface EvidenceSource {
  committedBlockHeight: bigint;
  slotId: bigint;
  status: string;
  missCause: string | null;
  operatorAddress: string | null;
  consensusAddress: string | null;
  consensusWindowId: bigint | null;
}

interface FailureHeightSource {
  committedHeight: bigint | null;
}

interface WindowSpec {
  windowKind: string;
  windowSize: number | null;
}

const WINDOW_SPECS: WindowSpec[] = [
  { windowKind: CORESLOT_LIVENESS_WINDOW_KIND.lifetime, windowSize: null },
  ...CORESLOT_LIVENESS_RECENT_WINDOWS.map((w) => ({ windowKind: w.kind, windowSize: w.size })),
];

export async function projectCoreSlotLivenessSummary(
  args: ProjectCoreSlotLivenessSummaryArgs,
): Promise<ProjectCoreSlotLivenessSummaryResult> {
  const { prisma, chainId, endHeight } = args;
  const heightFilter = endHeight === undefined
    ? {}
    : { committedBlockHeight: { lte: endHeight } };

  try {
    return await prisma.$transaction(async (tx) => {
      // Clear this projection's prior unresolved failures; re-created below if still bad.
      await tx.projectionFailure.deleteMany({
        where: { projectionName: CORESLOT_LIVENESS_SUMMARY_PROJECTION, resolved: false },
      });

      const evidence = await tx.coreSlotLivenessEvidence.findMany({
        where: heightFilter,
        orderBy: [{ slotId: 'asc' }, { committedBlockHeight: 'asc' }],
      });

      // Exact invalid committed heights from the upstream liveness projection (8c-1 stamps these).
      const failures = await tx.projectionFailure.findMany({
        where: {
          projectionName: CORESLOT_LIVENESS_PROJECTION,
          resolved: false,
          committedHeight: { not: null },
          ...(endHeight === undefined ? {} : { committedHeight: { lte: endHeight, not: null } }),
        },
        select: { committedHeight: true },
      });
      const invalidHeights = dedupeSortedHeights(failures);

      const bySlot = groupBySlot(evidence);
      const summaryRows: Record<string, unknown>[] = [];
      const counters = { rowsWritten: 0, failuresCreated: 0 };
      let maxCommittedHeight = 0n;

      for (const [slotId, rows] of bySlot) {
        const last = rows[rows.length - 1];
        if (!last) continue; // groupBySlot never yields empty arrays; satisfies the type checker
        if (last.committedBlockHeight > maxCommittedHeight) maxCommittedHeight = last.committedBlockHeight;

        const violation = findInvariantViolation(rows);
        if (violation) {
          await createFailure(tx, {
            sourceHeight: last.committedBlockHeight,
            committedHeight: violation.committedHeight,
            failureKind: 'liveness_summary_invariant_violation',
            error: violation.error,
          });
          counters.failuresCreated += 1;
          continue; // do not emit summaries for a slot with corrupt evidence
        }

        for (const spec of WINDOW_SPECS) {
          const windowRows = spec.windowSize === null
            ? rows
            : rows.slice(Math.max(0, rows.length - spec.windowSize));
          summaryRows.push(buildSummary(slotId, spec, windowRows, invalidHeights));
        }
      }

      await tx.coreSlotLivenessSummary.deleteMany();
      if (summaryRows.length > 0) {
        await tx.coreSlotLivenessSummary.createMany({ data: summaryRows });
      }
      counters.rowsWritten = summaryRows.length;

      const cursorHeight = endHeight ?? maxCommittedHeight;
      await updateProjectionCursorSuccess(
        tx,
        CORESLOT_LIVENESS_SUMMARY_PROJECTION,
        chainId,
        cursorHeight,
      );

      return {
        slotsSummarized: bySlot.size,
        rowsWritten: counters.rowsWritten,
        failuresCreated: counters.failuresCreated,
        maxCommittedHeight,
      };
    // Whole-state recompute in ONE interactive tx (all slots' summaries) — exceeds Prisma's DEFAULT
    // 5s timeout at a large chain's data volume (seen on devnet). Raise it (same fix as rewards-snapshot).
    }, { timeout: 120_000, maxWait: 15_000 });
  } catch (error) {
    await haltProjectionCursorError(
      prisma,
      CORESLOT_LIVENESS_SUMMARY_PROJECTION,
      chainId,
      endHeight ?? 0n,
      error,
    );
    throw error;
  }
}

function buildSummary(
  slotId: bigint,
  spec: WindowSpec,
  rows: EvidenceSource[],
  invalidHeights: bigint[],
): Record<string, unknown> {
  const evidenceHeightCount = rows.length;
  let signedCount = 0;
  let absentMissedCount = 0;
  let nilMissedCount = 0;
  for (const row of rows) {
    if (row.status === CORESLOT_LIVENESS_STATUS.signed) signedCount += 1;
    else if (row.missCause === CORESLOT_LIVENESS_MISS_CAUSE.absent) absentMissedCount += 1;
    else if (row.missCause === CORESLOT_LIVENESS_MISS_CAUSE.nil) nilMissedCount += 1;
  }
  const missedCount = absentMissedCount + nilMissedCount;
  const expectedCount = evidenceHeightCount;

  const firstRow = rows[0] ?? null;
  const latest = rows[rows.length - 1] ?? null;
  const first = firstRow ? firstRow.committedBlockHeight : null;
  const last = latest ? latest.committedBlockHeight : null;
  const spanHeightCount = first !== null && last !== null ? last - first + 1n : null;

  const uptimeBps = expectedCount > 0
    ? Number((BigInt(signedCount) * 10000n) / BigInt(expectedCount))
    : null;

  // Trailing run of the latest status (over present evidence rows).
  let currentSignedStreak = 0;
  let currentMissedStreak = 0;
  if (latest) {
    const lastStatus = latest.status;
    let streak = 0;
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i];
      if (!row || row.status !== lastStatus) break;
      streak += 1;
    }
    if (lastStatus === CORESLOT_LIVENESS_STATUS.signed) currentSignedStreak = streak;
    else currentMissedStreak = streak;
  }

  let latestMissedHeight: bigint | null = null;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row && row.status === CORESLOT_LIVENESS_STATUS.missed) {
      latestMissedHeight = row.committedBlockHeight;
      break;
    }
  }

  // Coverage flag: exact invalid committed heights inside the numeric span (NOT the row set).
  const invalidHeightCount = first !== null && last !== null
    ? invalidHeights.filter((h) => h >= first && h <= last).length
    : 0;
  const summaryStatus = invalidHeightCount > 0
    ? CORESLOT_LIVENESS_SUMMARY_STATUS.incomplete
    : CORESLOT_LIVENESS_SUMMARY_STATUS.complete;

  return {
    summaryKey: `${CORESLOT_LIVENESS_SUMMARY_PROJECTION}:${slotId}:${spec.windowKind}`,
    slotId,
    windowKind: spec.windowKind,
    windowSize: spec.windowSize,
    operatorAddress: latest ? latest.operatorAddress : null,
    consensusAddress: latest ? latest.consensusAddress : null,
    consensusWindowId: latest ? latest.consensusWindowId : null,
    firstCommittedHeight: first,
    lastCommittedHeight: last,
    spanHeightCount,
    evidenceHeightCount,
    expectedCount,
    signedCount,
    missedCount,
    absentMissedCount,
    nilMissedCount,
    uptimeBps,
    currentSignedStreak,
    currentMissedStreak,
    latestMissedHeight,
    invalidHeightCount,
    summaryStatus,
  };
}

function findInvariantViolation(
  rows: EvidenceSource[],
): { committedHeight: bigint; error: string } | null {
  for (const row of rows) {
    if (row.status === CORESLOT_LIVENESS_STATUS.signed) continue;
    if (row.status === CORESLOT_LIVENESS_STATUS.missed
        && (row.missCause === CORESLOT_LIVENESS_MISS_CAUSE.absent
          || row.missCause === CORESLOT_LIVENESS_MISS_CAUSE.nil)) {
      continue;
    }
    return {
      committedHeight: row.committedBlockHeight,
      error: `CoreSlotLivenessEvidence row at committed height ${row.committedBlockHeight} for slot `
        + `${row.slotId} has an unexpected (status=${row.status}, missCause=${row.missCause}) shape.`,
    };
  }
  return null;
}

function groupBySlot(rows: EvidenceSource[]): Map<bigint, EvidenceSource[]> {
  const grouped = new Map<bigint, EvidenceSource[]>();
  for (const row of rows) {
    const existing = grouped.get(row.slotId);
    if (existing) existing.push(row);
    else grouped.set(row.slotId, [row]);
  }
  return grouped;
}

function dedupeSortedHeights(failures: FailureHeightSource[]): bigint[] {
  const set = new Set<bigint>();
  for (const f of failures) {
    if (f.committedHeight !== null) set.add(f.committedHeight);
  }
  return [...set];
}

async function createFailure(
  prisma: Pick<CoreSlotLivenessSummaryProjectionPrisma, 'projectionFailure'>,
  input: Omit<ProjectionFailureInput, 'projectionName' | 'module'>,
): Promise<void> {
  const data = withProjectionFailureKey({
    projectionName: CORESLOT_LIVENESS_SUMMARY_PROJECTION,
    module: 'cometbft',
    ...input,
  });
  await prisma.projectionFailure.upsert({
    where: { failureKey: data.failureKey },
    create: data,
    update: { ...data, resolved: false, resolvedAt: null },
  });
}
