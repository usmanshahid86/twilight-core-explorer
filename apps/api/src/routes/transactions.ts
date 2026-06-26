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
import { DEFAULT_LIMIT, decodeBigIntPart, decodeKeyset, encodeKeyset } from '../lib/pagination.js';
import { notFound } from '../lib/errors.js';
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
    },
    async (request) => {
      const limit = request.query.limit ?? DEFAULT_LIMIT;

      let beforeHeight: bigint | undefined;
      let beforeIndex: number | undefined;
      if (request.query.cursor !== undefined) {
        const [h, i] = decodeKeyset(request.query.cursor, 2);
        beforeHeight = decodeBigIntPart(h as string);
        beforeIndex = Number(decodeBigIntPart(i as string));
      }

      const fetched = await listTxs(app.prisma, {
        beforeHeight,
        beforeIndex,
        height: request.query.height !== undefined ? BigInt(request.query.height) : undefined,
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
