import {
  haltProjectionCursorError,
  updateProjectionCursorSuccess,
  type ProjectionCursorPrisma,
} from './cursor.js';
import {
  CORESLOT_KEY_ROTATED_EVENT_TYPE,
  CORESLOT_KEY_ROTATION_EVENT_TYPES,
  CORESLOT_KEY_ROTATION_PROJECTION,
  CORESLOT_KEY_ROTATION_REQUESTED_EVENT_TYPE,
  CORESLOT_KEY_ROTATION_STATUS,
  CORESLOT_KEY_ROTATION_TYPE_URL,
  CORESLOT_ROTATION_CANCELLED_EVENT_TYPE,
  type ProjectionFailureInput,
  type ProjectionFailureKind,
  withProjectionFailureKey,
} from './types.js';

export interface ProjectCoreSlotKeyRotationRangeArgs {
  prisma: CoreSlotKeyRotationProjectionPrisma;
  chainId: string;
  startHeight: bigint;
  endHeight: bigint;
}

export interface ProjectCoreSlotKeyRotationHeightArgs {
  prisma: CoreSlotKeyRotationProjectionPrisma;
  chainId: string;
  height: bigint;
}

export interface ProjectCoreSlotKeyRotationResult {
  height: bigint;
  rotationsWritten: number;
  failuresCreated: number;
}

