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
  CORESLOT_HEALTH_POLICY,
  CORESLOT_HEALTH_PROJECTION,
  CORESLOT_HEALTH_REASON,
  CORESLOT_HEALTH_STATUS,
  CORESLOT_LIVENESS_SUMMARY_STATUS,
  CORESLOT_LIVENESS_WINDOW_KIND,
  NETWORK_HALT_RISK_LEVEL,
  NETWORK_HALT_RISK_REASON,
  type ProjectionFailureInput,
  withProjectionFailureKey,
} from './types.js';

const NETWORK_RISK_KEY = 'network_liveness_risk_v1:latest';

export interface ProjectCoreSlotHealthArgs {
  prisma: CoreSlotHealthProjectionPrisma;
  chainId: string;
}

export interface ProjectCoreSlotHealthResult {
  activeSlotCount: number;
  healthRowsWritten: number;
  haltRiskLevel: string;
  failuresCreated: number;
}

export interface CoreSlotHealthProjectionPrisma extends ProjectionCursorPrisma {
  coreSlotLivenessSummary: {
    findMany(args: unknown): Promise<SummarySource[]>;
  };
  coreSlotConsensusWindow: {
    findMany(args: unknown): Promise<ConsensusWindowSource[]>;
  };
  coreSlotHealthSnapshot: {
    deleteMany(args?: unknown): Promise<unknown>;
    createMany(args: unknown): Promise<unknown>;
  };
  networkLivenessRiskSnapshot: {
    deleteMany(args?: unknown): Promise<unknown>;
    create(args: unknown): Promise<unknown>;
  };
  projectionFailure: {
    upsert(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
  };
  $transaction<T>(
    fn: (tx: CoreSlotHealthProjectionPrisma) => Promise<T>,
    options?: { timeout?: number; maxWait?: number },
  ): Promise<T>;
}

interface SummarySource {
  id: bigint;
  slotId: bigint;
  windowKind: string;
  lastCommittedHeight: bigint | null;
  firstCommittedHeight: bigint | null;
  operatorAddress: string | null;
  consensusAddress: string | null;
  consensusWindowId: bigint | null;
  expectedCount: number;
  signedCount: number;
  missedCount: number;
  absentMissedCount: number;
  nilMissedCount: number;
  uptimeBps: number | null;
  currentSignedStreak: number;
  currentMissedStreak: number;
  latestMissedHeight: bigint | null;
  summaryStatus: string;
  invalidHeightCount: number;
}

interface HealthVerdict {
  status: string;
  reason: string;
}

export async function projectCoreSlotHealth(
  args: ProjectCoreSlotHealthArgs,
): Promise<ProjectCoreSlotHealthResult> {
  const { prisma, chainId } = args;

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.projectionFailure.deleteMany({
        where: { projectionName: CORESLOT_HEALTH_PROJECTION, resolved: false },
      });

      const summaries = await tx.coreSlotLivenessSummary.findMany({});
      const bySlot = groupSummaries(summaries);
      const networkLatestHeight = computeNetworkLatestHeight(summaries);

      const activeBySlot = new Map<string, ConsensusWindowSource>();
      if (networkLatestHeight !== null) {
        const windows = await findActiveCoreSlotWindowsAtHeight(tx, networkLatestHeight);
        for (const window of windows) activeBySlot.set(window.slotId.toString(), window);
      }

      const healthRows: Record<string, unknown>[] = [];
      const counts = {
        healthy: 0, degraded: 0, down: 0, incomplete: 0, unknown: 0,
      };
      let failuresCreated = 0;

      for (const [slotKey, window] of activeBySlot) {
        const recent100 = bySlot.get(slotKey)?.get(CORESLOT_LIVENESS_WINDOW_KIND.recent100) ?? null;

        if (recent100 && invariantViolation(recent100)) {
          await createFailure(tx, {
            sourceHeight: networkLatestHeight ?? 0n,
            committedHeight: recent100.lastCommittedHeight,
            failureKind: 'coreslot_health_invariant_violation',
            error: `recent_100 summary for slot ${slotKey} has inconsistent counts `
              + `(signed+missed != expected or absent+nil != missed).`,
          });
          failuresCreated += 1;
          // Corrupt input is COVERAGE-UNKNOWN, not "absent": emit an incomplete health row (numerics
          // zeroed, no corrupt numbers surfaced) so the slot still counts toward network risk. Dropping
          // it would leave activeSlotCount > emitted rows and silently UNDERSTATE network halt-risk.
          const verdict: HealthVerdict = {
            status: CORESLOT_HEALTH_STATUS.incomplete,
            reason: CORESLOT_HEALTH_REASON.corruptSummary,
          };
          countStatus(counts, verdict.status);
          healthRows.push(buildHealthRow(slotKey, window, null, bySlot.get(slotKey), verdict));
          continue;
        }

        const verdict = classifyHealth(recent100);
        countStatus(counts, verdict.status);
        healthRows.push(buildHealthRow(slotKey, window, recent100, bySlot.get(slotKey), verdict));
      }

      await tx.coreSlotHealthSnapshot.deleteMany();
      if (healthRows.length > 0) {
        await tx.coreSlotHealthSnapshot.createMany({ data: healthRows });
      }

      const network = buildNetworkRisk(activeBySlot.size, counts, networkLatestHeight);
      await tx.networkLivenessRiskSnapshot.deleteMany();
      await tx.networkLivenessRiskSnapshot.create({ data: network });

      await updateProjectionCursorSuccess(
        tx,
        CORESLOT_HEALTH_PROJECTION,
        chainId,
        networkLatestHeight ?? 0n,
      );

      return {
        activeSlotCount: activeBySlot.size,
        healthRowsWritten: healthRows.length,
        haltRiskLevel: network.haltRiskLevel as string,
        failuresCreated,
      };
    // Whole-state recompute in ONE interactive tx (all active slots) — at a large chain's data volume
    // this exceeds Prisma's DEFAULT 5s timeout (seen on devnet). Raise it (same fix as rewards-snapshot).
    }, { timeout: 120_000, maxWait: 15_000 });
  } catch (error) {
    await haltProjectionCursorError(prisma, CORESLOT_HEALTH_PROJECTION, chainId, 0n, error);
    throw error;
  }
}

