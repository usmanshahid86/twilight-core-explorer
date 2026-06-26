import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import { HeightString, Nullable, PageInfoSchema } from './common.js';
import { toIso } from '../lib/serialize.js';

// Decode-failure diagnostics. Raw payloads (rawJson / rawBase64) are intentionally NOT exposed in 9b.
export const DecodeFailureItem = Type.Object(
  {
    id: HeightString,
    height: HeightString,
    txHash: Nullable(Type.String()),
    msgIndex: Nullable(Type.Integer()),
    eventIndex: Nullable(Type.Integer()),
    typeUrl: Nullable(Type.String()),
    eventType: Nullable(Type.String()),
    failureKind: Type.String(),
    decodeError: Type.String(),
    resolved: Type.Boolean(),
    resolvedAt: Nullable(Type.String()),
    createdAt: Type.String(),
  },
  { $id: 'DecodeFailureItem' },
);

export const DecodeFailureListResponse = Type.Object(
  { data: Type.Array(DecodeFailureItem), page: PageInfoSchema },
  { $id: 'DecodeFailureListResponse' },
);

export const DecodeFailuresQuery = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
    cursor: Type.Optional(Type.String()),
    resolved: Type.Optional(Type.Boolean({ default: false })),
    failureKind: Type.Optional(Type.String()),
    height: Type.Optional(Type.String({ pattern: '^\\d+$' })),
  },
  { additionalProperties: false },
);

export interface DecodeFailureRow {
  id: bigint;
  height: bigint;
  txHash: string | null;
  msgIndex: number | null;
  eventIndex: number | null;
  typeUrl: string | null;
  eventType: string | null;
  failureKind: string;
  decodeError: string;
  resolved: boolean;
  resolvedAt: Date | null;
  createdAt: Date;
}

export function toDecodeFailureItem(row: DecodeFailureRow): Static<typeof DecodeFailureItem> {
  return {
    id: row.id.toString(),
    height: row.height.toString(),
    txHash: row.txHash,
    msgIndex: row.msgIndex,
    eventIndex: row.eventIndex,
    typeUrl: row.typeUrl,
    eventType: row.eventType,
    failureKind: row.failureKind,
    decodeError: row.decodeError,
    resolved: row.resolved,
    resolvedAt: toIso(row.resolvedAt),
    createdAt: toIso(row.createdAt) ?? '',
  };
}
