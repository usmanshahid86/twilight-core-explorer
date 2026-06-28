import { createHash } from 'node:crypto';
import {
  haltProjectionCursorError,
  updateProjectionCursorSuccess,
  type ProjectionCursorPrisma,
} from './cursor.js';
import type { ChainClient, GenesisSource } from '@twilight-explorer/chain-client';
import {
  CORESLOT_KEY_ROTATION_STATUS,
  CORESLOT_TEMPORAL_MAP_PROJECTION,
  type ProjectionFailureInput,
  type ProjectionFailureKind,
  withProjectionFailureKey,
} from './types.js';

const ACTIVE_STATUS = 'ACTIVE';

/**
 * Live Phase 6b-3 fixture showed:
 * validator update at H -> next_validators_hash at H+1 -> /validators?height membership at H+2.
 * CoreSlotConsensusWindow is for block-height membership attribution, so it uses H+2.
 */
export const VALIDATOR_SET_MEMBERSHIP_OFFSET = 2n;

export interface ProjectCoreSlotTemporalMapRangeArgs {
  prisma: CoreSlotTemporalMapProjectionPrisma;
  chainId: string;
  startHeight: bigint;
  endHeight: bigint;
  client?: Pick<ChainClient, 'getGenesis'> | undefined;
  seedGenesis?: boolean | undefined;
}

export interface ProjectCoreSlotTemporalMapHeightArgs {
  prisma: CoreSlotTemporalMapProjectionPrisma;
  chainId: string;
  height: bigint;
}

export interface ProjectCoreSlotTemporalMapResult {
  height: bigint;
  windowsWritten: number;
  failuresCreated: number;
}

export interface CoreSlotTemporalMapProjectionPrisma extends ProjectionCursorPrisma {
  coreSlotLifecycleEvent: {
    findMany(args: unknown): Promise<LifecycleSource[]>;
  };
  coreSlotConsensusKeyRotation: {
    findMany(args: unknown): Promise<RotationSource[]>;
  };
  coreSlotConsensusWindow: {
    findFirst(args: unknown): Promise<ConsensusWindowSource | null>;
    findMany(args: unknown): Promise<ConsensusWindowSource[]>;
    create(args: unknown): Promise<ConsensusWindowSource>;
    update(args: unknown): Promise<ConsensusWindowSource>;
    deleteMany(args?: unknown): Promise<unknown>;
  };
  projectionFailure: {
    upsert(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: CoreSlotTemporalMapProjectionPrisma) => Promise<T>): Promise<T>;
}

interface LifecycleSource {
  id: bigint;
  sourceEventId: bigint;
  height: bigint;
  txHash: string | null;
  msgIndex: number | null;
  slotId: bigint | null;
  eventType: string;
  newStatus: string | null;
  operatorAddress: string | null;
  consensusAddress: string | null;
  power: bigint | null;
  rawEventJson: unknown;
  rawMessageJson: unknown | null;
}

interface RotationSource {
  id: bigint;
  slotId: bigint;
  operatorAddress: string | null;
  oldConsensusAddress: string | null;
  newConsensusAddress: string | null;
  status: string;
  effectiveHeight: bigint | null;
  appliedHeight: bigint | null;
  cancelledHeight: bigint | null;
  power: bigint | null;
  sourceAppliedEventId: bigint | null;
  rawAppliedEventJson: unknown | null;
}

export interface ConsensusWindowSource {
  id: bigint;
  slotId: bigint;
  operatorAddress: string | null;
  consensusAddress: string;
  status: string;
  consensusPower: bigint | null;
  validatorUpdateHeight: bigint | null;
  effectiveFromHeight: bigint;
  effectiveToHeight: bigint | null;
  openedByKind: string;
  openedByEventId: bigint | null;
  openedByRotationId: bigint | null;
  openedByLifecycleId: bigint | null;
  closedByKind: string | null;
  closedByEventId: bigint | null;
  closedByRotationId: bigint | null;
  closedByLifecycleId: bigint | null;
  rawOpenJson: unknown | null;
  rawCloseJson: unknown | null;
}

interface Counters {
  windowsWritten: number;
  failuresCreated: number;
}

interface GenesisSeedResult {
  windowsWritten: number;
  failuresCreated: number;
}

interface OpenWindowInput {
  slotId: bigint;
  operatorAddress: string | null;
  consensusAddress: string;
  consensusPower: bigint | null;
  validatorUpdateHeight: bigint | null;
  effectiveFromHeight: bigint;
  openedByKind: string;
  openedByEventId: bigint | null;
  openedByRotationId: bigint | null;
  openedByLifecycleId: bigint | null;
  rawOpenJson: unknown | null;
  sourceHeight: bigint;
}