export interface CoreSlotKeyRotationProjectionPrisma extends ProjectionCursorPrisma {
  explorerTransaction: {
    findMany(args: unknown): Promise<TransactionSource[]>;
  };
  message: {
    findMany(args: unknown): Promise<MessageSource[]>;
  };
  event: {
    findMany(args: unknown): Promise<EventSource[]>;
  };
  coreSlotConsensusKeyRotation: {
    findFirst(args: unknown): Promise<RotationRow | null>;
    findMany(args: unknown): Promise<RotationRow[]>;
    upsert(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
  coreSlotProjection: {
    upsert(args: unknown): Promise<unknown>;
  };
  projectionFailure: {
    upsert(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: CoreSlotKeyRotationProjectionPrisma) => Promise<T>): Promise<T>;
}

interface TransactionSource {
  hash: string;
  height: bigint;
  code: number | null;
  status: string;
}

interface MessageSource {
  id: bigint;
  txHash: string;
  height: bigint;
  msgIndex: number;
  typeUrl: string;
  module: string | null;
  decodedJson: unknown | null;
  rawJson: unknown | null;
}

interface EventSource {
  id: bigint;
  height: bigint;
  txHash: string | null;
  msgIndex: number | null;
  type: string;
  attributesJson: unknown;
}

interface RotationRow {
  id: bigint;
  slotId: bigint;
  status: string;
  newConsensusAddress: string | null;
  effectiveHeight: bigint | null;
}

interface RotationEventPayload {
  slotId: bigint;
  operatorAddress: string | null;
  oldConsensusAddress: string | null;
  newConsensusAddress: string | null;
  power: bigint | null;
  effectiveHeight: bigint | null;
  reason: string | null;
}

export async function projectCoreSlotKeyRotationRange(
  args: ProjectCoreSlotKeyRotationRangeArgs,
): Promise<ProjectCoreSlotKeyRotationResult[]> {
  const results: ProjectCoreSlotKeyRotationResult[] = [];
  for (let height = args.startHeight; height <= args.endHeight; height += 1n) {
    results.push(await projectCoreSlotKeyRotationHeight({
      prisma: args.prisma,
      chainId: args.chainId,
      height,
    }));
  }
  return results;
}

export async function projectCoreSlotKeyRotationHeight(
  args: ProjectCoreSlotKeyRotationHeightArgs,
): Promise<ProjectCoreSlotKeyRotationResult> {
  const { prisma, chainId, height } = args;

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.projectionFailure.deleteMany({
        where: {
          projectionName: CORESLOT_KEY_ROTATION_PROJECTION,
          sourceHeight: height,
          resolved: false,
        },
      });

      const transactions = await tx.explorerTransaction.findMany({
        where: {
          height,
          OR: [{ status: 'success' }, { code: 0 }],
        },
        select: { hash: true, height: true, code: true, status: true },
      });
      const successfulTxHashes = new Set(transactions.map((transaction) => transaction.hash));

      // Rotation events are not always tx-bound: delayed application and lifecycle
      // cancellation happen in EndBlock with no txHash. Load every rotation event at
      // this height by type, then guard tx-bound events against failed transactions.
      const events = await tx.event.findMany({
        where: {
          height,
          type: { in: [...CORESLOT_KEY_ROTATION_EVENT_TYPES] },
        },
        orderBy: [{ id: 'asc' }],
      });

      const requestedEvents = events.filter(
        (event) => event.type === CORESLOT_KEY_ROTATION_REQUESTED_EVENT_TYPE,
      );
      const rotatedEvents = events.filter(
        (event) => event.type === CORESLOT_KEY_ROTATED_EVENT_TYPE,
      );
      const cancelledEvents = events.filter(
        (event) => event.type === CORESLOT_ROTATION_CANCELLED_EVENT_TYPE,
      );

      const messages = successfulTxHashes.size === 0
        ? []
        : await tx.message.findMany({
            where: {
              height,
              txHash: { in: [...successfulTxHashes] },
              module: 'coreslot',
              typeUrl: CORESLOT_KEY_ROTATION_TYPE_URL,
            },
            orderBy: [{ txHash: 'asc' }, { msgIndex: 'asc' }],
          });

      const usedRequestedEventIds = new Set<string>();
      const usedRotatedEventIds = new Set<string>();
      const counters = { rotationsWritten: 0, failuresCreated: 0 };

      // 1. Tx-bound MsgRotateConsensusKey: requested rows and immediate applications.
      for (const message of messages) {
        await projectRotationMessage(tx, {
          message,
          requestedEvents,
          rotatedEvents,
          usedRequestedEventIds,
          usedRotatedEventIds,
          counters,
        });
      }

      // 2. Requested events with no matching message (decode gap on a tx-bound request).
      for (const event of requestedEvents) {
        if (usedRequestedEventIds.has(event.id.toString())) continue;
        if (isFailedTxBound(event, successfulTxHashes)) continue;
        await projectOrphanRequestedEvent(tx, { event, counters });
      }

      // 3. Applied events not consumed as immediate: delayed / event-only application.
      for (const event of rotatedEvents) {
        if (usedRotatedEventIds.has(event.id.toString())) continue;
        if (isFailedTxBound(event, successfulTxHashes)) continue;
        await projectAppliedEvent(tx, { event, counters });
      }

      // 4. Cancellation events.
      for (const event of cancelledEvents) {
        if (isFailedTxBound(event, successfulTxHashes)) continue;
        await projectCancelledEvent(tx, { event, counters });
      }

      await updateProjectionCursorSuccess(
        tx,
        CORESLOT_KEY_ROTATION_PROJECTION,
        chainId,
        height,
      );

      return {
        height,
        rotationsWritten: counters.rotationsWritten,
        failuresCreated: counters.failuresCreated,
      };
    });
  } catch (error) {
    await haltProjectionCursorError(
      prisma,
      CORESLOT_KEY_ROTATION_PROJECTION,
      chainId,
      height,
      error,
    );
    throw error;
  }
}

interface Counters {
  rotationsWritten: number;
  failuresCreated: number;
}

