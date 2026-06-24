import {
  haltProjectionCursorError,
  updateProjectionCursorSuccess,
  type ProjectionCursorPrisma,
} from './cursor.js';
import {
  CORESLOT_METADATA_EVENT_TYPE,
  CORESLOT_METADATA_PROJECTION,
  CORESLOT_METADATA_TYPE_URL,
  type ProjectionFailureInput,
  type ProjectionFailureKind,
} from './types.js';

export interface ProjectCoreSlotMetadataRangeArgs {
  prisma: CoreSlotMetadataProjectionPrisma;
  chainId: string;
  startHeight: bigint;
  endHeight: bigint;
}

export interface ProjectCoreSlotMetadataHeightArgs {
  prisma: CoreSlotMetadataProjectionPrisma;
  chainId: string;
  height: bigint;
}

export interface ProjectCoreSlotMetadataResult {
  height: bigint;
  changesCreated: number;
  failuresCreated: number;
}

export interface CoreSlotMetadataProjectionPrisma extends ProjectionCursorPrisma {
  explorerTransaction: {
    findMany(args: unknown): Promise<TransactionSource[]>;
  };
  message: {
    findMany(args: unknown): Promise<MessageSource[]>;
  };
  event: {
    findMany(args: unknown): Promise<EventSource[]>;
  };
  coreSlotMetadataChange: {
    upsert(args: unknown): Promise<unknown>;
  };
  coreSlotProjection: {
    upsert(args: unknown): Promise<unknown>;
  };
  projectionFailure: {
    create(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: CoreSlotMetadataProjectionPrisma) => Promise<T>): Promise<T>;
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

interface MetadataPayload {
  slotId: bigint;
  operatorAddress: string;
  metadataJson: unknown;
}

export async function projectCoreSlotMetadataRange(
  args: ProjectCoreSlotMetadataRangeArgs,
): Promise<ProjectCoreSlotMetadataResult[]> {
  const results: ProjectCoreSlotMetadataResult[] = [];
  for (let height = args.startHeight; height <= args.endHeight; height += 1n) {
    results.push(await projectCoreSlotMetadataHeight({
      prisma: args.prisma,
      chainId: args.chainId,
      height,
    }));
  }
  return results;
}

export async function projectCoreSlotMetadataHeight(
  args: ProjectCoreSlotMetadataHeightArgs,
): Promise<ProjectCoreSlotMetadataResult> {
  const { prisma, chainId, height } = args;

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.projectionFailure.deleteMany({
        where: {
          projectionName: CORESLOT_METADATA_PROJECTION,
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
          CORESLOT_METADATA_PROJECTION,
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
          typeUrl: CORESLOT_METADATA_TYPE_URL,
        },
        orderBy: [{ txHash: 'asc' }, { msgIndex: 'asc' }],
      });
      const events = await tx.event.findMany({
        where: {
          height,
          txHash: { in: txHashes },
          type: CORESLOT_METADATA_EVENT_TYPE,
        },
        orderBy: [{ txHash: 'asc' }, { id: 'asc' }],
      });

      const usedMessageIds = new Set<string>();
      const usedEventIds = new Set<string>();
      let changesCreated = 0;
      let failuresCreated = 0;

      for (const message of messages) {
        const payload = extractMetadataPayload(message.decodedJson);
        if (!payload.ok) {
          await createFailure(tx, {
            message,
            failureKind: payload.failureKind,
            error: payload.error,
          });
          failuresCreated += 1;
          continue;
        }

        const matchingEvents = events.filter((event) => metadataEventMatchesMessage(
          event,
          message,
          payload.value,
        ));

        if (matchingEvents.length === 0) {
          await createFailure(tx, {
            message,
            failureKind: 'missing_event',
            error: 'No coreslot_metadata_updated event matched the metadata message.',
          });
          failuresCreated += 1;
          continue;
        }

        if (matchingEvents.length > 1) {
          await createFailure(tx, {
            message,
            event: matchingEvents[0],
            failureKind: 'ambiguous_event',
            error: `${matchingEvents.length} coreslot_metadata_updated events matched the metadata message.`,
          });
          failuresCreated += 1;
          continue;
        }

        const event = matchingEvents[0];
        if (!event) continue;
        await upsertMetadataChange(tx, message, event, payload.value);
        usedMessageIds.add(message.id.toString());
        usedEventIds.add(event.id.toString());
        changesCreated += 1;
      }

      for (const event of events) {
        if (usedEventIds.has(event.id.toString())) continue;
        const matchingMessages = messages.filter((message) => {
          const payload = extractMetadataPayload(message.decodedJson);
          return payload.ok && metadataEventMatchesMessage(event, message, payload.value);
        });

        if (matchingMessages.length === 0) {
          await createFailure(tx, {
            event,
            failureKind: 'missing_message',
            error: 'coreslot_metadata_updated event had no matching metadata message payload.',
          });
          failuresCreated += 1;
          continue;
        }

        if (matchingMessages.length > 1) {
          await createFailure(tx, {
            message: matchingMessages[0],
            event,
            failureKind: 'ambiguous_message',
            error: `${matchingMessages.length} metadata messages matched one coreslot_metadata_updated event.`,
          });
          failuresCreated += 1;
        }
      }

      await updateProjectionCursorSuccess(
        tx,
        CORESLOT_METADATA_PROJECTION,
        chainId,
        height,
      );

      return { height, changesCreated, failuresCreated };
    });
  } catch (error) {
    await haltProjectionCursorError(
      prisma,
      CORESLOT_METADATA_PROJECTION,
      chainId,
      height,
      error,
    );
    throw error;
  }
}

