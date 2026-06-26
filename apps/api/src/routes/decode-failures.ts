import type { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  DecodeFailureListResponse,
  DecodeFailuresQuery,
  toDecodeFailureItem,
} from '../dto/decode-failures.js';
import { ErrorResponse } from '../dto/common.js';
import { DEFAULT_LIMIT, decodeCursor, encodeCursor, parseUint64 } from '../lib/pagination.js';
import { invalidQuery } from '../lib/errors.js';
import { listDecodeFailures } from '../repositories/decode-failures-repository.js';

export async function decodeFailuresRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.get(
    '/decode-failures',
    {
      schema: {
        tags: ['diagnostics'],
        summary: 'List decode failures (newest first)',
        querystring: DecodeFailuresQuery,
        response: { 200: DecodeFailureListResponse, 400: ErrorResponse },
      },
    },
    async (request) => {
      const limit = request.query.limit ?? DEFAULT_LIMIT;
      const beforeId =
        request.query.cursor !== undefined ? decodeCursor(request.query.cursor) : undefined;

      let height: bigint | undefined;
      if (request.query.height !== undefined) {
        const parsed = parseUint64(request.query.height);
        if (parsed === null) {
          throw invalidQuery('height out of range');
        }
        height = parsed;
      }

      const fetched = await listDecodeFailures(app.prisma, {
        beforeId,
        resolved: request.query.resolved ?? false, // default unresolved (schema defaults are inert under TypeBox compiler)
        failureKind: request.query.failureKind,
        height,
        limit: limit + 1,
      });
      const hasMore = fetched.length > limit;
      const rows = hasMore ? fetched.slice(0, limit) : fetched;

      const data = rows.map(toDecodeFailureItem);
      const last = rows.length > 0 ? rows[rows.length - 1] : undefined;
      const nextCursor = hasMore && last ? encodeCursor(last.id) : null;

      return { data, page: { limit, nextCursor } };
    },
  );
}