async function projectRotationMessage(
  tx: CoreSlotKeyRotationProjectionPrisma,
  args: {
    message: MessageSource;
    requestedEvents: EventSource[];
    rotatedEvents: EventSource[];
    usedRequestedEventIds: Set<string>;
    usedRotatedEventIds: Set<string>;
    counters: Counters;
  },
): Promise<void> {
  const { message, counters } = args;
  const slotId = parseSlotId(readMessageSlotId(message));
  if (slotId === undefined) {
    await createFailure(tx, {
      message,
      failureKind: 'invalid_slot_id',
      error: `Invalid CoreSlot slot_id on MsgRotateConsensusKey: ${readMessageSlotId(message)}`,
    });
    counters.failuresCreated += 1;
    return;
  }

  const operatorAddress = readMessageOperator(message);

  const requestedMatches = args.requestedEvents.filter(
    (event) => !args.usedRequestedEventIds.has(event.id.toString())
      && eventMatchesMessage(event, message, slotId),
  );
  if (requestedMatches.length > 1) {
    await createFailure(tx, {
      message,
      event: requestedMatches[0],
      failureKind: 'ambiguous_event',
      error: `${requestedMatches.length} coreslot_key_rotation_requested events matched one MsgRotateConsensusKey.`,
    });
    counters.failuresCreated += 1;
    return;
  }

  if (requestedMatches.length === 1) {
    const event = requestedMatches[0];
    if (!event) return;
    const payload = extractRotationEventPayload(event, slotId);
    if (!payload.ok) {
      await createFailure(tx, { message, event, failureKind: payload.failureKind, error: payload.error });
      counters.failuresCreated += 1;
      return;
    }
    await upsertRequestedRotation(tx, { message, event, payload: payload.value, operatorAddress });
    args.usedRequestedEventIds.add(event.id.toString());
    counters.rotationsWritten += 1;
    return;
  }

  const rotatedMatches = args.rotatedEvents.filter(
    (event) => !args.usedRotatedEventIds.has(event.id.toString())
      && eventMatchesMessage(event, message, slotId),
  );
  if (rotatedMatches.length > 1) {
    await createFailure(tx, {
      message,
      event: rotatedMatches[0],
      failureKind: 'ambiguous_event',
      error: `${rotatedMatches.length} coreslot_key_rotated events matched one MsgRotateConsensusKey.`,
    });
    counters.failuresCreated += 1;
    return;
  }

  if (rotatedMatches.length === 1) {
    const event = rotatedMatches[0];
    if (!event) return;
    const payload = extractRotationEventPayload(event, slotId);
    if (!payload.ok) {
      await createFailure(tx, { message, event, failureKind: payload.failureKind, error: payload.error });
      counters.failuresCreated += 1;
      return;
    }
    await upsertImmediateAppliedRotation(tx, {
      message,
      event,
      payload: payload.value,
      operatorAddress,
    });
    args.usedRotatedEventIds.add(event.id.toString());
    counters.rotationsWritten += 1;
    return;
  }

  await createFailure(tx, {
    message,
    failureKind: 'missing_event',
    error: 'MsgRotateConsensusKey had no matching requested or rotated event.',
  });
  counters.failuresCreated += 1;
}

async function projectOrphanRequestedEvent(
  tx: CoreSlotKeyRotationProjectionPrisma,
  args: { event: EventSource; counters: Counters },
): Promise<void> {
  const { event, counters } = args;
  const slotId = parseSlotId(readEventAttr(event, 'slot_id'));
  if (slotId === undefined) {
    await createFailure(tx, {
      event,
      failureKind: 'invalid_slot_id',
      error: `Invalid slot_id on coreslot_key_rotation_requested: ${readEventAttr(event, 'slot_id')}`,
    });
    counters.failuresCreated += 1;
    return;
  }
  const payload = extractRotationEventPayload(event, slotId);
  if (!payload.ok) {
    await createFailure(tx, { event, failureKind: payload.failureKind, error: payload.error });
    counters.failuresCreated += 1;
    return;
  }

  await upsertRequestedRotation(tx, {
    event,
    payload: payload.value,
    operatorAddress: payload.value.operatorAddress,
  });
  await createFailure(tx, {
    event,
    failureKind: 'missing_message',
    error: 'coreslot_key_rotation_requested event had no matching MsgRotateConsensusKey message.',
  });
  counters.rotationsWritten += 1;
  counters.failuresCreated += 1;
}