function classifyHealth(recent100: SummarySource | null): HealthVerdict {
  if (!recent100 || recent100.expectedCount === 0) {
    return { status: CORESLOT_HEALTH_STATUS.unknown, reason: CORESLOT_HEALTH_REASON.missingSummary };
  }
  if (recent100.summaryStatus === CORESLOT_LIVENESS_SUMMARY_STATUS.incomplete
      || recent100.invalidHeightCount > 0) {
    return {
      status: CORESLOT_HEALTH_STATUS.incomplete,
      reason: CORESLOT_HEALTH_REASON.incompleteSummary,
    };
  }
  if (recent100.currentMissedStreak >= CORESLOT_HEALTH_POLICY.downMissedStreak) {
    return { status: CORESLOT_HEALTH_STATUS.down, reason: CORESLOT_HEALTH_REASON.sustainedMissStreak };
  }
  if (recent100.currentMissedStreak > 0) {
    return {
      status: CORESLOT_HEALTH_STATUS.degraded,
      reason: CORESLOT_HEALTH_REASON.currentMissStreak,
    };
  }
  const uptime = recent100.uptimeBps ?? 0;
  if (uptime < CORESLOT_HEALTH_POLICY.degradedUptimeBps || recent100.missedCount > 0) {
    return { status: CORESLOT_HEALTH_STATUS.degraded, reason: CORESLOT_HEALTH_REASON.recentMisses };
  }
  return {
    status: CORESLOT_HEALTH_STATUS.healthy,
    reason: CORESLOT_HEALTH_REASON.completeNoRecentMisses,
  };
}