function extractMetadataPayload(decodedJson: unknown): {
  ok: true;
  value: MetadataPayload;
} | {
  ok: false;
  failureKind: ProjectionFailureKind;
  error: string;
} {
  const decoded = asRecord(decodedJson);
  const slotIdValue = readString(decoded.slot_id) ?? readString(decoded.slotId);
  const operatorAddress = readString(decoded.operator) ?? readString(decoded.operator_address);
  const metadataJson = decoded.metadata;

  if (!slotIdValue || !operatorAddress || metadataJson === undefined || metadataJson === null) {
    return {
      ok: false,
      failureKind: 'missing_required_payload',
      error: 'MsgUpdateOperatorMetadata requires slot_id, operator, and metadata.',
    };
  }

  try {
    return {
      ok: true,
      value: {
        slotId: BigInt(slotIdValue),
        operatorAddress,
        metadataJson,
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

function metadataEventMatchesMessage(
  event: EventSource,
  message: MessageSource,
  payload: MetadataPayload,
): boolean {
  if (event.txHash !== message.txHash) return false;
  const attributes = attributesToRecord(event.attributesJson);
  const eventMsgIndex = readString(attributes.msg_index);
  if (eventMsgIndex !== undefined && eventMsgIndex !== message.msgIndex.toString()) return false;
  if (readString(attributes.slot_id) !== payload.slotId.toString()) return false;
  if (readString(attributes.operator_address) !== payload.operatorAddress) return false;
  return true;
}

async function upsertMetadataChange(
  prisma: CoreSlotMetadataProjectionPrisma,
  message: MessageSource,
  event: EventSource,
  payload: MetadataPayload,
): Promise<void> {
  const rawMessageJson = buildRawMessageJson(message);
  const rawEventJson = buildRawEventJson(event);

  await prisma.coreSlotMetadataChange.upsert({
    where: { sourceMessageId: message.id },
    create: {
      slotId: payload.slotId,
      operatorAddress: payload.operatorAddress,
      height: message.height,
      txHash: message.txHash,
      msgIndex: message.msgIndex,
      metadataJson: payload.metadataJson,
      sourceMessageId: message.id,
      sourceEventId: event.id,
      rawMessageJson,
      rawEventJson,
    },
    update: {
      operatorAddress: payload.operatorAddress,
      metadataJson: payload.metadataJson,
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
      metadataJson: payload.metadataJson,
      updatedHeight: message.height,
      lastSourceHeight: message.height,
      lastSourceTxHash: message.txHash,
      lastSourceMsgIndex: message.msgIndex,
      lastSourceMessageId: message.id,
      lastSourceEventId: event.id,
    },
    update: {
      operatorAddress: payload.operatorAddress,
      metadataJson: payload.metadataJson,
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
  prisma: CoreSlotMetadataProjectionPrisma,
  args: {
    message?: MessageSource | undefined;
    event?: EventSource | undefined;
    failureKind: ProjectionFailureKind;
    error: string;
  },
): Promise<void> {
  const sourceHeight = args.message?.height ?? args.event?.height ?? 0n;
  const failure: ProjectionFailureInput = {
    projectionName: CORESLOT_METADATA_PROJECTION,
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