interface CloseWindowInput {
  slotId: bigint;
  consensusAddress?: string | null | undefined;
  effectiveToHeight: bigint;
  closedByKind: string;
  closedByEventId: bigint | null;
  closedByRotationId: bigint | null;
  closedByLifecycleId: bigint | null;
  rawCloseJson: unknown | null;
  sourceHeight: bigint;
  requireWindow: boolean;
}

export async function projectCoreSlotTemporalMapRange(
  args: ProjectCoreSlotTemporalMapRangeArgs,
): Promise<ProjectCoreSlotTemporalMapResult[]> {
  const results: ProjectCoreSlotTemporalMapResult[] = [];
  const shouldSeedGenesis = args.seedGenesis === true || args.startHeight <= 1n;
  if (shouldSeedGenesis) {
    if (!args.client) {
      await recordGenesisUnavailable(args.prisma, args.chainId, {
        error: 'ChainClient.getGenesis is required when rebuilding the temporal map genesis baseline.',
      });
      throw new Error('ChainClient.getGenesis is required for CoreSlot temporal genesis seed');
    }
    await seedCoreSlotGenesisTemporalMap({
      prisma: args.prisma,
      chainId: args.chainId,
      client: args.client,
    });
  }

  for (let height = args.startHeight; height <= args.endHeight; height += 1n) {
    results.push(await projectCoreSlotTemporalMapHeight({
      prisma: args.prisma,
      chainId: args.chainId,
      height,
    }));
  }
  return results;
}

// FU-1: genesis-seed ProjectionFailures are stamped at this sentinel height (below any real block
// height, which starts at 1). The per-height cleanup in projectCoreSlotTemporalMapHeight deletes
// failures by `sourceHeight = height` UNSCOPED by failureKind; on a full rebuild it runs at height 1
// and would otherwise silently wipe genesis failures stamped at 1n. Stamping them at 0n makes a
// malformed/ambiguous genesis ProjectionFailure durable. Mirrors the coreslot-genesis-identity 0n
// sentinel.
const GENESIS_SEED_FAILURE_SOURCE_HEIGHT = 0n;

// The failure kinds the genesis seed can emit. The idempotent re-seed cleanup is scoped to these so it
// can NEVER collaterally delete a non-genesis failure that also falls back to the 0n sentinel — e.g. a
// malformed rotation whose heights are all null (projectRotation uses `?? 0n`). 0n is NOT an exclusive
// genesis namespace, so a kind filter (not just the height) is required here.
const GENESIS_SEED_FAILURE_KINDS: ProjectionFailureKind[] = [
  'genesis_unavailable',
  'genesis_coreslot_malformed',
  'invalid_consensus_address',
  'temporal_window_conflict',
];

export async function seedCoreSlotGenesisTemporalMap(args: {
  prisma: CoreSlotTemporalMapProjectionPrisma;
  chainId: string;
  client: Pick<ChainClient, 'getGenesis'>;
}): Promise<GenesisSeedResult> {
  let genesis: GenesisSource;
  try {
    genesis = await args.client.getGenesis();
  } catch (error) {
    await recordGenesisUnavailable(args.prisma, args.chainId, { error });
    throw error;
  }

  const slots = extractGenesisSlots(genesis);
  if (!slots.ok) {
    await recordGenesisMalformed(args.prisma, args.chainId, {
      raw: genesis.raw,
      error: slots.error,
    });
    throw new Error(slots.error);
  }

  try {
    return await args.prisma.$transaction(async (tx) => {
      await tx.projectionFailure.deleteMany({
        where: {
          projectionName: CORESLOT_TEMPORAL_MAP_PROJECTION,
          // Idempotent re-seed: clear prior genesis-seed failures at the sentinel, scoped by kind so a
          // malformed-rotation failure that also lands at 0n (projectRotation `?? 0n`) is never touched.
          sourceHeight: GENESIS_SEED_FAILURE_SOURCE_HEIGHT,
          failureKind: { in: GENESIS_SEED_FAILURE_KINDS },
          resolved: false,
        },
      });

      const counters: Counters = { windowsWritten: 0, failuresCreated: 0 };
      for (const slot of slots.value) {
        await seedGenesisSlot(tx, slot, counters);
      }

      await updateProjectionCursorSuccess(
        tx,
        CORESLOT_TEMPORAL_MAP_PROJECTION,
        args.chainId,
        1n,
      );
      return counters;
    });
  } catch (error) {
    await haltProjectionCursorError(
      args.prisma,
      CORESLOT_TEMPORAL_MAP_PROJECTION,
      args.chainId,
      1n,
      error,
    );
    throw error;
  }
}

