import { updateProjectionCursorSuccess, type ProjectionCursorPrisma } from './cursor.js';
import { REWARDS_NATIVE_DENOM, REWARDS_SNAPSHOT_PROJECTION } from './types.js';

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
  };
  rewardsBalanceSample: { upsert(args: unknown): Promise<unknown> };
}

interface SlotRewardRow {
  id: bigint;
  claimed: boolean;
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
}

export async function ingestRewardsSnapshot(
  args: IngestRewardsSnapshotArgs,
): Promise<IngestRewardsSnapshotResult> {
  const { prisma, client, chainId, height } = args;

  const slotIds = args.slotIds
    ?? (await prisma.coreSlotProjection.findMany({ select: { slotId: true } })).map((r) => r.slotId);

  let slotRewardRows = 0;
  for (const slotId of slotIds) {
    // Paginate until the chain's pagination.next_key is exhausted so a slot with many
    // epochs of rewards is not silently truncated to the first page.
    let key: string | undefined;
    let guard = 0;
    do {
      const snapshot = await client.getSlotRewards(slotId, key ? { key } : undefined, height);
      for (const reward of extractSlotRewards(snapshot.raw)) {
        await upsertSlotReward(prisma, { slotId, height, reward, raw: snapshot.raw });
        slotRewardRows += 1;
      }
      key = extractNextKey(snapshot.raw);
      guard += 1;
    } while (key && guard < 10_000);
  }

  let balanceSamples = 0;
  const moduleBalances = await client.getModuleBalances(height);
  for (const balance of extractBalances(moduleBalances.raw)) {
    await upsertBalanceSample(prisma, {
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

  const cumulative = await client.getCumulativeEmitted(height);
  const cumulativeAmount = extractAmount(cumulative.raw);
  if (cumulativeAmount) {
    await upsertBalanceSample(prisma, {
      height,
      sampleKind: 'cumulative_emitted',
      address: null,
      moduleName: null,
      denom: cumulativeAmount.denom,
      amount: cumulativeAmount.amount,
      raw: cumulative.raw,
    });
    balanceSamples += 1;
  }

  await updateProjectionCursorSuccess(prisma, REWARDS_SNAPSHOT_PROJECTION, chainId, height);
  return { height, slotRewardRows, balanceSamples };
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
      claimedAtHeight: parseBigInt(
        readString(record.claimed_at_height) ?? readString(record.claimedAtHeight),
      ) ?? null,
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
  const list = readArray(root.balances) ?? readArray(root.module_balances) ?? readArray(raw) ?? [];
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
  return out;
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

function toJson(value: unknown): unknown {
  return value ?? undefined;
}