function buildHealthRow(
  slotKey: string,
  window: ConsensusWindowSource,
  recent100: SummarySource | null,
  windows: Map<string, SummarySource> | undefined,
  verdict: HealthVerdict,
): Record<string, unknown> {
  const lifetime = windows?.get(CORESLOT_LIVENESS_WINDOW_KIND.lifetime) ?? null;
  const recent500 = windows?.get(CORESLOT_LIVENESS_WINDOW_KIND.recent500) ?? null;
  const recent1000 = windows?.get(CORESLOT_LIVENESS_WINDOW_KIND.recent1000) ?? null;

  return {
    healthKey: `${CORESLOT_HEALTH_PROJECTION}:${slotKey}`,
    slotId: window.slotId,
    // identity from the authoritative active window
    operatorAddress: window.operatorAddress,
    consensusAddress: window.consensusAddress,
    consensusWindowId: window.id,
    primaryWindowKind: CORESLOT_HEALTH_POLICY.primaryWindowKind,
    primarySummaryId: recent100 ? recent100.id : null,
    lifetimeSummaryId: lifetime ? lifetime.id : null,
    recent500SummaryId: recent500 ? recent500.id : null,
    recent1000SummaryId: recent1000 ? recent1000.id : null,
    expectedCount: recent100 ? recent100.expectedCount : 0,
    signedCount: recent100 ? recent100.signedCount : 0,
    missedCount: recent100 ? recent100.missedCount : 0,
    absentMissedCount: recent100 ? recent100.absentMissedCount : 0,
    nilMissedCount: recent100 ? recent100.nilMissedCount : 0,
    uptimeBps: recent100 ? recent100.uptimeBps : null,
    currentSignedStreak: recent100 ? recent100.currentSignedStreak : 0,
    currentMissedStreak: recent100 ? recent100.currentMissedStreak : 0,
    latestMissedHeight: recent100 ? recent100.latestMissedHeight : null,
    summaryStatus: recent100 ? recent100.summaryStatus : null,
    invalidHeightCount: recent100 ? recent100.invalidHeightCount : 0,
    firstCommittedHeight: recent100 ? recent100.firstCommittedHeight : null,
    lastCommittedHeight: recent100 ? recent100.lastCommittedHeight : null,
    lifetimeUptimeBps: lifetime ? lifetime.uptimeBps : null,
    recent500UptimeBps: recent500 ? recent500.uptimeBps : null,
    recent1000UptimeBps: recent1000 ? recent1000.uptimeBps : null,
    isActiveAtLatest: true, // v1 emits only active slots
    healthStatus: verdict.status,
    healthReason: verdict.reason,
    policyVersion: CORESLOT_HEALTH_POLICY.version,
  };
}

