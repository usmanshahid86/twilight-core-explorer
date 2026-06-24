import {
  haltProjectionCursorError,
  updateProjectionCursorSuccess,
  type ProjectionCursorPrisma,
} from './cursor.js';
import {
  CORESLOT_LIFECYCLE_EVENT_TYPES,
  CORESLOT_LIFECYCLE_MESSAGE_TO_EVENT,
  CORESLOT_LIFECYCLE_PROJECTION,
  type CoreSlotLifecycleEventType,
  type CoreSlotLifecycleMessageTypeUrl,
  type ProjectionFailureInput,
  type ProjectionFailureKind,
} from './types.js';

export interface ProjectCoreSlotLifecycleRangeArgs {
  prisma: CoreSlotLifecycleProjectionPrisma;
  chainId: string;
  startHeight: bigint;
  endHeight: bigint;
}

export interface ProjectCoreSlotLifecycleHeightArgs {
  prisma: CoreSlotLifecycleProjectionPrisma;
  chainId: string;
  height: bigint;
}

export interface ProjectCoreSlotLifecycleResult {
  height: bigint;
  lifecycleEventsCreated: number;
  failuresCreated: number;
}

export interface CoreSlotLifecycleProjectionPrisma extends ProjectionCursorPrisma {
  explorerTransaction: {
    findMany(args: unknown): Promise<TransactionSource[]>;
  };
  message: {
    findMany(args: unknown): Promise<MessageSource[]>;
  };
  event: {
    findMany(args: unknown): Promise<EventSource[]>;
  };
  coreSlotLifecycleEvent: {
    upsert(args: unknown): Promise<unknown>;
  };
  coreSlotProjection: {
    upsert(args: unknown): Promise<unknown>;
  };
  projectionFailure: {
    create(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: CoreSlotLifecycleProjectionPrisma) => Promise<T>): Promise<T>;
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

interface LifecycleMessagePayload {
  slotId: bigint | null;
  operatorAddress: string | null;
  authority: string | null;
  reason: string | null;
  evidenceReference: string | null;
  metadataJson: unknown | null;
  payoutAddress: string | null;
  consensusPubkeyJson: unknown | null;
}

interface LifecycleEventPayload {
  slotId: bigint;
  operatorAddress: string | null;
  consensusAddress: string | null;
  oldStatus: string | null;
  newStatus: string | null;
  power: bigint | null;
  reason: string | null;
}

export async function projectCoreSlotLifecycleRange(
  args: ProjectCoreSlotLifecycleRangeArgs,
): Promise<ProjectCoreSlotLifecycleResult[]> {
  const results: ProjectCoreSlotLifecycleResult[] = [];
  for (let height = args.startHeight; height <= args.endHeight; height += 1n) {
    results.push(await projectCoreSlotLifecycleHeight({
      prisma: args.prisma,
      chainId: args.chainId,
      height,
    }));
  }
  return results;
}

export async function projectCoreSlotLifecycleHeight(
  args: ProjectCoreSlotLifecycleHeightArgs,
): Promise<ProjectCoreSlotLifecycleResult> {
  const { prisma, chainId, height } = args;

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.projectionFailure.deleteMany({
        where: {
          projectionName: CORESLOT_LIFECYCLE_PROJECTION,
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
      const txHashes = transactions.map((transaction) => transaction.hash);

      if (txHashes.length === 0) {
        await updateProjectionCursorSuccess(
          tx,
          CORESLOT_LIFECYCLE_PROJECTION,
          chainId,
          height,
        );
        return { height, lifecycleEventsCreated: 0, failuresCreated: 0 };
      }

      const messages = await tx.message.findMany({
        where: {
          height,
          txHash: { in: txHashes },
          module: 'coreslot',
          typeUrl: { in: Object.keys(CORESLOT_LIFECYCLE_MESSAGE_TO_EVENT) },
        },
        orderBy: [{ txHash: 'asc' }, { msgIndex: 'asc' }],
      });
      const events = await tx.event.findMany({
        where: {
          height,
          txHash: { in: txHashes },
          type: { in: CORESLOT_LIFECYCLE_EVENT_TYPES },
        },
        orderBy: [{ txHash: 'asc' }, { id: 'asc' }],
      });

      const usedEventIds = new Set<string>();
      const ambiguousEventIds = new Set<string>();
      let lifecycleEventsCreated = 0;
      let failuresCreated = 0;

      for (const message of messages) {
        const expectedEventType = expectedLifecycleEventType(message.typeUrl);
        if (!expectedEventType) continue;

        const messagePayload = extractLifecycleMessagePayload(message);
        if (!messagePayload.ok) {
          await createFailure(tx, {
            message,
            failureKind: messagePayload.failureKind,
            error: messagePayload.error,
          });
          failuresCreated += 1;
          continue;
        }

        const matchingEvents = events.filter((event) => lifecycleEventMatchesMessage(
          event,
          message,
          expectedEventType,
          messagePayload.value,
        ));

        if (matchingEvents.length === 0) {
          await createFailure(tx, {
            message,
            failureKind: 'missing_event',
            error: `No ${expectedEventType} event matched ${message.typeUrl}.`,
          });
          failuresCreated += 1;
          continue;
        }

        if (matchingEvents.length > 1) {
          await createFailure(tx, {
            message,
            event: matchingEvents[0],
            failureKind: 'ambiguous_event',
            error: `${matchingEvents.length} ${expectedEventType} events matched ${message.typeUrl}.`,
          });
          failuresCreated += 1;
          continue;
        }

        const event = matchingEvents[0];
        if (!event) continue;
        const matchingMessages = messages.filter((candidate) => {
          if (candidate.id === message.id) return true;
          const expected = expectedLifecycleEventType(candidate.typeUrl);
          if (expected !== event.type) return false;
          const payload = extractLifecycleMessagePayload(candidate);
          return payload.ok && lifecycleEventMatchesMessage(event, candidate, expected, payload.value);
        });

        if (matchingMessages.length > 1) {
          if (!ambiguousEventIds.has(event.id.toString())) {
            ambiguousEventIds.add(event.id.toString());
            await createFailure(tx, {
              message,
              event,
              failureKind: 'ambiguous_message',
              error: `${matchingMessages.length} lifecycle messages matched one ${event.type} event.`,
            });
            failuresCreated += 1;
          }
          continue;
        }

        const eventPayload = extractLifecycleEventPayload(event);
        if (!eventPayload.ok) {
          await createFailure(tx, {
            message,
            event,
            failureKind: eventPayload.failureKind,
            error: eventPayload.error,
          });
          failuresCreated += 1;
          continue;
        }

        await upsertLifecycleEvent(tx, event, message, eventPayload.value, messagePayload.value);
        usedEventIds.add(event.id.toString());
        lifecycleEventsCreated += 1;
      }

      for (const event of events) {
        if (usedEventIds.has(event.id.toString())) continue;
        if (ambiguousEventIds.has(event.id.toString())) continue;

        const matchingMessages = messages.filter((message) => {
          const expected = expectedLifecycleEventType(message.typeUrl);
          if (expected !== event.type) return false;
          const payload = extractLifecycleMessagePayload(message);
          return payload.ok && lifecycleEventMatchesMessage(event, message, expected, payload.value);
        });

        if (matchingMessages.length > 1) {
          await createFailure(tx, {
            message: matchingMessages[0],
            event,
            failureKind: 'ambiguous_message',
            error: `${matchingMessages.length} lifecycle messages matched one ${event.type} event.`,
          });
          failuresCreated += 1;
          continue;
        }

        if (matchingMessages.length === 1) continue;

        const eventPayload = extractLifecycleEventPayload(event);
        if (!eventPayload.ok) {
          await createFailure(tx, {
            event,
            failureKind: eventPayload.failureKind,
            error: eventPayload.error,
          });
          failuresCreated += 1;
          continue;
        }

        await upsertLifecycleEvent(tx, event, null, eventPayload.value, null);
        await createFailure(tx, {
          event,
          failureKind: 'missing_message',
          error: `${event.type} event had no matching lifecycle message payload.`,
        });
        lifecycleEventsCreated += 1;
        failuresCreated += 1;
      }

      await updateProjectionCursorSuccess(
        tx,
        CORESLOT_LIFECYCLE_PROJECTION,
        chainId,
        height,
      );

      return { height, lifecycleEventsCreated, failuresCreated };
    });
  } catch (error) {
    await haltProjectionCursorError(
      prisma,
      CORESLOT_LIFECYCLE_PROJECTION,
      chainId,
      height,
      error,
    );
    throw error;
  }
}

function expectedLifecycleEventType(typeUrl: string): CoreSlotLifecycleEventType | undefined {
  return CORESLOT_LIFECYCLE_MESSAGE_TO_EVENT[typeUrl as CoreSlotLifecycleMessageTypeUrl];
}

function extractLifecycleMessagePayload(message: MessageSource): {
  ok: true;
  value: LifecycleMessagePayload;
} | {
  ok: false;
  failureKind: ProjectionFailureKind;
  error: string;
} {
  const decoded = asRecord(message.decodedJson);
  const rawSlotId = readString(decoded.slot_id) ?? readString(decoded.slotId);
  let slotId: bigint | null = null;
  if (rawSlotId !== undefined) {
    try {
      slotId = BigInt(rawSlotId);
    } catch {
      return {
        ok: false,
        failureKind: 'invalid_slot_id',
        error: `Invalid CoreSlot slot_id: ${rawSlotId}`,
      };
    }
  }

  return {
    ok: true,
    value: {
      slotId,
      operatorAddress: readString(decoded.operator_address)
        ?? readString(decoded.operatorAddress)
        ?? readString(decoded.operator)
        ?? null,
      authority: readString(decoded.authority)
        ?? readString(decoded.authority_or_operator)
        ?? readString(decoded.authorityOrOperator)
        ?? null,
      reason: readString(decoded.reason) ?? null,
      evidenceReference: readString(decoded.evidence_reference)
        ?? readString(decoded.evidenceReference)
        ?? null,
      metadataJson: decoded.metadata ?? null,
      payoutAddress: readString(decoded.payout_address)
        ?? readString(decoded.payoutAddress)
        ?? null,
      consensusPubkeyJson: decoded.consensus_pubkey
        ?? decoded.consensusPubkey
        ?? null,
    },
  };
}

function extractLifecycleEventPayload(event: EventSource): {
  ok: true;
  value: LifecycleEventPayload;
} | {
  ok: false;
  failureKind: ProjectionFailureKind;
  error: string;
} {
  const attributes = attributesToRecord(event.attributesJson);
  const rawSlotId = readString(attributes.slot_id);
  if (!rawSlotId) {
    return {
      ok: false,
      failureKind: 'missing_required_payload',
      error: `${event.type} event is missing slot_id.`,
    };
  }

  let slotId: bigint;
  try {
    slotId = BigInt(rawSlotId);
  } catch {
    return {
      ok: false,
      failureKind: 'invalid_slot_id',
      error: `Invalid CoreSlot event slot_id: ${rawSlotId}`,
    };
  }

  const rawConsensusAddress = readString(attributes.consensus_address);
  const consensusAddress = rawConsensusAddress
    ? normalizeConsensusAddress(rawConsensusAddress)
    : { ok: true as const, value: null };
  if (!consensusAddress.ok) {
    return {
      ok: false,
      failureKind: 'invalid_consensus_address',
      error: consensusAddress.error,
    };
  }

  const rawPower = readString(attributes.power);
  let power: bigint | null = null;
  if (rawPower !== undefined) {
    try {
      power = BigInt(rawPower);
    } catch {
      return {
        ok: false,
        failureKind: 'missing_required_payload',
        error: `Invalid CoreSlot event power: ${rawPower}`,
      };
    }
  }

  return {
    ok: true,
    value: {
      slotId,
      operatorAddress: readString(attributes.operator_address) ?? null,
      consensusAddress: consensusAddress.value,
      oldStatus: readString(attributes.old_status) ?? null,
      newStatus: readString(attributes.new_status) ?? statusFromEventType(event.type),
      power,
      reason: readString(attributes.reason) ?? null,
    },
  };
}

function lifecycleEventMatchesMessage(
  event: EventSource,
  message: MessageSource,
  expectedEventType: string,
  payload: LifecycleMessagePayload,
): boolean {
  if (event.type !== expectedEventType) return false;
  if (event.txHash !== message.txHash) return false;
  const attributes = attributesToRecord(event.attributesJson);
  const eventMsgIndex = readString(attributes.msg_index);
  if (eventMsgIndex !== undefined && eventMsgIndex !== message.msgIndex.toString()) return false;
  const eventSlotId = readString(attributes.slot_id);
  if (payload.slotId !== null && eventSlotId !== payload.slotId.toString()) return false;
  const eventOperator = readString(attributes.operator_address);
  if (
    payload.operatorAddress
    && eventOperator
    && eventOperator !== payload.operatorAddress
  ) {
    return false;
  }
  return true;
}

async function upsertLifecycleEvent(
  prisma: CoreSlotLifecycleProjectionPrisma,
  event: EventSource,
  message: MessageSource | null,
  eventPayload: LifecycleEventPayload,
  messagePayload: LifecycleMessagePayload | null,
): Promise<void> {
  const rawEventJson = buildRawEventJson(event);
  const rawMessageJson = message ? buildRawMessageJson(message) : null;
  const reason = eventPayload.reason ?? messagePayload?.reason ?? null;

  await prisma.coreSlotLifecycleEvent.upsert({
    where: { sourceEventId: event.id },
    create: {
      sourceEventId: event.id,
      sourceMessageId: message?.id ?? null,
      height: event.height,
      txHash: event.txHash,
      msgIndex: message?.msgIndex ?? event.msgIndex ?? null,
      slotId: eventPayload.slotId,
      eventType: event.type,
      oldStatus: eventPayload.oldStatus,
      newStatus: eventPayload.newStatus,
      operatorAddress: eventPayload.operatorAddress ?? messagePayload?.operatorAddress ?? null,
      consensusAddress: eventPayload.consensusAddress,
      power: eventPayload.power,
      reason,
      evidenceReference: messagePayload?.evidenceReference ?? null,
      authority: messagePayload?.authority ?? null,
      rawEventJson,
      rawMessageJson,
    },
    update: {
      sourceMessageId: message?.id ?? null,
      msgIndex: message?.msgIndex ?? event.msgIndex ?? null,
      slotId: eventPayload.slotId,
      oldStatus: eventPayload.oldStatus,
      newStatus: eventPayload.newStatus,
      operatorAddress: eventPayload.operatorAddress ?? messagePayload?.operatorAddress ?? null,
      consensusAddress: eventPayload.consensusAddress,
      power: eventPayload.power,
      reason,
      evidenceReference: messagePayload?.evidenceReference ?? null,
      authority: messagePayload?.authority ?? null,
      rawEventJson,
      rawMessageJson,
    },
  });

  await upsertCoreSlotProjection(prisma, event, message, eventPayload, messagePayload);
}

async function upsertCoreSlotProjection(
  prisma: CoreSlotLifecycleProjectionPrisma,
  event: EventSource,
  message: MessageSource | null,
  eventPayload: LifecycleEventPayload,
  messagePayload: LifecycleMessagePayload | null,
): Promise<void> {
  const status = eventPayload.newStatus ?? statusFromEventType(event.type);
  const lifecycleFields = {
    status,
    operatorAddress: eventPayload.operatorAddress ?? messagePayload?.operatorAddress ?? undefined,
    consensusAddress: eventPayload.consensusAddress ?? undefined,
    consensusPower: eventPayload.power ?? undefined,
    updatedHeight: event.height,
    removedHeight: event.type === 'coreslot_removed' ? event.height : undefined,
    lastSourceHeight: event.height,
    lastSourceTxHash: event.txHash,
    lastSourceMsgIndex: message?.msgIndex ?? event.msgIndex ?? null,
    lastSourceMessageId: message?.id ?? null,
    lastSourceEventId: event.id,
  };

  const createFields = {
    slotId: eventPayload.slotId,
    createdHeight: event.type === 'coreslot_registered' ? event.height : null,
    payoutAddress: event.type === 'coreslot_registered'
      ? messagePayload?.payoutAddress ?? null
      : null,
    metadataJson: event.type === 'coreslot_registered'
      ? messagePayload?.metadataJson ?? null
      : null,
    consensusPubkeyJson: event.type === 'coreslot_registered'
      ? messagePayload?.consensusPubkeyJson ?? null
      : null,
    ...lifecycleFields,
  };
  const updateFields = {
    ...lifecycleFields,
    ...(event.type === 'coreslot_registered'
      ? {
          createdHeight: event.height,
          ...(messagePayload?.payoutAddress ? { payoutAddress: messagePayload.payoutAddress } : {}),
          ...(messagePayload?.metadataJson ? { metadataJson: messagePayload.metadataJson } : {}),
          ...(messagePayload?.consensusPubkeyJson
            ? { consensusPubkeyJson: messagePayload.consensusPubkeyJson }
            : {}),
        }
      : {}),
  };

  await prisma.coreSlotProjection.upsert({
    where: { slotId: eventPayload.slotId },
    create: createFields,
    update: updateFields,
  });
}

async function createFailure(
  prisma: CoreSlotLifecycleProjectionPrisma,
  args: {
    message?: MessageSource | undefined;
    event?: EventSource | undefined;
    failureKind: ProjectionFailureKind;
    error: string;
  },
): Promise<void> {
  const sourceHeight = args.message?.height ?? args.event?.height ?? 0n;
  const failure: ProjectionFailureInput = {
    projectionName: CORESLOT_LIFECYCLE_PROJECTION,
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

  await prisma.projectionFailure.create({ data: failure });
}

function statusFromEventType(eventType: string): string | null {
  switch (eventType) {
    case 'coreslot_registered':
      return 'PENDING';
    case 'coreslot_activated':
      return 'ACTIVE';
    case 'coreslot_inactivated':
      return 'INACTIVE';
    case 'coreslot_suspended':
      return 'SUSPENDED';
    case 'coreslot_removed':
      return 'REMOVED';
    default:
      return null;
  }
}

function normalizeConsensusAddress(value: string): {
  ok: true;
  value: string;
} | {
  ok: false;
  error: string;
} {
  const trimmed = value.trim();
  if (!/^[0-9a-fA-F]{40}$/.test(trimmed)) {
    return {
      ok: false,
      error: `CoreSlot consensus_address must be 40-character hex: ${value}`,
    };
  }
  return { ok: true, value: trimmed.toLowerCase() };
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
