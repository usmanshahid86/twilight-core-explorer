import {
  haltProjectionCursorError,
  updateProjectionCursorSuccess,
  type ProjectionCursorPrisma,
} from './cursor.js';
import { buildBalanceSampleKey } from './rewards-snapshot.js';
import {
  BALANCE_SNAPSHOT_PROJECTION,
  SUPPLY_SAMPLE_KIND,
  withProjectionFailureKey,
  type ProjectionFailureInput,
} from './types.js';

/**
 * Observed-sample ingestion for account balances + bank supply (projection balance_snapshot_v1).
 *
 * These rows are NOT rebuildable from generic rows: a balance is x/bank current state, read live
 * via ChainClient and tied to the height at which it was sampled. The projection reads ALL chain
 * state first; only if every read succeeds does it write (supply rows + account balances) in one
 * transaction and mark the cursor success. If any chain read fails it records a ProjectionFailure,
 * halts the cursor, and writes NO rows (never a guessed/partial value).
 *
 * Scope: supply (all denoms from getSupply) + current balances for the bounded set of distinct
 * CoreSlot operator/payout addresses (+ optional extraAddresses). Module/rewards balances are NOT
 * duplicated here (rewards_snapshot_v1 owns them).
 */
export interface BalanceSnapshotChainClient {
  getSupply(): Promise<Array<{ denom: string; amount: string; raw?: unknown }>>;
  getBalances(address: string): Promise<{ raw: unknown }>;
}

export interface BalanceSnapshotPrisma extends ProjectionCursorPrisma {
  coreSlotProjection: {
    findMany(args: unknown): Promise<Array<{ operatorAddress: string | null; payoutAddress: string | null }>>;
  };
  rewardsBalanceSample: { upsert(args: unknown): Promise<unknown> };
  accountBalanceCurrent: { upsert(args: unknown): Promise<unknown> };
  projectionFailure: { upsert(args: unknown): Promise<unknown> };
  $transaction<T>(fn: (tx: BalanceSnapshotPrisma) => Promise<T>): Promise<T>;
}

export interface ProjectBalanceSnapshotArgs {
  prisma: BalanceSnapshotPrisma;
  client: BalanceSnapshotChainClient;
  chainId: string;
  height: bigint;
  extraAddresses?: string[] | undefined;
}

export interface ProjectBalanceSnapshotResult {
  height: bigint;
  addressCount: number;
  supplyRows: number;
  accountRows: number;
  failed: boolean;
}

interface Coin {
  denom: string;
  amount: string;
  raw: unknown;
}

export async function projectBalanceSnapshot(
  args: ProjectBalanceSnapshotArgs,
): Promise<ProjectBalanceSnapshotResult> {
  const { prisma, client, chainId, height } = args;
  const addresses = await resolveAddressSet(prisma, args.extraAddresses);

  // 1. Read ALL chain state first. No writes happen before every read succeeds.
  let supply: Coin[];
  const accountBalances: Array<{ address: string; coins: Coin[] }> = [];
  try {
    // Skip malformed coins (empty denom/amount) so we never persist a junk supply row — the same
    // tolerant validation the account-balance path (extractCoins) applies.
    supply = (await client.getSupply())
      .map((c) => ({ denom: c.denom, amount: c.amount, raw: c.raw ?? c }))
      .filter((c) => c.denom.length > 0 && c.amount.length > 0);
    for (const address of addresses) {
      const snapshot = await client.getBalances(address);
      accountBalances.push({ address, coins: extractCoins(snapshot.raw) });
    }
  } catch (error) {
    // Chain read failed: halt the cursor + record a ProjectionFailure, write nothing.
    await haltProjectionCursorError(prisma, BALANCE_SNAPSHOT_PROJECTION, chainId, height, error);
    await createFailure(prisma, {
      sourceHeight: height,
      failureKind: 'balance_snapshot_chain_read_failed',
      error: formatError(error),
    });
    return { height, addressCount: addresses.length, supplyRows: 0, accountRows: 0, failed: true };
  }

  // 2. Build + write all rows in one transaction (avoids partial writes).
  let supplyRows = 0;
  let accountRows = 0;
  await prisma.$transaction(async (tx) => {
    for (const coin of supply) {
      const sampleKey = buildBalanceSampleKey({
        height,
        sampleKind: SUPPLY_SAMPLE_KIND,
        address: null,
        moduleName: null,
        denom: coin.denom,
      });
      await tx.rewardsBalanceSample.upsert({
        where: { sampleKey },
        create: {
          height,
          sampleKind: SUPPLY_SAMPLE_KIND,
          address: null,
          moduleName: null,
          denom: coin.denom,
          amount: coin.amount,
          sampleKey,
          rawJson: coin.raw ?? undefined,
        },
        update: { amount: coin.amount, rawJson: coin.raw ?? undefined },
      });
      supplyRows += 1;
    }

    for (const { address, coins } of accountBalances) {
      for (const coin of coins) {
        const balanceKey = `${address}:${coin.denom}`;
        await tx.accountBalanceCurrent.upsert({
          where: { balanceKey },
          create: {
            balanceKey,
            address,
            denom: coin.denom,
            amount: coin.amount,
            sampledAtHeight: height,
            source: 'sampled',
            rawJson: coin.raw ?? undefined,
          },
          update: {
            amount: coin.amount,
            sampledAtHeight: height,
            source: 'sampled',
            rawJson: coin.raw ?? undefined,
          },
        });
        accountRows += 1;
      }
    }
  });

  await updateProjectionCursorSuccess(prisma, BALANCE_SNAPSHOT_PROJECTION, chainId, height);
  return { height, addressCount: addresses.length, supplyRows, accountRows, failed: false };
}

/** Distinct non-null CoreSlot operator ∪ payout addresses (+ optional extras), deterministically ordered. */
async function resolveAddressSet(
  prisma: BalanceSnapshotPrisma,
  extraAddresses: string[] | undefined,
): Promise<string[]> {
  const rows = await prisma.coreSlotProjection.findMany({
    select: { operatorAddress: true, payoutAddress: true },
  });
  const set = new Set<string>();
  for (const row of rows) {
    if (row.operatorAddress) set.add(row.operatorAddress);
    if (row.payoutAddress) set.add(row.payoutAddress);
  }
  for (const address of extraAddresses ?? []) {
    if (address) set.add(address);
  }
  return [...set].sort();
}

async function createFailure(
  prisma: BalanceSnapshotPrisma,
  input: Omit<ProjectionFailureInput, 'projectionName' | 'module'>,
): Promise<void> {
  const data = withProjectionFailureKey({
    projectionName: BALANCE_SNAPSHOT_PROJECTION,
    module: 'bank',
    ...input,
  });
  await prisma.projectionFailure.upsert({
    where: { failureKey: data.failureKey },
    create: data,
    update: { ...data, resolved: false, resolvedAt: null },
  });
}

// --- tolerant extraction of bank /balances/{address} coins -------------------------------

function extractCoins(raw: unknown): Coin[] {
  const root = asRecord(raw);
  const list = readArray(root.balances) ?? readArray(raw) ?? [];
  const out: Coin[] = [];
  for (const item of list) {
    const record = asRecord(item);
    const denom = readString(record.denom);
    const amount = readString(record.amount);
    if (!denom || amount === undefined || amount === '') continue;
    out.push({ denom, amount, raw: item });
  }
  return out;
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
