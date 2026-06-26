import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import { HeightString, Nullable, PageInfoSchema } from './common.js';
import { bigToString, toIso } from '../lib/serialize.js';

const MessageDto = Type.Object(
  {
    msgIndex: Type.Integer(),
    typeUrl: Type.String(),
    module: Nullable(Type.String()),
    typeName: Nullable(Type.String()),
    decodedJson: Nullable(Type.Unknown()),
    decodeError: Nullable(Type.String()),
    raw: Type.Optional(Type.Unknown()),
  },
  { $id: 'Message' },
);

const EventDto = Type.Object(
  {
    phase: Type.String(),
    type: Type.String(),
    msgIndex: Nullable(Type.Integer()),
    eventIndex: Type.Integer(),
    attributes: Type.Unknown(),
  },
  { $id: 'Event' },
);

export const TxListItem = Type.Object(
  {
    hash: Type.String(),
    height: HeightString,
    index: Type.Integer(),
    status: Type.String(),
    code: Nullable(Type.Integer()),
    gasUsed: Nullable(HeightString),
    gasWanted: Nullable(HeightString),
    memo: Nullable(Type.String()),
    messageTypes: Type.Array(Type.String()),
    signerAddresses: Type.Array(Type.String()),
  },
  { $id: 'TxListItem' },
);

export const TxDetail = Type.Object(
  {
    hash: Type.String(),
    height: HeightString,
    index: Type.Integer(),
    status: Type.String(),
    code: Nullable(Type.Integer()),
    gasUsed: Nullable(HeightString),
    gasWanted: Nullable(HeightString),
    memo: Nullable(Type.String()),
    messageTypes: Type.Array(Type.String()),
    signerAddresses: Type.Array(Type.String()),
    time: Nullable(Type.String()),
    fee: Nullable(Type.Unknown()),
    messages: Type.Array(MessageDto),
    events: Type.Array(EventDto),
    raw: Type.Optional(Type.Object({ tx: Type.Unknown(), result: Type.Unknown() })),
  },
  { $id: 'TxDetail' },
);

export const TxListResponse = Type.Object(
  { data: Type.Array(TxListItem), page: PageInfoSchema },
  { $id: 'TxListResponse' },
);
export const TxDetailResponse = Type.Object({ data: TxDetail }, { $id: 'TxDetailResponse' });

export const TxsQuery = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
    cursor: Type.Optional(Type.String()),
    height: Type.Optional(Type.String({ pattern: '^\\d+$' })),
    status: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export const TxParams = Type.Object({ hash: Type.String() });
export const TxDetailQuery = Type.Object(
  { include: Type.Optional(Type.Literal('raw')) },
  { additionalProperties: false },
);

// ----- row shapes + mappers -----

export interface TxRow {
  hash: string;
  height: bigint;
  index: number;
  status: string;
  code: number | null;
  gasUsed: bigint | null;
  gasWanted: bigint | null;
  memo: string | null;
  feeJson: unknown;
  signerAddressesJson: unknown;
  messageTypesJson: unknown;
  rawTx: unknown;
  rawResultJson: unknown;
}

export interface MessageRow {
  msgIndex: number;
  typeUrl: string;
  module: string | null;
  typeName: string | null;
  decodedJson: unknown;
  rawJson: unknown;
  decodeError: string | null;
}

export interface EventRow {
  phase: string;
  type: string;
  msgIndex: number | null;
  eventIndex: number;
  attributesJson: unknown;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

export function toTxListItem(row: TxRow): Static<typeof TxListItem> {
  return {
    hash: row.hash,
    height: row.height.toString(),
    index: row.index,
    status: row.status,
    code: row.code,
    gasUsed: bigToString(row.gasUsed),
    gasWanted: bigToString(row.gasWanted),
    memo: row.memo,
    messageTypes: toStringArray(row.messageTypesJson),
    signerAddresses: toStringArray(row.signerAddressesJson),
  };
}

export function toTxDetail(
  row: TxRow,
  messages: MessageRow[],
  events: EventRow[],
  time: Date | null,
  includeRaw: boolean,
): Static<typeof TxDetail> {
  const detail: Static<typeof TxDetail> = {
    hash: row.hash,
    height: row.height.toString(),
    index: row.index,
    status: row.status,
    code: row.code,
    gasUsed: bigToString(row.gasUsed),
    gasWanted: bigToString(row.gasWanted),
    memo: row.memo,
    messageTypes: toStringArray(row.messageTypesJson),
    signerAddresses: toStringArray(row.signerAddressesJson),
    time: toIso(time),
    fee: row.feeJson ?? null,
    messages: messages.map((m) => toMessageDto(m, includeRaw)),
    events: events.map(toEventDto),
  };
  if (includeRaw) {
    detail.raw = { tx: row.rawTx ?? null, result: row.rawResultJson ?? null };
  }
  return detail;
}

function toMessageDto(row: MessageRow, includeRaw: boolean): Static<typeof MessageDto> {
  const dto: Static<typeof MessageDto> = {
    msgIndex: row.msgIndex,
    typeUrl: row.typeUrl,
    module: row.module,
    typeName: row.typeName,
    decodedJson: row.decodedJson ?? null,
    decodeError: row.decodeError,
  };
  if (includeRaw) {
    dto.raw = row.rawJson ?? null;
  }
  return dto;
}

function toEventDto(row: EventRow): Static<typeof EventDto> {
  return {
    phase: row.phase,
    type: row.type,
    msgIndex: row.msgIndex,
    eventIndex: row.eventIndex,
    attributes: row.attributesJson ?? null,
  };
}
