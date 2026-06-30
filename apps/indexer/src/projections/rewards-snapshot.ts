import {
  haltProjectionCursorError,
  updateProjectionCursorSuccess,
  type ProjectionCursorPrisma,
} from './cursor.js';
import {
  REWARDS_NATIVE_DENOM,
  REWARDS_SEMANTIC_PROJECTION,
  REWARDS_SNAPSHOT_PROJECTION,
  withProjectionFailureKey,
  type ProjectionFailureInput,
} from './types.js';

/**
 * Observed-sample ingestion for rewards (projection rewards_snapshot_v1).
 *
 * Unlike the rebuildable rewards_semantic_v1 projection, these rows are NOT derived from
 * indexed generic rows: they are point-in-time snapshots read from the live chain via
 * ChainClient and are tied to the height at which they were sampled (`sampledAtHeight`). They
 * are observed samples, not rebuildable semantic truth, and must be treated as such by
 * downstream consumers.
 */
export interface RewardsSnapshotChainClient {
  getSlotRewards(
    slotId: bigint,
    pagination?: { key?: string | undefined },
    height?: bigint,
  ): Promise<{ raw: unknown }>;
  getModuleBalances(height?: bigint): Promise<{ raw: unknown }>;
  getCumulativeEmitted(height?: bigint): Promise<{ raw: unknown }>;
}