async function projectAppliedEvent(
  tx: CoreSlotKeyRotationProjectionPrisma,
  args: { event: EventSource; counters: Counters },
): Promise<void> {
  const { event, counters } = args;
  const slotId = parseSlotId(readEventAttr(event, 'slot_id'));
  if (slotId === undefined) {
    await createFailure(tx, {
      event,
      failureKind: 'invalid_slot_id',
      error: `Invalid slot_id on coreslot_key_rotated: ${readEventAttr(event, 'slot_id')}`,
    });
    counters.failuresCreated += 1;
    return;
  }
  const payload = extractRotationEventPayload(event, slotId);
  if (!payload.ok) {
    await createFailure(tx, { event, failureKind: payload.failureKind, error: payload.error });
    counters.failuresCreated += 1;
    return;
  }

  // Idempotent rerun: this applied event already drives an existing row.
  const existing = await tx.coreSlotConsensusKeyRotation.findFirst({
    where: { sourceAppliedEventId: event.id },
  });
  if (existing) {
    await markRotationApplied(tx, existing.id, event, payload.value);
    await updateProjectionConsensusAddress(tx, { event, payload: payload.value });
    counters.rotationsWritten += 1;
    return;
  }

  const matches = await tx.coreSlotConsensusKeyRotation.findMany({
    where: {
      slotId,
      status: CORESLOT_KEY_ROTATION_STATUS.requested,
      newConsensusAddress: payload.value.newConsensusAddress,
      ...(payload.value.effectiveHeight !== null
        ? { effectiveHeight: payload.value.effectiveHeight }
        : {}),
    },
  });

  if (matches.length > 1) {
    await createFailure(tx, {
      event,
      failureKind: 'rotation_correlation_failed',
      error: `${matches.length} requested rotations matched one coreslot_key_rotated event.`,
    });
    counters.failuresCreated += 1;
    return;
  }

  if (matches.length === 1) {
    const match = matches[0];
    if (!match) return;
    await markRotationApplied(tx, match.id, event, payload.value);
    await updateProjectionConsensusAddress(tx, { event, payload: payload.value });
    counters.rotationsWritten += 1;
    return;
  }

  // Event-only application with no prior request: confirmed effect, recorded as drift.
  await createAppliedRotation(tx, { event, payload: payload.value });
  await updateProjectionConsensusAddress(tx, { event, payload: payload.value });
  await createFailure(tx, {
    event,
    failureKind: 'missing_request',
    error: 'coreslot_key_rotated event had no matching requested rotation row.',
  });
  counters.rotationsWritten += 1;
  counters.failuresCreated += 1;
}

async function projectCancelledEvent(
  tx: CoreSlotKeyRotationProjectionPrisma,
  args: { event: EventSource; counters: Counters },
): Promise<void> {
  const { event, counters } = args;
  const slotId = parseSlotId(readEventAttr(event, 'slot_id'));
  if (slotId === undefined) {
    await createFailure(tx, {
      event,
      failureKind: 'invalid_slot_id',
      error: `Invalid slot_id on coreslot_rotation_cancelled: ${readEventAttr(event, 'slot_id')}`,
    });
    counters.failuresCreated += 1;
    return;
  }
  const payload = extractRotationEventPayload(event, slotId);
  if (!payload.ok) {
    await createFailure(tx, { event, failureKind: payload.failureKind, error: payload.error });
    counters.failuresCreated += 1;
    return;
  }

  const existing = await tx.coreSlotConsensusKeyRotation.findFirst({
    where: { sourceCancelledEventId: event.id },
  });
  if (existing) {
    await markRotationCancelled(tx, existing.id, event, payload.value);
    counters.rotationsWritten += 1;
    return;
  }

  const matches = await tx.coreSlotConsensusKeyRotation.findMany({
    where: {
      slotId,
      status: CORESLOT_KEY_ROTATION_STATUS.requested,
      newConsensusAddress: payload.value.newConsensusAddress,
      ...(payload.value.effectiveHeight !== null
        ? { effectiveHeight: payload.value.effectiveHeight }
        : {}),
    },
  });

  if (matches.length > 1) {
    await createFailure(tx, {
      event,
      failureKind: 'rotation_correlation_failed',
      error: `${matches.length} requested rotations matched one coreslot_rotation_cancelled event.`,
    });
    counters.failuresCreated += 1;
    return;
  }

  if (matches.length === 1) {
    const match = matches[0];
    if (!match) return;
    await markRotationCancelled(tx, match.id, event, payload.value);
    counters.rotationsWritten += 1;
    return;
  }

  await createCancelledRotation(tx, { event, payload: payload.value });
  await createFailure(tx, {
    event,
    failureKind: 'missing_request',
    error: 'coreslot_rotation_cancelled event had no matching requested rotation row.',
  });
  counters.rotationsWritten += 1;
  counters.failuresCreated += 1;
}

// --- row writers -----------------------------------------------------------