export async function projectCoreSlotTemporalMapHeight(
  args: ProjectCoreSlotTemporalMapHeightArgs,
): Promise<ProjectCoreSlotTemporalMapResult> {
  const { prisma, chainId, height } = args;

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.projectionFailure.deleteMany({
        where: {
          projectionName: CORESLOT_TEMPORAL_MAP_PROJECTION,
          sourceHeight: height,
          resolved: false,
        },
      });

      const counters = { windowsWritten: 0, failuresCreated: 0 };
      const lifecycleEvents = await tx.coreSlotLifecycleEvent.findMany({
        where: {
          height,
          eventType: {
            in: [
              'coreslot_registered',
              'coreslot_activated',
              'coreslot_inactivated',
              'coreslot_suspended',
              'coreslot_removed',
            ],
          },
        },
        orderBy: [{ height: 'asc' }, { id: 'asc' }],
      });
      const rotations = await tx.coreSlotConsensusKeyRotation.findMany({
        where: {
          OR: [
            { requestedHeight: height },
            { appliedHeight: height },
            { cancelledHeight: height },
          ],
        },
        orderBy: [{ id: 'asc' }],
      });

      for (const lifecycleEvent of lifecycleEvents) {
        await projectLifecycleEvent(tx, lifecycleEvent, counters);
      }

      for (const rotation of rotations) {
        await projectRotation(tx, rotation, counters);
      }

      await updateProjectionCursorSuccess(
        tx,
        CORESLOT_TEMPORAL_MAP_PROJECTION,
        chainId,
        height,
      );

      return { height, ...counters };
    });
  } catch (error) {
    await haltProjectionCursorError(
      prisma,
      CORESLOT_TEMPORAL_MAP_PROJECTION,
      chainId,
      height,
      error,
    );
    throw error;
  }
}

async function recordGenesisUnavailable(
  prisma: CoreSlotTemporalMapProjectionPrisma,
  chainId: string,
  input: { error: unknown },
): Promise<void> {
  const error = input.error instanceof Error ? input.error.message : String(input.error);
  await prisma.$transaction(async (tx) => {
    await createFailure(tx, {
      sourceHeight: GENESIS_SEED_FAILURE_SOURCE_HEIGHT,
      failureKind: 'genesis_unavailable',
      error,
    });
    await haltProjectionCursorError(
      tx,
      CORESLOT_TEMPORAL_MAP_PROJECTION,
      chainId,
      1n,
      error,
    );
  });
}

async function recordGenesisMalformed(
  prisma: CoreSlotTemporalMapProjectionPrisma,
  chainId: string,
  input: { raw: unknown; error: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await createFailure(tx, {
      sourceHeight: GENESIS_SEED_FAILURE_SOURCE_HEIGHT,
      failureKind: 'genesis_coreslot_malformed',
      rawEventJson: input.raw,
      error: input.error,
    });
    await haltProjectionCursorError(
      tx,
      CORESLOT_TEMPORAL_MAP_PROJECTION,
      chainId,
      1n,
      input.error,
    );
  });
}

async function seedGenesisSlot(
  tx: CoreSlotTemporalMapProjectionPrisma,
  slot: GenesisSlotSource,
  counters: Counters,
): Promise<void> {
  if (!isActiveGenesisSlot(slot.raw)) return;

  if (slot.slotId === null) {
    await createFailure(tx, {
      sourceHeight: GENESIS_SEED_FAILURE_SOURCE_HEIGHT,
      failureKind: 'genesis_coreslot_malformed',
      rawEventJson: slot.raw,
      error: 'Active genesis CoreSlot is missing a valid slot id.',
    });
    counters.failuresCreated += 1;
    return;
  }

  const consensusAddress = normalizeOptionalConsensusAddress(slot.consensusAddress);
  if (!consensusAddress.ok || consensusAddress.value === null) {
    await createFailure(tx, {
      sourceHeight: GENESIS_SEED_FAILURE_SOURCE_HEIGHT,
      failureKind: 'invalid_consensus_address',
      rawEventJson: slot.raw,
      error: consensusAddress.ok
        ? 'Active genesis CoreSlot is missing a consensus address.'
        : consensusAddress.error,
    });
    counters.failuresCreated += 1;
    return;
  }

  // Genesis is the initial validator set, not a validator-set update. The Phase 6b-4
  // validatorUpdateHeight + 2 rule applies only to later lifecycle/rotation updates.
  const opened = await openActiveWindow(tx, {
    slotId: slot.slotId,
    operatorAddress: slot.operatorAddress,
    consensusAddress: consensusAddress.value,
    consensusPower: slot.consensusPower,
    validatorUpdateHeight: null,
    effectiveFromHeight: 1n,
    openedByKind: 'genesis',
    openedByEventId: null,
    openedByRotationId: null,
    openedByLifecycleId: null,
    rawOpenJson: slot.raw,
    // FU-1: genesis-window-conflict failures from openActiveWindow must also be durable (0n sentinel).
    sourceHeight: GENESIS_SEED_FAILURE_SOURCE_HEIGHT,
  });
  if (opened.ok) counters.windowsWritten += opened.written ? 1 : 0;
  else counters.failuresCreated += 1;
}

