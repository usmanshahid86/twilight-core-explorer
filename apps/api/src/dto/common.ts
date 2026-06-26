// Shared TypeBox schemas. These feed three things from one definition: runtime validation,
// TypeScript types, and the OpenAPI document.

import { Type } from '@sinclair/typebox';
import type { TSchema } from '@sinclair/typebox';

/** A value that may be explicitly null (distinct from absent). */
export const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);

/** Height/id as a decimal string (BigInt is never serialized as a JSON number). */
export const HeightString = Type.String({ pattern: '^\\d+$', description: 'Decimal height/id as string' });

export const ErrorResponse = Type.Object(
  {
    error: Type.Object({
      code: Type.String(),
      message: Type.String(),
      details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }),
  },
  { $id: 'ErrorResponse' },
);

export const PageInfoSchema = Type.Object(
  {
    limit: Type.Integer({ minimum: 1 }),
    nextCursor: Nullable(Type.String()),
  },
  { $id: 'PageInfo' },
);

export const BlockProposerDto = Type.Object(
  {
    rawAddress: Nullable(Type.String()),
    address: Nullable(Type.String()),
    slotId: Nullable(HeightString),
    operatorAddress: Nullable(Type.String()),
    attributionStatus: Nullable(Type.String()),
  },
  { $id: 'BlockProposer' },
);

/** Standard error responses reused across routes. */
export const ErrorResponses = {
  400: ErrorResponse,
  404: ErrorResponse,
  500: ErrorResponse,
} as const;
