import {
  haltProjectionCursorError,
  updateProjectionCursorSuccess,
  type ProjectionCursorPrisma,
} from './cursor.js';
import {
  CORESLOT_PAYOUT_EVENT_TYPE,
  CORESLOT_PAYOUT_PROJECTION,
  CORESLOT_PAYOUT_TYPE_URL,
  type ProjectionFailureInput,
  type ProjectionFailureKind,
  withProjectionFailureKey,
} from './types.js';

export interface ProjectCoreSlotPayoutRangeArgs {
  prisma: CoreSlotPayoutProjectionPrisma;
  chainId: string;
  startHeight: bigint;
  endHeight: bigint;
}

export interface ProjectCoreSlotPayoutHeightArgs {
  prisma: CoreSlotPayoutProjectionPrisma;
  chainId: string;
  height: bigint;
}

export interface ProjectCoreSlotPayoutResult {
  height: bigint;
  changesCreated: number;
  failuresCreated: number;
}

export interface CoreSlotPayoutProjectionPrisma extends ProjectionCursorPrisma {
  explorerTransaction: {
    findMany(args: unknown): Promise<TransactionSource[]>;
  };
  message: {
    findMany(args: unknown): Promise<MessageSource[]>;
  };
  event: {
    findMany(args: unknown): Promise<EventSource[]>;
  };
  coreSlotPayoutChange: {
    upsert(args: unknown): Promise<unknown>;
  };
  coreSlotProjection: {
    upsert(args: unknown): Promise<unknown>;
  };
  projectionFailure: {
    upsert(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: CoreSlotPayoutProjectionPrisma) => Promise<T>): Promise<T>;
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

interface PayoutPayload {
  slotId: bigint;
  operatorAddress: string;
  newPayoutAddress: string;
}

export async function projectCoreSlotPayoutRange(
  args: ProjectCoreSlotPayoutRangeArgs,
): Promise<ProjectCoreSlotPayoutResult[]> {
  const results: ProjectCoreSlotPayoutResult[] = [];
  for (let height = args.startHeight; height <= args.endHeight; height += 1n) {
    results.push(await projectCoreSlotPayoutHeight({
      prisma: args.prisma,
      chainId: args.chainId,
      height,
    }));
  }
  return results;
}

export async function projectCoreSlotPayoutHeight(
  args: ProjectCoreSlotPayoutHeightArgs,
): Promise<ProjectCoreSlotPayoutResult> {
  const { prisma, chainId, height } = args;

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.projectionFailure.deleteMany({
        where: {
          projectionName: CORESLOT_PAYOUT_PROJECTION,
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
          CORESLOT_PAYOUT_PROJECTION,
          chainId,
          height,
        );
        return { height, changesCreated: 0, failuresCreated: 0 };
      }

      const messages = await tx.message.findMany({
        where: {
          height,
          txHash: { in: txHashes },
          module: 'coreslot',
          typeUrl: CORESLOT_PAYOUT_TYPE_URL,
        },
        orderBy: [{ txHash: 'asc' }, { msgIndex: 'asc' }],
      });
      const events = await tx.event.findMany({
        where: {
          height,
          txHash: { in: txHashes },
          type: CORESLOT_PAYOUT_EVENT_TYPE,
        },
        orderBy: [{ txHash: 'asc' }, { id: 'asc' }],
      });

      const usedEventIds = new Set<string>();
      const ambiguousEventIds = new Set<string>();
      let changesCreated = 0;
      let failuresCreated = 0;

      for (const message of messages) {
        const payload = extractPayoutPayload(message.decodedJson);
        if (!payload.ok) {
          await createFailure(tx, {
            message,
            failureKind: payload.failureKind,
            error: payload.error,
          });
          failuresCreated += 1;
          continue;
        }

        const matchingEvents = events.filter((event) => payoutEventMatchesMessage(
          event,
          message,
          payload.value,
        ));

        if (matchingEvents.length === 0) {
          await createFailure(tx, {
            message,
            failureKind: 'missing_event',
            error: 'No coreslot_payout_updated event matched the payout message.',
          });
          failuresCreated += 1;
          continue;
        }

        if (matchingEvents.length > 1) {
          await createFailure(tx, {
            message,
            event: matchingEvents[0],
            failureKind: 'ambiguous_event',
            error: `${matchingEvents.length} coreslot_payout_updated events matched the payout message.`,
          });
          failuresCreated += 1;
          for (const event of matchingEvents) ambiguousEventIds.add(event.id.toString());
          continue;
        }

        const event = matchingEvents[0];
        if (!event) continue;
        const matchingMessages = messages.filter((candidate) => {
          if (candidate.id === message.id) return true;
          const candidatePayload = extractPayoutPayload(candidate.decodedJson);
          return candidatePayload.ok
            && payoutEventMatchesMessage(event, candidate, candidatePayload.value);
        });

        if (matchingMessages.length > 1) {
          if (!ambiguousEventIds.has(event.id.toString())) {
            ambiguousEventIds.add(event.id.toString());
            await createFailure(tx, {
              message,
              event,
              failureKind: 'ambiguous_message',
              error: `${matchingMessages.length} payout messages matched one coreslot_payout_updated event.`,
            });
            failuresCreated += 1;
          }
          continue;
        }

        await upsertPayoutChange(tx, message, event, payload.value);
        usedEventIds.add(event.id.toString());
        changesCreated += 1;
      }

      for (const event of events) {
        if (usedEventIds.has(event.id.toString())) continue;
        if (ambiguousEventIds.has(event.id.toString())) continue;
        const matchingMessages = messages.filter((message) => {
          const payload = extractPayoutPayload(message.decodedJson);
          return payload.ok && payoutEventMatchesMessage(event, message, payload.value);
        });

        if (matchingMessages.length === 0) {
          await createFailure(tx, {
            event,
            failureKind: 'missing_message',
            error: 'coreslot_payout_updated event had no matching payout message payload.',
          });
          failuresCreated += 1;
          continue;
        }

        if (matchingMessages.length > 1) {
          await createFailure(tx, {
            message: matchingMessages[0],
            event,
            failureKind: 'ambiguous_message',
            error: `${matchingMessages.length} payout messages matched one coreslot_payout_updated event.`,
          });
          failuresCreated += 1;
        }
      }

      await updateProjectionCursorSuccess(
        tx,
        CORESLOT_PAYOUT_PROJECTION,
        chainId,
        height,
      );

      return { height, changesCreated, failuresCreated };
    });
  } catch (error) {
    await haltProjectionCursorError(
      prisma,
      CORESLOT_PAYOUT_PROJECTION,
      chainId,
      height,
      error,
    );
    throw error;
  }
}