async function upsertRequestedRotation(
  tx: CoreSlotKeyRotationProjectionPrisma,
  args: {
    message?: MessageSource;
    event: EventSource;
    payload: RotationEventPayload;
    operatorAddress: string | null;
  },
): Promise<void> {
  const { event, payload, message } = args;
  const requestFields = {
    slotId: payload.slotId,
    operatorAddress: args.operatorAddress ?? payload.operatorAddress,
    oldConsensusAddress: payload.oldConsensusAddress,
    newConsensusAddress: payload.newConsensusAddress,
    requestedHeight: message?.height ?? event.height,
    effectiveHeight: payload.effectiveHeight,
    sourceMessageId: message?.id ?? null,
    requestTxHash: message?.txHash ?? event.txHash ?? null,
    requestMsgIndex: message?.msgIndex ?? event.msgIndex ?? null,
    rawMessageJson: message ? buildRawMessageJson(message) : null,
    rawRequestEventJson: buildRawEventJson(event),
  };

  await tx.coreSlotConsensusKeyRotation.upsert({
    where: { sourceRequestEventId: event.id },
    // status is only set on create so a later applied/cancelled transition is not
    // clobbered when the requested height is reprojected.
    create: {
      status: CORESLOT_KEY_ROTATION_STATUS.requested,
      sourceRequestEventId: event.id,
      ...requestFields,
    },
    update: { ...requestFields },
  });
}

async function upsertImmediateAppliedRotation(
  tx: CoreSlotKeyRotationProjectionPrisma,
  args: {
    message: MessageSource;
    event: EventSource;
    payload: RotationEventPayload;
    operatorAddress: string | null;
  },
): Promise<void> {
  const { message, event, payload } = args;
  const fields = {
    slotId: payload.slotId,
    operatorAddress: args.operatorAddress ?? payload.operatorAddress,
    oldConsensusAddress: payload.oldConsensusAddress,
    newConsensusAddress: payload.newConsensusAddress,
    requestedHeight: message.height,
    effectiveHeight: payload.effectiveHeight,
    appliedHeight: event.height,
    power: payload.power,
    sourceMessageId: message.id,
    appliedTxHash: event.txHash ?? message.txHash,
    appliedMsgIndex: event.msgIndex ?? message.msgIndex,
    rawMessageJson: buildRawMessageJson(message),
    rawAppliedEventJson: buildRawEventJson(event),
  };

  await tx.coreSlotConsensusKeyRotation.upsert({
    where: { sourceAppliedEventId: event.id },
    create: {
      status: CORESLOT_KEY_ROTATION_STATUS.immediateApplied,
      sourceAppliedEventId: event.id,
      ...fields,
    },
    update: {
      status: CORESLOT_KEY_ROTATION_STATUS.immediateApplied,
      ...fields,
    },
  });

  await updateProjectionConsensusAddress(tx, {
    event,
    payload: payload,
    message,
    operatorAddress: args.operatorAddress ?? payload.operatorAddress,
  });
}

async function markRotationApplied(
  tx: CoreSlotKeyRotationProjectionPrisma,
  id: bigint,
  event: EventSource,
  payload: RotationEventPayload,
): Promise<void> {
  await tx.coreSlotConsensusKeyRotation.update({
    where: { id },
    data: {
      status: CORESLOT_KEY_ROTATION_STATUS.applied,
      appliedHeight: event.height,
      power: payload.power,
      oldConsensusAddress: payload.oldConsensusAddress,
      newConsensusAddress: payload.newConsensusAddress,
      effectiveHeight: payload.effectiveHeight,
      sourceAppliedEventId: event.id,
      appliedTxHash: event.txHash ?? null,
      appliedMsgIndex: event.msgIndex ?? null,
      rawAppliedEventJson: buildRawEventJson(event),
    },
  });
}

async function createAppliedRotation(
  tx: CoreSlotKeyRotationProjectionPrisma,
  args: { event: EventSource; payload: RotationEventPayload },
): Promise<void> {
  const { event, payload } = args;
  await tx.coreSlotConsensusKeyRotation.create({
    data: {
      status: CORESLOT_KEY_ROTATION_STATUS.applied,
      slotId: payload.slotId,
      operatorAddress: payload.operatorAddress,
      oldConsensusAddress: payload.oldConsensusAddress,
      newConsensusAddress: payload.newConsensusAddress,
      effectiveHeight: payload.effectiveHeight,
      appliedHeight: event.height,
      power: payload.power,
      sourceAppliedEventId: event.id,
      appliedTxHash: event.txHash ?? null,
      appliedMsgIndex: event.msgIndex ?? null,
      rawAppliedEventJson: buildRawEventJson(event),
    },
  });
}

