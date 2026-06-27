import { createHash } from 'node:crypto';
import type { ChainClient, GenesisSource } from '@twilight-explorer/chain-client';
import {
  CORESLOT_METADATA_PROJECTION,
  type ProjectionFailureInput,
  type ProjectionFailureKind,
  withProjectionFailureKey,
} from './types.js';

/**
 * Genesis CoreSlot identity seed (Phase 7.2, finding F1).
 *
 * CoreSlots created in `app_state.coreslot.slots` at genesis (e.g. via `coreslot-genesis add`)
 * emit no on-chain MsgCreateCoreSlot / lifecycle events, so the event-driven semantic
 * projectors never create a `CoreSlotProjection` identity row for them. Everything keyed off
 * slot identity then comes up empty: `getSlotRewards` enumeration (rewards-snapshot),
 * `/coreslots/{id}/rewards`, and the operator/CoreSlot pages.
 *
 * This seeds the identity BASELINE from the (deterministic, rebuildable) genesis document —
 * NOT from a live `getActiveCoreSlots()` snapshot, which would be an observed sample and
 * violate the rebuildability invariant. It is the identity analogue of
 * `seedCoreSlotGenesisTemporalMap` (which seeds consensus windows from the same genesis).
 *
 * It runs first, at the start of the metadata step of the combined rebuild (gated on
 * reset / startHeight<=1), so subsequent event replay (metadata/lifecycle/payout/key-rotation)
 * upserts onto the same `slotId` and overrides any field a later on-chain change touched.
 * The consensus-address derivation and status normalization MUST match the lifecycle /
 * temporal-map projectors so a genesis slot reconciles to one identity across projections.
 */

export interface CoreSlotGenesisIdentityPrisma {
  coreSlotProjection: { upsert(args: unknown): Promise<unknown> };
  projectionFailure: { upsert(args: unknown): Promise<unknown> };
}

export interface SeedCoreSlotGenesisIdentityArgs {
  prisma: CoreSlotGenesisIdentityPrisma;
  chainId: string;
  client: Pick<ChainClient, 'getGenesis'>;
}

export interface CoreSlotGenesisIdentityResult {
  slotsSeeded: number;
  failuresCreated: number;
}

interface GenesisIdentitySlot {
  slotId: bigint | null;
  status: string | null;
  operatorAddress: string | null;
  payoutAddress: string | null;
  consensusAddress: string | null;
  consensusPubkeyJson: unknown | null;
  rewardWeight: string | null;
  consensusPower: bigint | null;
  metadataJson: unknown | null;
  createdHeight: bigint | null;
  raw: unknown;
}