function buildNetworkRisk(
  activeSlotCount: number,
  counts: { healthy: number; degraded: number; down: number; incomplete: number; unknown: number },
  latestCommittedHeight: bigint | null,
): Record<string, unknown> {
  const availableSlotCount = counts.healthy + counts.degraded;
  const unavailableSlotCount = counts.down;
  const coverageUnknownCount = counts.incomplete + counts.unknown;

  const availablePowerBps = activeSlotCount > 0
    ? Math.floor((availableSlotCount * 10000) / activeSlotCount)
    : null;
  const unavailablePowerBps = activeSlotCount > 0
    ? Math.floor((unavailableSlotCount * 10000) / activeSlotCount)
    : null;

  let haltRiskLevel: string;
  let haltRiskReason: string;
  if (activeSlotCount === 0) {
    haltRiskLevel = NETWORK_HALT_RISK_LEVEL.unknown;
    haltRiskReason = NETWORK_HALT_RISK_REASON.noSlots;
  } else if (coverageUnknownCount > 0) {
    haltRiskLevel = NETWORK_HALT_RISK_LEVEL.unknown;
    haltRiskReason = NETWORK_HALT_RISK_REASON.coverageUnknown;
  } else if ((availablePowerBps ?? 0) <= CORESLOT_HEALTH_POLICY.criticalAvailablePowerBps) {
    haltRiskLevel = NETWORK_HALT_RISK_LEVEL.critical;
    haltRiskReason = NETWORK_HALT_RISK_REASON.insufficientAvailablePower;
  } else if (
    unavailableSlotCount > 0
    || counts.degraded > 0
    || (unavailablePowerBps ?? 0) >= CORESLOT_HEALTH_POLICY.warningUnavailablePowerBps
  ) {
    haltRiskLevel = NETWORK_HALT_RISK_LEVEL.warning;
    haltRiskReason = NETWORK_HALT_RISK_REASON.degradedOrDownPresent;
  } else {
    haltRiskLevel = NETWORK_HALT_RISK_LEVEL.normal;
    haltRiskReason = NETWORK_HALT_RISK_REASON.allHealthy;
  }

  return {
    riskKey: NETWORK_RISK_KEY,
    policyVersion: CORESLOT_HEALTH_POLICY.version,
    latestCommittedHeight,
    activeSlotCount,
    healthySlotCount: counts.healthy,
    degradedSlotCount: counts.degraded,
    downSlotCount: counts.down,
    incompleteSlotCount: counts.incomplete,
    unknownSlotCount: counts.unknown,
    availableSlotCount,
    unavailableSlotCount,
    availablePowerBps,
    unavailablePowerBps,
    haltRiskLevel,
    haltRiskReason,
  };
}

function invariantViolation(s: SummarySource): boolean {
  return s.signedCount + s.missedCount !== s.expectedCount
    || s.absentMissedCount + s.nilMissedCount !== s.missedCount;
}

function countStatus(
  counts: { healthy: number; degraded: number; down: number; incomplete: number; unknown: number },
  status: string,
): void {
  if (status === CORESLOT_HEALTH_STATUS.healthy) counts.healthy += 1;
  else if (status === CORESLOT_HEALTH_STATUS.degraded) counts.degraded += 1;
  else if (status === CORESLOT_HEALTH_STATUS.down) counts.down += 1;
  else if (status === CORESLOT_HEALTH_STATUS.incomplete) counts.incomplete += 1;
  else counts.unknown += 1;
}

function groupSummaries(rows: SummarySource[]): Map<string, Map<string, SummarySource>> {
  const grouped = new Map<string, Map<string, SummarySource>>();
  for (const row of rows) {
    const slotKey = row.slotId.toString();
    let windows = grouped.get(slotKey);
    if (!windows) {
      windows = new Map<string, SummarySource>();
      grouped.set(slotKey, windows);
    }
    windows.set(row.windowKind, row);
  }
  return grouped;
}

function computeNetworkLatestHeight(rows: SummarySource[]): bigint | null {
  let recentMax: bigint | null = null;
  let anyMax: bigint | null = null;
  for (const row of rows) {
    if (row.lastCommittedHeight === null) continue;
    if (anyMax === null || row.lastCommittedHeight > anyMax) anyMax = row.lastCommittedHeight;
    if (row.windowKind === CORESLOT_LIVENESS_WINDOW_KIND.recent100
        && (recentMax === null || row.lastCommittedHeight > recentMax)) {
      recentMax = row.lastCommittedHeight;
    }
  }
  return recentMax ?? anyMax;
}

async function createFailure(
  prisma: Pick<CoreSlotHealthProjectionPrisma, 'projectionFailure'>,
  input: Omit<ProjectionFailureInput, 'projectionName' | 'module'>,
): Promise<void> {
  const data = withProjectionFailureKey({
    projectionName: CORESLOT_HEALTH_PROJECTION,
    module: 'cometbft',
    ...input,
  });
  await prisma.projectionFailure.upsert({
    where: { failureKey: data.failureKey },
    create: data,
    update: { ...data, resolved: false, resolvedAt: null },
  });
}