function extractPayoutPayload(decodedJson: unknown): {
  ok: true;
  value: PayoutPayload;
} | {
  ok: false;
  failureKind: ProjectionFailureKind;
  error: string;
} {
  const decoded = asRecord(decodedJson);
  const slotIdValue = readString(decoded.slot_id) ?? readString(decoded.slotId);
  const operatorAddress = readString(decoded.operator) ?? readString(decoded.operator_address);
  const newPayoutAddress = readString(decoded.new_payout_address)
    ?? readString(decoded.newPayoutAddress);

  if (!slotIdValue || !operatorAddress || !newPayoutAddress) {
    return {
      ok: false,
      failureKind: 'missing_required_payload',
      error: 'MsgUpdatePayoutAddress requires slot_id, operator, and new_payout_address.',
    };
  }

  if (!newPayoutAddress.startsWith('twilight1')) {
    return {
      ok: false,
      failureKind: 'invalid_payout_address',
      error: `Invalid CoreSlot payout address: ${newPayoutAddress}`,
    };
  }

  try {
    return {
      ok: true,
      value: {
        slotId: BigInt(slotIdValue),
        operatorAddress,
        newPayoutAddress,
      },
    };
  } catch {
    return {
      ok: false,
      failureKind: 'invalid_slot_id',
      error: `Invalid CoreSlot slot_id: ${slotIdValue}`,
    };
  }
}

function payoutEventMatchesMessage(
  event: EventSource,
  message: MessageSource,
  payload: PayoutPayload,
): boolean {
  if (event.txHash !== message.txHash) return false;
  const attributes = attributesToRecord(event.attributesJson);
  const eventMsgIndex = readString(attributes.msg_index);
  if (eventMsgIndex !== undefined && eventMsgIndex !== message.msgIndex.toString()) return false;
  if (readString(attributes.slot_id) !== payload.slotId.toString()) return false;
  const eventOperator = readString(attributes.operator_address);
  if (eventOperator && eventOperator !== payload.operatorAddress) return false;
  return true;
}

async function upsertPayoutChange(
  prisma: CoreSlotPayoutProjectionPrisma,
  message: MessageSource,
  event: EventSource,
  payload: PayoutPayload,
): Promise<void> {
  const rawMessageJson = buildRawMessageJson(message);
  const rawEventJson = buildRawEventJson(event);

  await prisma.coreSlotPayoutChange.upsert({
    where: { sourceMessageId: message.id },
    create: {
      slotId: payload.slotId,
      operatorAddress: payload.operatorAddress,
      newPayoutAddress: payload.newPayoutAddress,
      height: message.height,
      txHash: message.txHash,
      msgIndex: message.msgIndex,
      sourceMessageId: message.id,
      sourceEventId: event.id,
      rawMessageJson,
      rawEventJson,
    },
    update: {
      operatorAddress: payload.operatorAddress,
      newPayoutAddress: payload.newPayoutAddress,
      sourceEventId: event.id,
      rawMessageJson,
      rawEventJson,
    },
  });

  await prisma.coreSlotProjection.upsert({
    where: { slotId: payload.slotId },
    create: {
      slotId: payload.slotId,
      operatorAddress: payload.operatorAddress,
      payoutAddress: payload.newPayoutAddress,
      updatedHeight: message.height,
      lastSourceHeight: message.height,
      lastSourceTxHash: message.txHash,
      lastSourceMsgIndex: message.msgIndex,
      lastSourceMessageId: message.id,
      lastSourceEventId: event.id,
    },
    update: {
      operatorAddress: payload.operatorAddress,
      payoutAddress: payload.newPayoutAddress,
      updatedHeight: message.height,
      lastSourceHeight: message.height,
      lastSourceTxHash: message.txHash,
      lastSourceMsgIndex: message.msgIndex,
      lastSourceMessageId: message.id,
      lastSourceEventId: event.id,
    },
  });
}

async function createFailure(
  prisma: CoreSlotPayoutProjectionPrisma,
  args: {
    message?: MessageSource | undefined;
    event?: EventSource | undefined;
    failureKind: ProjectionFailureKind;
    error: string;
  },
): Promise<void> {
  const sourceHeight = args.message?.height ?? args.event?.height ?? 0n;
  const failure: ProjectionFailureInput = {
    projectionName: CORESLOT_PAYOUT_PROJECTION,
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
    update: {
      ...data,
      resolved: false,
      resolvedAt: null,
    },
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