export async function seedCoreSlotGenesisIdentity(
  args: SeedCoreSlotGenesisIdentityArgs,
): Promise<CoreSlotGenesisIdentityResult> {
  let genesis: GenesisSource;
  try {
    genesis = await args.client.getGenesis();
  } catch (error) {
    await createFailure(args.prisma, {
      failureKind: 'genesis_unavailable',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const extracted = extractGenesisIdentitySlots(genesis);
  if (!extracted.ok) {
    await createFailure(args.prisma, {
      failureKind: 'genesis_coreslot_malformed',
      rawJson: genesis.raw,
      error: extracted.error,
    });
    return { slotsSeeded: 0, failuresCreated: 1 };
  }

  let slotsSeeded = 0;
  let failuresCreated = 0;
  for (const slot of extracted.value) {
    if (slot.slotId === null) {
      await createFailure(args.prisma, {
        failureKind: 'invalid_slot_id',
        rawJson: slot.raw,
        error: 'Genesis CoreSlot is missing a valid slot id.',
      });
      failuresCreated += 1;
      continue;
    }

    const create = {
      slotId: slot.slotId,
      status: slot.status,
      operatorAddress: slot.operatorAddress,
      payoutAddress: slot.payoutAddress,
      consensusAddress: slot.consensusAddress,
      consensusPubkeyJson: slot.consensusPubkeyJson ?? undefined,
      rewardWeight: slot.rewardWeight,
      consensusPower: slot.consensusPower,
      metadataJson: slot.metadataJson ?? undefined,
      createdHeight: slot.createdHeight,
      // Genesis baseline lives at height 1; later on-chain events bump updatedHeight on replay.
      updatedHeight: 1n,
      lastSourceHeight: 1n,
      rawSnapshotJson: slot.raw ?? undefined,
    };
    await args.prisma.coreSlotProjection.upsert({
      where: { slotId: slot.slotId },
      create,
      // Genesis identity is immutable and is only a BASELINE: on the reset+replay flow the
      // table was cleared first, so this always takes the `create` path; later on-chain
      // metadata/lifecycle/payout events upsert their own changes onto the same slotId. On an
      // incremental re-seed (non-reset, startHeight<=1) the row already carries event-derived
      // state, so the seed must NOT overwrite it — a no-op update preserves it (and avoids
      // regressing updatedHeight back to the genesis baseline).
      update: {},
    });
    slotsSeeded += 1;
  }

  return { slotsSeeded, failuresCreated };
}

function extractGenesisIdentitySlots(
  genesis: GenesisSource,
): { ok: true; value: GenesisIdentitySlot[] } | { ok: false; error: string } {
  const coreSlot = asRecord(genesis.coreSlot);
  if (Object.keys(coreSlot).length === 0) {
    return { ok: false, error: 'Genesis app_state.coreslot is missing or empty.' };
  }

  const slotsRaw = coreSlot.slots ?? coreSlot.Slots;
  const slotsRecord = asRecord(slotsRaw);
  const slots = Array.isArray(slotsRaw)
    ? slotsRaw
    : Object.keys(slotsRecord).length > 0
      ? Object.values(slotsRecord)
      : null;
  if (!slots) {
    return { ok: false, error: 'Genesis app_state.coreslot.slots is missing or not an array/map.' };
  }

  return {
    ok: true,
    value: slots.map((slot) => {
      const record = asRecord(slot);
      const consensusPubkey = record.consensus_pubkey ?? record.consensusPubkey ?? null;
      return {
        slotId: parseBigInt(readString(record.slot_id ?? record.slotId ?? record.id)) ?? null,
        status: normalizeStatus(readString(record.status)),
        operatorAddress: readString(record.operator_address ?? record.operatorAddress) ?? null,
        payoutAddress: readString(record.payout_address ?? record.payoutAddress) ?? null,
        consensusAddress:
          normalizeConsensusAddress(
            readString(record.consensus_address ?? record.consensusAddress),
          ) ?? deriveConsensusAddressFromPubkey(consensusPubkey),
        consensusPubkeyJson: consensusPubkey,
        rewardWeight: readString(record.reward_weight ?? record.rewardWeight) ?? null,
        consensusPower: parseBigInt(
          readString(record.consensus_power ?? record.consensusPower ?? record.power),
        ) ?? null,
        metadataJson: record.metadata ?? null,
        createdHeight: parseBigInt(readString(record.created_height ?? record.createdHeight)) ?? null,
        raw: slot,
      };
    }),
  };
}

/** `SLOT_STATUS_ACTIVE` -> `ACTIVE`, matching `statusFromEventType` in coreslot-lifecycle. */
function normalizeStatus(value: string | undefined): string | null {
  if (!value) return null;
  return value.trim().toUpperCase().replace(/^SLOT_STATUS_/, '');
}

/** Lower-case 40-hex, matching coreslot-lifecycle's normalizeConsensusAddress (or null). */
function normalizeConsensusAddress(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^[0-9a-fA-F]{40}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

/**
 * Tendermint ed25519 consensus address = first 20 bytes of sha256(pubkey), lower-case hex.
 * MUST stay byte-identical to coreslot-temporal-map's derivation so genesis identity and
 * genesis windows resolve to the same consensus address.
 */
function deriveConsensusAddressFromPubkey(value: unknown): string | null {
  const record = asRecord(value);
  const key = readString(record.key);
  if (!key) return null;
  try {
    const pubkey = Buffer.from(key, 'base64');
    if (pubkey.length === 0) return null;
    return createHash('sha256').update(pubkey).digest().subarray(0, 20).toString('hex');
  } catch {
    return null;
  }
}

async function createFailure(
  prisma: CoreSlotGenesisIdentityPrisma,
  args: {
    failureKind: ProjectionFailureKind;
    error: string;
    rawJson?: unknown;
  },
): Promise<void> {
  const failure: ProjectionFailureInput = {
    projectionName: CORESLOT_METADATA_PROJECTION,
    // Genesis-document failures are stamped at the pre-chain sentinel height 0, NOT 1. The
    // metadata per-height projection opens each height with
    // `deleteMany({ projectionName, sourceHeight: height, resolved: false })` to keep reruns
    // idempotent; since this seed runs inside the same metadata projection and the height loop
    // starts at the min indexed block (>=1, CometBFT has no block 0), stamping a genesis failure
    // at height 1 would let the height-1 pass silently delete it — defeating failure durability.
    // Height 0 is never revisited by the loop, so the failure persists.
    module: 'coreslot',
    sourceHeight: 0n,
    sourceTxHash: null,
    sourceMsgIndex: null,
    sourceMessageId: null,
    sourceEventId: null,
    typeUrl: null,
    eventType: null,
    failureKind: args.failureKind,
    rawMessageJson: null,
    rawEventJson: args.rawJson ?? null,
    error: args.error,
  };
  const data = withProjectionFailureKey(failure);
  await prisma.projectionFailure.upsert({
    where: { failureKey: data.failureKey },
    create: data,
    update: { ...data, resolved: false, resolvedAt: null },
  });
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

function parseBigInt(value: string | undefined): bigint | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return undefined;
  try {
    return BigInt(trimmed);
  } catch {
    return undefined;
  }
}