async function markRotationCancelled(
  tx: CoreSlotKeyRotationProjectionPrisma,
  id: bigint,
  event: EventSource,
  payload: RotationEventPayload,
): Promise<void> {
  await tx.coreSlotConsensusKeyRotation.update({
    where: { id },
    data: {
      status: CORESLOT_KEY_ROTATION_STATUS.cancelled,
      cancelledHeight: event.height,
      reason: payload.reason,
      sourceCancelledEventId: event.id,
      cancelledTxHash: event.txHash ?? null,
      cancelledMsgIndex: event.msgIndex ?? null,
      rawCancelledEventJson: buildRawEventJson(event),
    },
  });
}

async function createCancelledRotation(
  tx: CoreSlotKeyRotationProjectionPrisma,
  args: { event: EventSource; payload: RotationEventPayload },
): Promise<void> {
  const { event, payload } = args;
  await tx.coreSlotConsensusKeyRotation.create({
    data: {
      status: CORESLOT_KEY_ROTATION_STATUS.cancelled,
      slotId: payload.slotId,
      operatorAddress: payload.operatorAddress,
      oldConsensusAddress: payload.oldConsensusAddress,
      newConsensusAddress: payload.newConsensusAddress,
      cancelledHeight: event.height,
      reason: payload.reason,
      sourceCancelledEventId: event.id,
      cancelledTxHash: event.txHash ?? null,
      cancelledMsgIndex: event.msgIndex ?? null,
      rawCancelledEventJson: buildRawEventJson(event),
    },
  });
}

async function updateProjectionConsensusAddress(
  tx: CoreSlotKeyRotationProjectionPrisma,
  args: {
    event: EventSource;
    payload: RotationEventPayload;
    message?: MessageSource;
    operatorAddress?: string | null;
  },
): Promise<void> {
  const { event, payload, message } = args;
  // Only confirmed applications reach here, and only with a valid new address.
  if (!payload.newConsensusAddress) return;

  const operatorAddress = args.operatorAddress ?? payload.operatorAddress ?? undefined;
  const fields = {
    consensusAddress: payload.newConsensusAddress,
    ...(operatorAddress !== undefined ? { operatorAddress } : {}),
    ...(payload.power !== null ? { consensusPower: payload.power } : {}),
    updatedHeight: event.height,
    lastSourceHeight: event.height,
    lastSourceTxHash: event.txHash ?? message?.txHash ?? null,
    lastSourceMsgIndex: event.msgIndex ?? message?.msgIndex ?? null,
    lastSourceMessageId: message?.id ?? null,
    lastSourceEventId: event.id,
  };

  await tx.coreSlotProjection.upsert({
    where: { slotId: payload.slotId },
    create: { slotId: payload.slotId, ...fields },
    update: { ...fields },
  });
}

// --- extraction / helpers --------------------------------------------------

function extractRotationEventPayload(event: EventSource, slotId: bigint): {
  ok: true;
  value: RotationEventPayload;
} | {
  ok: false;
  failureKind: ProjectionFailureKind;
  error: string;
} {
  const oldConsensus = normalizeOptionalConsensusAddress(readEventAttr(event, 'old_consensus_address'));
  if (!oldConsensus.ok) {
    return { ok: false, failureKind: 'invalid_consensus_address', error: oldConsensus.error };
  }
  const newConsensus = normalizeOptionalConsensusAddress(readEventAttr(event, 'new_consensus_address'));
  if (!newConsensus.ok) {
    return { ok: false, failureKind: 'invalid_consensus_address', error: newConsensus.error };
  }

  const rawPower = readEventAttr(event, 'power');
  let power: bigint | null = null;
  if (rawPower !== undefined && rawPower !== '') {
    try {
      power = BigInt(rawPower);
    } catch {
      return {
        ok: false,
        failureKind: 'missing_required_payload',
        error: `Invalid CoreSlot rotation power: ${rawPower}`,
      };
    }
  }

  const rawEffective = readEventAttr(event, 'effective_height');
  let effectiveHeight: bigint | null = null;
  if (rawEffective !== undefined && rawEffective !== '') {
    try {
      effectiveHeight = BigInt(rawEffective);
    } catch {
      return {
        ok: false,
        failureKind: 'missing_required_payload',
        error: `Invalid CoreSlot rotation effective_height: ${rawEffective}`,
      };
    }
  }

  return {
    ok: true,
    value: {
      slotId,
      operatorAddress: readEventAttr(event, 'operator_address') ?? null,
      oldConsensusAddress: oldConsensus.value,
      newConsensusAddress: newConsensus.value,
      power,
      effectiveHeight,
      reason: readEventAttr(event, 'reason') ?? null,
    },
  };
}