interface GenesisSlotSource {
  slotId: bigint | null;
  operatorAddress: string | null;
  consensusAddress: string | null;
  consensusPower: bigint | null;
  raw: unknown;
}

function extractGenesisSlots(
  genesis: GenesisSource,
): { ok: true; value: GenesisSlotSource[] } | { ok: false; error: string } {
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
      return {
        slotId: parseBigInt(readString(
          record.slot_id ?? record.slotId ?? record.id,
        )) ?? null,
        operatorAddress: readString(record.operator_address ?? record.operatorAddress) ?? null,
        consensusAddress: readString(
          record.consensus_address
            ?? record.consensusAddress
            ?? record.consensus_addr
            ?? record.consensusAddr,
        ) ?? deriveConsensusAddressFromPubkey(
          record.consensus_pubkey ?? record.consensusPubkey,
        ),
        consensusPower: parseBigInt(readString(
          record.consensus_power ?? record.consensusPower ?? record.power,
        )) ?? null,
        raw: slot,
      };
    }),
  };
}

function isActiveGenesisSlot(raw: unknown): boolean {
  const record = asRecord(raw);
  const status = readString(record.status)?.trim().toLowerCase();
  return status === 'active' || status === 'slot_status_active';
}

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

async function projectLifecycleEvent(
  tx: CoreSlotTemporalMapProjectionPrisma,
  event: LifecycleSource,
  counters: Counters,
): Promise<void> {
  if (event.slotId === null) {
    await createFailure(tx, {
      sourceHeight: event.height,
      sourceEventId: event.sourceEventId,
      eventType: event.eventType,
      failureKind: 'invalid_slot_id',
      rawEventJson: event.rawEventJson,
      error: `${event.eventType} lifecycle row is missing slotId.`,
    });
    counters.failuresCreated += 1;
    return;
  }

  if (event.eventType === 'coreslot_registered') {
    return;
  }

  if (event.eventType === 'coreslot_activated') {
    const consensusAddress = normalizeConsensusAddress(event.consensusAddress);
    if (!consensusAddress.ok) {
      await createFailure(tx, {
        sourceHeight: event.height,
        sourceEventId: event.sourceEventId,
        eventType: event.eventType,
        failureKind: 'invalid_consensus_address',
        rawEventJson: event.rawEventJson,
        error: consensusAddress.error,
      });
      counters.failuresCreated += 1;
      return;
    }

    const validatorUpdateHeight = deriveLifecycleValidatorUpdateHeight(event);
    const effectiveFromHeight = membershipHeightFromValidatorUpdate(validatorUpdateHeight);
    const opened = await openActiveWindow(tx, {
      slotId: event.slotId,
      operatorAddress: event.operatorAddress,
      consensusAddress: consensusAddress.value,
      consensusPower: event.power,
      validatorUpdateHeight,
      effectiveFromHeight,
      openedByKind: 'lifecycle',
      openedByEventId: event.sourceEventId,
      openedByRotationId: null,
      openedByLifecycleId: event.id,
      rawOpenJson: buildRawLifecycleJson(event),
      sourceHeight: event.height,
    });
    if (opened.ok) counters.windowsWritten += opened.written ? 1 : 0;
    else counters.failuresCreated += 1;
    return;
  }

  if (
    event.eventType === 'coreslot_inactivated'
    || event.eventType === 'coreslot_suspended'
    || event.eventType === 'coreslot_removed'
  ) {
    const closed = await closeActiveWindows(tx, {
      slotId: event.slotId,
      effectiveToHeight: membershipHeightFromValidatorUpdate(
        deriveLifecycleValidatorUpdateHeight(event),
      ),
      closedByKind: 'lifecycle',
      closedByEventId: event.sourceEventId,
      closedByRotationId: null,
      closedByLifecycleId: event.id,
      rawCloseJson: buildRawLifecycleJson(event),
      sourceHeight: event.height,
      requireWindow: false,
    });
    if (closed.ok) counters.windowsWritten += closed.written;
    else counters.failuresCreated += 1;
    return;
  }

  await createFailure(tx, {
    sourceHeight: event.height,
    sourceEventId: event.sourceEventId,
    eventType: event.eventType,
    failureKind: 'unknown_semantic_type',
    rawEventJson: event.rawEventJson,
    error: `Unsupported CoreSlot lifecycle event for temporal map: ${event.eventType}`,
  });
  counters.failuresCreated += 1;
}