export interface RewardsSnapshotPrisma extends ProjectionCursorPrisma {
  coreSlotProjection: { findMany(args: unknown): Promise<{ slotId: bigint }[]> };
  slotRewardProjection: {
    findUnique(args: unknown): Promise<SlotRewardRow | null>;
    upsert(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  // Read-only here — used by the post-snapshot reconcile to look up a claim by its source event.
  rewardClaimEvent: { findUnique(args: unknown): Promise<RewardClaimRow | null> };
  rewardsBalanceSample: { upsert(args: unknown): Promise<unknown> };
  projectionFailure: {
    upsert(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<MissingRecordsFailureRow[]>;
    update(args: unknown): Promise<unknown>;
  };
  $transaction<T>(
    fn: (tx: RewardsSnapshotPrisma) => Promise<T>,
    options?: { timeout?: number; maxWait?: number },
  ): Promise<T>;
}

// The snapshot writes one observed row per (slot × epoch-reward) plus module-balance samples and the
// claim reconcile, all in ONE transaction to keep the height-pinned sample atomic. On a large chain
// that is thousands of upserts, which blows Prisma's DEFAULT 5s interactive-transaction timeout (seen
// live on devnet: ~1,884 epochs × slots). Raise the per-transaction timeout (the proper "do less work"
// fix — batched upserts — is a tracked Phase-14 optimization). maxWait covers connection-pool contention
// with the concurrently-running ingest/projector loops.
const REWARDS_SNAPSHOT_TX_TIMEOUT_MS = 120_000;
const REWARDS_SNAPSHOT_TX_MAX_WAIT_MS = 15_000;

interface SlotRewardRow {
  id: bigint;
  claimed: boolean;
}

interface RewardClaimRow {
  slotId: bigint;
  startEpoch: bigint | null;
  endEpoch: bigint | null;
  height: bigint;
  txHash: string;
  msgIndex: number | null;
  sourceEventId: bigint | null;
  rawEventJson: unknown; // the reward_claimed event's raw json — stamped onto rawClaimJson for rebuild parity
}

interface MissingRecordsFailureRow {
  id: bigint;
  sourceEventId: bigint | null;
}

export interface IngestRewardsSnapshotArgs {
  prisma: RewardsSnapshotPrisma;
  client: RewardsSnapshotChainClient;
  chainId: string;
  height: bigint;
  slotIds?: bigint[] | undefined;
}

export interface IngestRewardsSnapshotResult {
  height: bigint;
  slotRewardRows: number;
  balanceSamples: number;
  // true when a chain read failed: the cursor was halted and no success was recorded.
  failed: boolean;
}

export async function ingestRewardsSnapshot(
  args: IngestRewardsSnapshotArgs,
): Promise<IngestRewardsSnapshotResult> {
  const { prisma, client, chainId, height } = args;

  const slotIds = args.slotIds
    ?? (await prisma.coreSlotProjection.findMany({ select: { slotId: true } })).map((r) => r.slotId);

  // Clear this height's prior unresolved failures so a re-run re-derives them cleanly (idempotent,
  // mirroring the per-height projectors) — e.g. a module_balance_sample_unavailable left by an
  // earlier run must not linger once the sample succeeds.
  await prisma.projectionFailure.deleteMany({
    where: { projectionName: REWARDS_SNAPSHOT_PROJECTION, sourceHeight: height, resolved: false },
  });

  // --- 1. READ all chain state first; write nothing yet. ------------------------------------
  // True read-before-write (like balance-snapshot): if ANY read fails we halt + record and leave
  // the DB untouched for this height — no partial sample is ever visible. Reads are pure.
  let slotRewards: Array<{ slotId: bigint; reward: SlotRewardSnapshot; raw: unknown }>;
  let moduleBalanceEntries: BalanceEntry[];
  let moduleBalancesRaw: unknown;
  let cumulativeAmount: { denom: string; amount: string } | null;
  let cumulativeRaw: unknown;
  try {
    slotRewards = [];
    for (const slotId of slotIds) {
      // Paginate until the chain's pagination.next_key is exhausted so a slot with many
      // epochs of rewards is not silently truncated to the first page.
      let key: string | undefined;
      let guard = 0;
      do {
        const snapshot = await client.getSlotRewards(slotId, key ? { key } : undefined, height);
        for (const reward of extractSlotRewards(snapshot.raw)) {
          slotRewards.push({ slotId, reward, raw: snapshot.raw });
        }
        key = extractNextKey(snapshot.raw);
        guard += 1;
      } while (key && guard < 10_000);
    }

    const moduleBalances = await client.getModuleBalances(height);
    moduleBalancesRaw = moduleBalances.raw;
    moduleBalanceEntries = extractBalances(moduleBalances.raw);

    const cumulative = await client.getCumulativeEmitted(height);
    cumulativeRaw = cumulative.raw;
    cumulativeAmount = extractAmount(cumulative.raw);
  } catch (error) {
    // A chain read failed: halt the cursor and record the failure. Nothing was written for this
    // height, so there is no partial sample to reconcile; a re-run after the chain recovers
    // re-samples cleanly.
    await haltProjectionCursorError(prisma, REWARDS_SNAPSHOT_PROJECTION, chainId, height, error);
    await createFailure(prisma, {
      sourceHeight: height,
      failureKind: 'rewards_snapshot_chain_read_failed',
      error: formatError(error),
    });
    return { height, slotRewardRows: 0, balanceSamples: 0, failed: true };
  }

  // --- 2. WRITE everything in one transaction (every read succeeded). ------------------------
  let slotRewardRows = 0;
  let balanceSamples = 0;
  await prisma.$transaction(async (tx) => {
    for (const { slotId, reward, raw } of slotRewards) {
      await upsertSlotReward(tx, { slotId, height, reward, raw });
      slotRewardRows += 1;
    }
    for (const balance of moduleBalanceEntries) {
      await upsertBalanceSample(tx, {
        height,
        sampleKind: 'module_balance',
        address: balance.address,
        moduleName: balance.moduleName,
        denom: balance.denom,
        amount: balance.amount,
        raw: balance.raw,
      });
      balanceSamples += 1;
    }
    // A successful read that yields NO module_balance rows is either a genuinely-empty module set
    // or (more dangerously) a response shape extractBalances does not recognize. Either way, record
    // a NON-BLOCKING ProjectionFailure with the raw payload so the absence is justified and visible
    // rather than a silent gap — the cursor still advances (the rest of the snapshot succeeded).
    if (moduleBalanceEntries.length === 0) {
      await createFailure(tx, {
        sourceHeight: height,
        failureKind: 'module_balance_sample_unavailable',
        rawEventJson: moduleBalancesRaw,
        error: 'getModuleBalances returned no extractable module_balance entries.',
      });
    }
    if (cumulativeAmount) {
      await upsertBalanceSample(tx, {
        height,
        sampleKind: 'cumulative_emitted',
        address: null,
        moduleName: null,
        denom: cumulativeAmount.denom,
        amount: cumulativeAmount.amount,
        raw: cumulativeRaw,
      });
      balanceSamples += 1;
    }

    // --- 3. Reconcile pending rewards-semantic claim failures (forward-incremental safety) -------
    // Forward-incremental indexing projects `reward_claimed` (rewards_semantic) BEFORE this snapshot
    // lands the observed SlotRewardProjection rows, so applyClaim records a `missing_reward_records`
    // failure with no rows to reconcile. Now that the rows exist, stamp the claimed range + resolve the
    // failure here — the snapshot is the event that makes the claim reconcilable. (A periodic full
    // rebuild self-heals via rewards-semantic's per-height deleteMany; a forward-only deploy needs this.)
    await reconcilePendingClaims(tx);
  }, { timeout: REWARDS_SNAPSHOT_TX_TIMEOUT_MS, maxWait: REWARDS_SNAPSHOT_TX_MAX_WAIT_MS });

  await updateProjectionCursorSuccess(prisma, REWARDS_SNAPSHOT_PROJECTION, chainId, height);
  return { height, slotRewardRows, balanceSamples, failed: false };
}

// Resolve any rewards-semantic `missing_reward_records` failure whose claim is now covered by observed
// SlotRewardProjection rows; returns the count resolved. Cross-projection by design: the snapshot is what
// makes the claim reconcilable, so it owns clearing the false alarm. Never resolves while rows are still
// absent (correctness-over-guessing holds — the claim stays an open failure until the data exists).
// Exported + deliberately chain-read-free so the `project:rewards-reconcile` CLI can run it standalone
// (break-glass: clear lingering failures from already-present rows when REST is down / without a new sample).
export async function reconcilePendingClaims(tx: RewardsSnapshotPrisma): Promise<number> {
  const failures = await tx.projectionFailure.findMany({
    where: {
      projectionName: REWARDS_SEMANTIC_PROJECTION,
      failureKind: 'missing_reward_records',
      resolved: false,
    },
  });
  if (failures.length === 0) return 0;
  const resolvedAt = new Date(); // one timestamp for the whole reconcile pass
  let resolved = 0;
  for (const failure of failures) {
    if (failure.sourceEventId === null) continue;
    const claim = await tx.rewardClaimEvent.findUnique({ where: { sourceEventId: failure.sourceEventId } });
    if (!claim || claim.startEpoch === null || claim.endEpoch === null) continue;
    // Stamp every observed row of the claim range in ONE updateMany (identical provenance per row, mirroring
    // applyClaim: '' tx hash → null, rawClaimJson from the claim's raw event). The returned count tells us
    // whether any rows exist yet — keeping the snapshot transaction + advisory-lock hold short even for a
    // large backlog or a wide claim range (vs an await-per-row loop).
    const { count } = await tx.slotRewardProjection.updateMany({
      where: { slotId: claim.slotId, epochNumber: { gte: claim.startEpoch, lte: claim.endEpoch } },
      data: {
        claimed: true,
        claimedAtHeight: claim.height,
        claimTxHash: claim.txHash || null,
        claimMsgIndex: claim.msgIndex,
        claimEventId: claim.sourceEventId,
        rawClaimJson: claim.rawEventJson,
      },
    });
    if (count === 0) continue; // still missing — keep the failure open (no fabrication)
    await tx.projectionFailure.update({
      where: { id: failure.id },
      data: { resolved: true, resolvedAt },
    });
    resolved += 1;
  }
  return resolved;
}

async function createFailure(
  prisma: RewardsSnapshotPrisma,
  input: Omit<ProjectionFailureInput, 'projectionName' | 'module'>,
): Promise<void> {
  const data = withProjectionFailureKey({
    projectionName: REWARDS_SNAPSHOT_PROJECTION,
    module: 'rewards',
    ...input,
  });
  await prisma.projectionFailure.upsert({
    where: { failureKey: data.failureKey },
    create: data,
    update: { ...data, resolved: false, resolvedAt: null },
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface SlotRewardSnapshot {
  epochNumber: bigint;
  amount: string;
  denom: string;
  claimed: boolean;
  claimedAtHeight: bigint | null;
}

async function upsertSlotReward(
  prisma: RewardsSnapshotPrisma,
  args: { slotId: bigint; height: bigint; reward: SlotRewardSnapshot; raw: unknown },
): Promise<void> {
  const { slotId, height, reward } = args;
  const existing = await prisma.slotRewardProjection.findUnique({
    where: { slotId_epochNumber: { slotId, epochNumber: reward.epochNumber } },
  });

  // Reconciliation: never unset a claim already recorded (e.g. by the semantic claim
  // projector). claimed becomes true if either the snapshot or a prior claim says so.
  const claimed = reward.claimed || existing?.claimed === true;

  await prisma.slotRewardProjection.upsert({
    where: { slotId_epochNumber: { slotId, epochNumber: reward.epochNumber } },
    create: {
      slotId,
      epochNumber: reward.epochNumber,
      amount: reward.amount,
      denom: reward.denom,
      claimed,
      claimedAtHeight: reward.claimedAtHeight,
      sampledAtHeight: height,
      rawSnapshotJson: toJson(args.raw),
    },
    update: {
      amount: reward.amount,
      denom: reward.denom,
      claimed,
      ...(reward.claimedAtHeight !== null ? { claimedAtHeight: reward.claimedAtHeight } : {}),
      sampledAtHeight: height,
      rawSnapshotJson: toJson(args.raw),
    },
  });
}

async function upsertBalanceSample(
  prisma: RewardsSnapshotPrisma,
  args: {
    height: bigint;
    sampleKind: string;
    address: string | null;
    moduleName: string | null;
    denom: string;
    amount: string;
    raw: unknown;
  },
): Promise<void> {
  const sampleKey = buildBalanceSampleKey(args);
  await prisma.rewardsBalanceSample.upsert({
    where: { sampleKey },
    create: {
      height: args.height,
      sampleKind: args.sampleKind,
      address: args.address,
      moduleName: args.moduleName,
      denom: args.denom,
      amount: args.amount,
      sampleKey,
      rawJson: toJson(args.raw),
    },
    update: { amount: args.amount, rawJson: toJson(args.raw) },
  });
}

// --- tolerant extraction (defensive; live REST shapes confirmed via fixtures/smoke) -------

function extractSlotRewards(raw: unknown): SlotRewardSnapshot[] {
  const root = asRecord(raw);
  const list = readArray(root.rewards) ?? readArray(root.slot_rewards) ?? readArray(raw) ?? [];
  const out: SlotRewardSnapshot[] = [];
  for (const item of list) {
    const record = asRecord(item);
    const epochNumber = parseBigInt(
      readString(record.epoch_number) ?? readString(record.epoch) ?? readString(record.epochNumber),
    );
    const amount = readString(record.amount) ?? readString(record.reward) ?? null;
    if (epochNumber === undefined || amount === null) continue;
    out.push({
      epochNumber,
      amount,
      denom: readString(record.denom) ?? REWARDS_NATIVE_DENOM,
      claimed: readBool(record.claimed),
      // The chain returns claimed_at_height "0" for UNCLAIMED rewards; a real claim height is
      // always > 0. Map 0 (and unparseable) to null so an unclaimed reward never exposes a
      // claimedAtHeight that reads like a real block height.
      claimedAtHeight: claimedAtHeightOrNull(
        readString(record.claimed_at_height) ?? readString(record.claimedAtHeight),
      ),
    });
  }
  return out;
}

interface BalanceEntry {
  address: string | null;
  moduleName: string | null;
  denom: string;
  amount: string;
  raw: unknown;
}

function extractBalances(raw: unknown): BalanceEntry[] {
  const root = asRecord(raw);
  // Shape A — an array of {denom, amount, module_name?} entries (generic / forward-compat).
  const list = readArray(root.balances) ?? readArray(root.module_balances) ?? readArray(raw);
  if (list) {
    const out: BalanceEntry[] = [];
    for (const item of list) {
      const record = asRecord(item);
      const denom = readString(record.denom);
      const amount = readString(record.amount);
      if (!denom || amount === undefined) continue;
      out.push({
        address: readString(record.address) ?? null,
        moduleName: readString(record.module_name) ?? readString(record.moduleName) ?? readString(record.name) ?? null,
        denom,
        amount,
        raw: item,
      });
    }
    if (out.length > 0) return out;
  }
  // Shape B — live nyks-core x/rewards: a single object { denom, <module>_balance: amount, ... }
  // (e.g. { denom: "utwlt", rewards_balance: "...", fee_pool_balance: "0" }). Emit one
  // module_balance entry per `*_balance` field, moduleName derived from the field name.
  const denom = readString(root.denom);
  if (denom) {
    const out: BalanceEntry[] = [];
    for (const [key, value] of Object.entries(root)) {
      if (!key.endsWith('_balance')) continue;
      const amount = readString(value);
      if (amount === undefined) continue;
      out.push({ address: null, moduleName: key.slice(0, -'_balance'.length), denom, amount, raw: root });
    }
    return out;
  }
  return [];
}

function extractAmount(raw: unknown): { denom: string; amount: string } | null {
  const root = asRecord(raw);
  const inner = asRecord(root.cumulative_emitted ?? root.amount ?? raw);
  const denom = readString(inner.denom) ?? readString(root.denom) ?? REWARDS_NATIVE_DENOM;
  const amount = readString(inner.amount) ?? readString(root.amount) ?? readString(root.cumulative_emitted);
  if (amount === undefined) return null;
  return { denom, amount };
}

export function buildBalanceSampleKey(args: {
  height: bigint;
  sampleKind: string;
  address: string | null;
  moduleName: string | null;
  denom: string;
}): string {
  return [
    args.height.toString(),
    args.sampleKind,
    args.address ?? '-',
    args.moduleName ?? '-',
    args.denom,
  ].join(':');
}

function extractNextKey(raw: unknown): string | undefined {
  const pagination = asRecord(asRecord(raw).pagination);
  const nextKey = readString(pagination.next_key) ?? readString(pagination.nextKey);
  return nextKey && nextKey !== '' ? nextKey : undefined;
}

function readArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString();
  return undefined;
}

function readBool(value: unknown): boolean {
  return value === true || value === 'true';
}

function parseBigInt(value: string | undefined): bigint | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

// A claim height of 0 (the chain's sentinel for "not claimed") or an unparseable value is not a
// real block height — represent it as null rather than a misleading 0.
function claimedAtHeightOrNull(value: string | undefined): bigint | null {
  const parsed = parseBigInt(value);
  return parsed !== undefined && parsed > 0n ? parsed : null;
}

function toJson(value: unknown): unknown {
  return value ?? undefined;
}