function eventMatchesMessage(event: EventSource, message: MessageSource, slotId: bigint): boolean {
  if (event.txHash !== message.txHash) return false;
  const eventMsgIndex = readEventAttr(event, 'msg_index');
  if (eventMsgIndex !== undefined && eventMsgIndex !== message.msgIndex.toString()) return false;
  const eventSlotId = readEventAttr(event, 'slot_id');
  if (eventSlotId !== undefined && eventSlotId !== slotId.toString()) return false;
  return true;
}

function isFailedTxBound(event: EventSource, successfulTxHashes: Set<string>): boolean {
  return event.txHash !== null && !successfulTxHashes.has(event.txHash);
}

function normalizeOptionalConsensusAddress(value: string | undefined): {
  ok: true;
  value: string | null;
} | {
  ok: false;
  error: string;
} {
  if (value === undefined || value.trim() === '') return { ok: true, value: null };
  const trimmed = value.trim();
  if (!/^[0-9a-fA-F]{40}$/.test(trimmed)) {
    return { ok: false, error: `CoreSlot consensus address must be 40-character hex: ${value}` };
  }
  return { ok: true, value: trimmed.toLowerCase() };
}

function parseSlotId(value: string | undefined): bigint | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function readMessageSlotId(message: MessageSource): string | undefined {
  const decoded = asRecord(message.decodedJson);
  return readString(decoded.slot_id) ?? readString(decoded.slotId);
}

function readMessageOperator(message: MessageSource): string | null {
  const decoded = asRecord(message.decodedJson);
  return readString(decoded.operator)
    ?? readString(decoded.operator_address)
    ?? readString(decoded.operatorAddress)
    ?? null;
}

function readEventAttr(event: EventSource, key: string): string | undefined {
  return readString(attributesToRecord(event.attributesJson)[key]);
}

async function createFailure(
  prisma: CoreSlotKeyRotationProjectionPrisma,
  args: {
    message?: MessageSource | undefined;
    event?: EventSource | undefined;
    failureKind: ProjectionFailureKind;
    error: string;
  },
): Promise<void> {
  const sourceHeight = args.message?.height ?? args.event?.height ?? 0n;
  const failure: ProjectionFailureInput = {
    projectionName: CORESLOT_KEY_ROTATION_PROJECTION,
    module: 'coreslot',
    sourceHeight,
    sourceTxHash: args.message?.txHash ?? args.event?.txHash ?? null,
    sourceMsgIndex: args.message?.msgIndex ?? args.event?.msgIndex ?? null,
    sourceMessageId: args.message?.id ?? null,
    sourceEventId: args.event?.id ?? null,
    typeUrl: args.message?.typeUrl ?? null,
    eventType: args.event?.type ?? null,
    failureKind: args.failureKind,
    rawMessageJson: args.message ? buildRawMessageJson(args.message) : null,
    rawEventJson: args.event ? buildRawEventJson(args.event) : null,
    error: args.error,
  };
  const data = withProjectionFailureKey(failure);

  await prisma.projectionFailure.upsert({
    where: { failureKey: data.failureKey },
    create: data,
    update: { ...data, resolved: false, resolvedAt: null },
  });
}

function buildRawMessageJson(message: MessageSource): unknown {
  return {
    id: message.id.toString(),
    txHash: message.txHash,
    height: message.height.toString(),
    msgIndex: message.msgIndex,
    typeUrl: message.typeUrl,
    module: message.module,
    decodedJson: message.decodedJson,
    rawJson: message.rawJson,
  };
}

function buildRawEventJson(event: EventSource): unknown {
  return {
    id: event.id.toString(),
    height: event.height.toString(),
    txHash: event.txHash,
    msgIndex: event.msgIndex,
    type: event.type,
    attributesJson: event.attributesJson,
  };
}

function attributesToRecord(attributesJson: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const attribute of readArray(attributesJson)) {
    const record = asRecord(attribute);
    const key = readString(record.key);
    if (!key) continue;
    result[key] = record.value;
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString();
  return undefined;
}