async function projectRotation(
  tx: CoreSlotTemporalMapProjectionPrisma,
  rotation: RotationSource,
  counters: Counters,
): Promise<void> {
  if (
    rotation.status === CORESLOT_KEY_ROTATION_STATUS.requested
    || rotation.status === CORESLOT_KEY_ROTATION_STATUS.cancelled
  ) {
    return;
  }

  if (
    rotation.status !== CORESLOT_KEY_ROTATION_STATUS.applied
    && rotation.status !== CORESLOT_KEY_ROTATION_STATUS.immediateApplied
  ) {
    await createFailure(tx, {
      sourceHeight: rotation.appliedHeight ?? rotation.cancelledHeight ?? 0n,
      sourceEventId: rotation.sourceAppliedEventId,
      failureKind: 'unknown_semantic_type',
      rawEventJson: rotation.rawAppliedEventJson,
      error: `Unsupported CoreSlot key rotation status for temporal map: ${rotation.status}`,
    });
    counters.failuresCreated += 1;
    return;
  }

  const sourceHeight = rotation.appliedHeight ?? rotation.effectiveHeight ?? 0n;
  const newConsensusAddress = normalizeConsensusAddress(rotation.newConsensusAddress);
  if (!newConsensusAddress.ok) {
    await createFailure(tx, {
      sourceHeight,
      sourceEventId: rotation.sourceAppliedEventId,
      failureKind: 'invalid_consensus_address',
      rawEventJson: rotation.rawAppliedEventJson,
      error: newConsensusAddress.error,
    });
    counters.failuresCreated += 1;
    return;
  }

  const oldConsensusAddress = normalizeOptionalConsensusAddress(rotation.oldConsensusAddress);
  if (!oldConsensusAddress.ok) {
    await createFailure(tx, {
      sourceHeight,
      sourceEventId: rotation.sourceAppliedEventId,
      failureKind: 'invalid_consensus_address',
      rawEventJson: rotation.rawAppliedEventJson,
      error: oldConsensusAddress.error,
    });
    counters.failuresCreated += 1;
    return;
  }

  const validatorUpdateHeight = deriveRotationValidatorUpdateHeight(rotation);
  if (validatorUpdateHeight === null) {
    await createFailure(tx, {
      sourceHeight,
      sourceEventId: rotation.sourceAppliedEventId,
      failureKind: 'effective_height_invalid',
      rawEventJson: rotation.rawAppliedEventJson,
      error: 'Applied CoreSlot key rotation is missing both effectiveHeight and appliedHeight.',
    });
    counters.failuresCreated += 1;
    return;
  }
  const effectiveFromHeight = membershipHeightFromValidatorUpdate(validatorUpdateHeight);

  const existingNewWindow = await findSlotConsensusWindowAtHeight(
    tx,
    rotation.slotId,
    newConsensusAddress.value,
    effectiveFromHeight,
  );

  if (!existingNewWindow) {
    const closed = await closeActiveWindows(tx, {
      slotId: rotation.slotId,
      consensusAddress: oldConsensusAddress.value,
      effectiveToHeight: effectiveFromHeight,
      closedByKind: 'key_rotation',
      closedByEventId: rotation.sourceAppliedEventId,
      closedByRotationId: rotation.id,
      closedByLifecycleId: null,
      rawCloseJson: buildRawRotationJson(rotation),
      sourceHeight,
      requireWindow: oldConsensusAddress.value === null,
    });
    if (!closed.ok) {
      counters.failuresCreated += 1;
      return;
    }
    counters.windowsWritten += closed.written;
  }

  const opened = await openActiveWindow(tx, {
    slotId: rotation.slotId,
    operatorAddress: rotation.operatorAddress,
    consensusAddress: newConsensusAddress.value,
    consensusPower: rotation.power,
    validatorUpdateHeight,
    effectiveFromHeight,
    openedByKind: 'key_rotation',
    openedByEventId: rotation.sourceAppliedEventId,
    openedByRotationId: rotation.id,
    openedByLifecycleId: null,
    rawOpenJson: buildRawRotationJson(rotation),
    sourceHeight,
  });
  if (opened.ok) counters.windowsWritten += opened.written ? 1 : 0;
  else counters.failuresCreated += 1;
}

