import type { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  TxDetailQuery,
  TxDetailResponse,
  TxListResponse,
  TxParams,
  TxsQuery,
  toTxDetail,
  toTxListItem,
} from '../dto/transactions.js';
import { ErrorResponse } from '../dto/common.js';
import {
  DEFAULT_LIMIT,
  decodeBigIntPart,
  decodeKeyset,
  encodeKeyset,
  parseUint64,
} from '../lib/pagination.js';
import { invalidCursor, invalidQuery, notFound } from '../lib/errors.js';
import {
  getBlockTime,
  getEvents,
  getMessages,
  getTx,
  listTxs,
} from '../repositories/transactions-repository.js';

export async function transactionsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.get(
    '/txs',
    {
      schema: {
        tags: ['transactions'],
        summary: 'List transactions (newest first)',
        querystring: TxsQuery,
        response: { 200: TxListResponse, 400: ErrorResponse },
      },
      config: { cacheControl: 'revalidate' }, // cacheable with always-revalidate (ETag)
    },
    async (request) => {
      const limit = request.query.limit ?? DEFAULT_LIMIT;

      let beforeHeight: bigint | undefined;
      let beforeIndex: number | undefined;
      if (request.query.cursor !== undefined) {
        const [h, i] = decodeKeyset(request.query.cursor, 2);
        beforeHeight = decodeBigIntPart(h as string);
        const index = decodeBigIntPart(i as string);
        if (index > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw invalidCursor();
        }
        beforeIndex = Number(index);
      }

      let height: bigint | undefined;
      if (request.query.height !== undefined) {
        const parsed = parseUint64(request.query.height);
        if (parsed === null) {
          throw invalidQuery('height out of range');
        }
        height = parsed;
      }

      const fetched = await listTxs(app.prisma, {
        beforeHeight,
        beforeIndex,
        height,
        status: request.query.status,
        limit: limit + 1,
      });
      const hasMore = fetched.length > limit;
      const rows = hasMore ? fetched.slice(0, limit) : fetched;

      const data = rows.map(toTxListItem);
      const last = rows.length > 0 ? rows[rows.length - 1] : undefined;
      const nextCursor = hasMore && last ? encodeKeyset([last.height, last.index]) : null;

      return { data, page: { limit, nextCursor } };
    },
  );

  app.get(
    '/txs/:hash',
    {
      schema: {
        tags: ['transactions'],
        summary: 'Get a transaction by hash',
        params: TxParams,
        querystring: TxDetailQuery,
        response: { 200: TxDetailResponse, 404: ErrorResponse },
      },
      config: { cacheControl: 'revalidate' },
    },
    async (request) => {
      const tx = await getTx(app.prisma, request.params.hash);
      if (!tx) {
        throw notFound('transaction not found');
      }
      const [messages, events, time] = await Promise.all([
        getMessages(app.prisma, tx.hash),
        getEvents(app.prisma, tx.hash),
        getBlockTime(app.prisma, tx.height),
      ]);
      const includeRaw = request.query.include === 'raw';
      return { data: toTxDetail(tx, messages, events, time, includeRaw) };
    },
  );
}