async function openActiveWindow(
  tx: CoreSlotTemporalMapProjectionPrisma,
  input: OpenWindowInput,
): Promise<{ ok: true; written: boolean } | { ok: false }> {
  const existingSame = await findSlotConsensusWindowAtHeight(
    tx,
    input.slotId,
    input.consensusAddress,
    input.effectiveFromHeight,
  );
  if (existingSame) {
    await tx.coreSlotConsensusWindow.update({
      where: { id: existingSame.id },
      data: {
        operatorAddress: input.operatorAddress ?? existingSame.operatorAddress,
        consensusPower: input.consensusPower ?? existingSame.consensusPower,
        validatorUpdateHeight: input.validatorUpdateHeight ?? existingSame.validatorUpdateHeight,
        rawOpenJson: input.rawOpenJson ?? existingSame.rawOpenJson,
      },
    });
    return { ok: true, written: false };
  }

  const activeSlotWindows = await findOpenSlotWindows(tx, input.slotId);
  for (const window of activeSlotWindows) {
    if (window.effectiveFromHeight >= input.effectiveFromHeight) {
      await createFailure(tx, {
        sourceHeight: input.sourceHeight,
        sourceEventId: input.openedByEventId,
        failureKind: 'temporal_window_conflict',
        rawEventJson: input.rawOpenJson,
        error: `Slot ${input.slotId.toString()} already has an active window at height ${input.effectiveFromHeight.toString()}.`,
      });
      return { ok: false };
    }
    await closeWindow(tx, window, {
      effectiveToHeight: input.effectiveFromHeight,
      closedByKind: input.openedByKind,
      closedByEventId: input.openedByEventId,
      closedByRotationId: input.openedByRotationId,
      closedByLifecycleId: input.openedByLifecycleId,
      rawCloseJson: input.rawOpenJson,
      sourceHeight: input.sourceHeight,
    });
  }

  const consensusConflicts = await findConsensusWindowsAtHeight(
    tx,
    input.consensusAddress,
    input.effectiveFromHeight,
  );
  const conflictingWindow = consensusConflicts.find((window) => window.slotId !== input.slotId);
  if (conflictingWindow) {
    await createFailure(tx, {
      sourceHeight: input.sourceHeight,
      sourceEventId: input.openedByEventId,
      failureKind: 'temporal_window_conflict',
      rawEventJson: input.rawOpenJson,
      error: `Consensus address ${input.consensusAddress} already maps to slot ${conflictingWindow.slotId.toString()} at height ${input.effectiveFromHeight.toString()}.`,
    });
    return { ok: false };
  }

  await tx.coreSlotConsensusWindow.create({
    data: {
      slotId: input.slotId,
      operatorAddress: input.operatorAddress,
      consensusAddress: input.consensusAddress,
      status: ACTIVE_STATUS,
      consensusPower: input.consensusPower,
      validatorUpdateHeight: input.validatorUpdateHeight,
      effectiveFromHeight: input.effectiveFromHeight,
      effectiveToHeight: null,
      openedByKind: input.openedByKind,
      openedByEventId: input.openedByEventId,
      openedByRotationId: input.openedByRotationId,
      openedByLifecycleId: input.openedByLifecycleId,
      rawOpenJson: input.rawOpenJson,
    },
  });
  return { ok: true, written: true };
}

async function closeActiveWindows(
  tx: CoreSlotTemporalMapProjectionPrisma,
  input: CloseWindowInput,
): Promise<{ ok: true; written: number } | { ok: false }> {
  const normalizedConsensusAddress = input.consensusAddress !== undefined
    ? normalizeOptionalConsensusAddress(input.consensusAddress ?? null)
    : { ok: true as const, value: undefined };
  if (!normalizedConsensusAddress.ok) {
    await createFailure(tx, {
      sourceHeight: input.sourceHeight,
      sourceEventId: input.closedByEventId,
      failureKind: 'invalid_consensus_address',
      rawEventJson: input.rawCloseJson,
      error: normalizedConsensusAddress.error,
    });
    return { ok: false };
  }

  let windows = await findOpenSlotWindows(tx, input.slotId);
  if (normalizedConsensusAddress.value !== undefined && normalizedConsensusAddress.value !== null) {
    windows = windows.filter((window) => window.consensusAddress === normalizedConsensusAddress.value);
  }

  if (normalizedConsensusAddress.value === null && windows.length > 1) {
    await createFailure(tx, {
      sourceHeight: input.sourceHeight,
      sourceEventId: input.closedByEventId,
      failureKind: 'temporal_window_ambiguous',
      rawEventJson: input.rawCloseJson,
      error: `Cannot infer which active window to close for slot ${input.slotId.toString()}.`,
    });
    return { ok: false };
  }

  if (windows.length === 0) {
    if (input.requireWindow) {
      await createFailure(tx, {
        sourceHeight: input.sourceHeight,
        sourceEventId: input.closedByEventId,
        failureKind: 'missing_activation_window',
        rawEventJson: input.rawCloseJson,
        error: `No active consensus window found for slot ${input.slotId.toString()}.`,
      });
      return { ok: false };
    }
    return { ok: true, written: 0 };
  }

  let written = 0;
  for (const window of windows) {
    const closed = await closeWindow(tx, window, input);
    if (!closed.ok) return { ok: false };
    written += 1;
  }
  return { ok: true, written };
}

async function closeWindow(
  tx: CoreSlotTemporalMapProjectionPrisma,
  window: ConsensusWindowSource,
  input: {
    effectiveToHeight: bigint;
    closedByKind: string;
    closedByEventId: bigint | null;
    closedByRotationId: bigint | null;
    closedByLifecycleId: bigint | null;
    rawCloseJson: unknown | null;
    sourceHeight: bigint;
  },
): Promise<{ ok: true } | { ok: false }> {
  if (input.effectiveToHeight <= window.effectiveFromHeight) {
    await createFailure(tx, {
      sourceHeight: input.sourceHeight,
      sourceEventId: input.closedByEventId,
      failureKind: 'effective_height_invalid',
      rawEventJson: input.rawCloseJson,
      error: `Window close height ${input.effectiveToHeight.toString()} must be greater than open height ${window.effectiveFromHeight.toString()}.`,
    });
    return { ok: false };
  }

  if (window.effectiveToHeight !== null && window.effectiveToHeight <= input.effectiveToHeight) {
    return { ok: true };
  }

  await tx.coreSlotConsensusWindow.update({
    where: { id: window.id },
    data: {
      effectiveToHeight: input.effectiveToHeight,
      closedByKind: input.closedByKind,
      closedByEventId: input.closedByEventId,
      closedByRotationId: input.closedByRotationId,
      closedByLifecycleId: input.closedByLifecycleId,
      rawCloseJson: input.rawCloseJson,
    },
  });
  return { ok: true };
}

export async function findConsensusWindowAtHeight(
  prisma: Pick<CoreSlotTemporalMapProjectionPrisma, 'coreSlotConsensusWindow'>,
  consensusAddress: string,
  height: bigint,
): Promise<ConsensusWindowSource | null> {
  const normalized = normalizeConsensusAddress(consensusAddress);
  if (!normalized.ok) return null;
  return prisma.coreSlotConsensusWindow.findFirst({
    where: {
      consensusAddress: normalized.value,
      effectiveFromHeight: { lte: height },
      OR: [{ effectiveToHeight: null }, { effectiveToHeight: { gt: height } }],
    },
    orderBy: [{ effectiveFromHeight: 'desc' }],
  });
}

/**
 * Returns every materialized CoreSlot consensus window that covers `committedHeight`
 * (across all slots / consensus addresses). This is the expected-signer enumeration used by
 * the liveness projection (Phase 8c-1).
 *
 * Coverage is decided purely from the materialized window bounds:
 *   effectiveFromHeight <= committedHeight AND (effectiveToHeight IS NULL OR effectiveToHeight > committedHeight)
 *
 * It does NOT consult current CoreSlotProjection.status, does NOT apply the +2 membership
 * offset (that offset is already baked into effectiveFromHeight at window-open time via
 * membershipHeightFromValidatorUpdate), and naturally excludes closed/inactive windows (a window
 * closed at boundary B has effectiveToHeight=B, so it is excluded for committedHeight >= B).
 * Mirrors the coverage predicate of findConsensusWindowAtHeight; the temporal-map module remains
 * the sole owner of window-boundary semantics.
 */
export async function findActiveCoreSlotWindowsAtHeight(
  prisma: {
    coreSlotConsensusWindow: { findMany(args: unknown): Promise<ConsensusWindowSource[]> };
  },
  committedHeight: bigint,
): Promise<ConsensusWindowSource[]> {
  return prisma.coreSlotConsensusWindow.findMany({
    where: {
      effectiveFromHeight: { lte: committedHeight },
      OR: [{ effectiveToHeight: null }, { effectiveToHeight: { gt: committedHeight } }],
    },
    orderBy: [{ slotId: 'asc' }, { effectiveFromHeight: 'asc' }],
  });
}

export async function findSlotConsensusWindowAtHeight(
  prisma: Pick<CoreSlotTemporalMapProjectionPrisma, 'coreSlotConsensusWindow'>,
  slotId: bigint,
  consensusAddressOrHeight: string | bigint,
  maybeHeight?: bigint,
): Promise<ConsensusWindowSource | null> {
  const height = typeof consensusAddressOrHeight === 'bigint'
    ? consensusAddressOrHeight
    : maybeHeight;
  if (height === undefined) return null;
  const consensusAddress = typeof consensusAddressOrHeight === 'string'
    ? normalizeConsensusAddress(consensusAddressOrHeight)
    : null;
  if (consensusAddress && !consensusAddress.ok) return null;

  return prisma.coreSlotConsensusWindow.findFirst({
    where: {
      slotId,
      ...(consensusAddress ? { consensusAddress: consensusAddress.value } : {}),
      effectiveFromHeight: { lte: height },
      OR: [{ effectiveToHeight: null }, { effectiveToHeight: { gt: height } }],
    },
    orderBy: [{ effectiveFromHeight: 'desc' }],
  });
}

async function findConsensusWindowsAtHeight(
  prisma: Pick<CoreSlotTemporalMapProjectionPrisma, 'coreSlotConsensusWindow'>,
  consensusAddress: string,
  height: bigint,
): Promise<ConsensusWindowSource[]> {
  return prisma.coreSlotConsensusWindow.findMany({
    where: {
      consensusAddress,
      effectiveFromHeight: { lte: height },
      OR: [{ effectiveToHeight: null }, { effectiveToHeight: { gt: height } }],
    },
    orderBy: [{ effectiveFromHeight: 'asc' }],
  });
}

async function findOpenSlotWindows(
  prisma: Pick<CoreSlotTemporalMapProjectionPrisma, 'coreSlotConsensusWindow'>,
  slotId: bigint,
): Promise<ConsensusWindowSource[]> {
  return prisma.coreSlotConsensusWindow.findMany({
    where: {
      slotId,
      status: ACTIVE_STATUS,
      effectiveToHeight: null,
    },
    orderBy: [{ effectiveFromHeight: 'asc' }],
  });
}

function deriveLifecycleValidatorUpdateHeight(event: LifecycleSource): bigint {
  return readJsonHeight(event.rawEventJson, 'effective_height') ?? event.height;
}

function deriveRotationValidatorUpdateHeight(rotation: RotationSource): bigint | null {
  if (rotation.effectiveHeight !== null) return rotation.effectiveHeight;
  if (rotation.appliedHeight !== null) return rotation.appliedHeight;
  return null;
}

function membershipHeightFromValidatorUpdate(validatorUpdateHeight: bigint): bigint {
  return validatorUpdateHeight + VALIDATOR_SET_MEMBERSHIP_OFFSET;
}

function readJsonHeight(value: unknown, key: string): bigint | null {
  const raw = readString(asRecord(value)[key]);
  if (!raw) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

function normalizeConsensusAddress(value: string | null): {
  ok: true;
  value: string;
} | {
  ok: false;
  error: string;
} {
  if (!value) {
    return { ok: false, error: 'CoreSlot consensus address is required.' };
  }
  const trimmed = value.trim();
  if (!/^[0-9a-fA-F]{40}$/.test(trimmed)) {
    return { ok: false, error: `CoreSlot consensus address must be 40-character hex: ${value}` };
  }
  return { ok: true, value: trimmed.toLowerCase() };
}

function normalizeOptionalConsensusAddress(value: string | null): {
  ok: true;
  value: string | null;
} | {
  ok: false;
  error: string;
} {
  if (value === null || value.trim() === '') return { ok: true, value: null };
  return normalizeConsensusAddress(value);
}

async function createFailure(
  prisma: CoreSlotTemporalMapProjectionPrisma,
  args: {
    sourceHeight: bigint;
    sourceEventId?: bigint | null | undefined;
    eventType?: string | null | undefined;
    failureKind: ProjectionFailureKind;
    rawEventJson?: unknown | null | undefined;
    error: string;
  },
): Promise<void> {
  const failure: ProjectionFailureInput = {
    projectionName: CORESLOT_TEMPORAL_MAP_PROJECTION,
    module: 'coreslot',
    sourceHeight: args.sourceHeight,
    sourceEventId: args.sourceEventId ?? null,
    eventType: args.eventType ?? null,
    failureKind: args.failureKind,
    rawEventJson: args.rawEventJson ?? null,
    error: args.error,
  };
  const data = withProjectionFailureKey(failure);

  await prisma.projectionFailure.upsert({
    where: { failureKey: data.failureKey },
    create: data,
    update: {
      ...data,
      resolved: false,
      resolvedAt: null,
    },
  });
}

function buildRawLifecycleJson(event: LifecycleSource): unknown {
  return {
    id: event.id.toString(),
    sourceEventId: event.sourceEventId.toString(),
    height: event.height.toString(),
    eventType: event.eventType,
    rawEventJson: event.rawEventJson,
    rawMessageJson: event.rawMessageJson,
  };
}

function buildRawRotationJson(rotation: RotationSource): unknown {
  return {
    id: rotation.id.toString(),
    slotId: rotation.slotId.toString(),
    status: rotation.status,
    effectiveHeight: rotation.effectiveHeight?.toString() ?? null,
    appliedHeight: rotation.appliedHeight?.toString() ?? null,
    sourceAppliedEventId: rotation.sourceAppliedEventId?.toString() ?? null,
    rawAppliedEventJson: rotation.rawAppliedEventJson,
  };
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
  if (value === undefined || value.trim() === '') return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

// Height semantics for downstream consumers:
// - block.header.proposer_address belongs to block height N, so proposer joins should query N.
// - block.last_commit.signatures in block N are signatures for committed block N-1, so
//   later liveness attribution should query N-1. This phase only builds the temporal map.
