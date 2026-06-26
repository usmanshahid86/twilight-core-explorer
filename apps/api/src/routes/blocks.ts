import type { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  BlockDetailQuery,
  BlockDetailResponse,
  BlockListResponse,
  BlockParams,
  BlocksQuery,
  toBlockDetail,
  toBlockListItem,
} from '../dto/blocks.js';
import { ErrorResponse } from '../dto/common.js';
import { DEFAULT_LIMIT, decodeCursor, encodeCursor, parseUint64 } from '../lib/pagination.js';
import { invalidHeight, notFound } from '../lib/errors.js';
import {
  getBlock,
  getProposerByHeight,
  getProposersByHeights,
  listBlocks,
} from '../repositories/blocks-repository.js';

export async function blocksRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // GET /blocks — keyset list, newest-first.
  app.get(
    '/blocks',
    {
      schema: {
        tags: ['blocks'],
        summary: 'List blocks (newest first)',
        querystring: BlocksQuery,
        response: { 200: BlockListResponse, 400: ErrorResponse },
      },
    },
    async (request) => {
      const limit = request.query.limit ?? DEFAULT_LIMIT;
      const beforeHeight =
        request.query.cursor !== undefined ? decodeCursor(request.query.cursor) : null;

      // Fetch one extra row to detect whether a further page exists. This avoids emitting a
      // nextCursor on a final page that happens to be exactly `limit` rows (which would lead to an
      // empty next page).
      const fetched = await listBlocks(app.prisma, beforeHeight, limit + 1);
      const hasMore = fetched.length > limit;
      const rows = hasMore ? fetched.slice(0, limit) : fetched;

      const attributions = await getProposersByHeights(
        app.prisma,
        rows.map((r) => r.height),
      );
      const byHeight = new Map(attributions.map((a) => [a.height, a]));

      const data = rows.map((b) => toBlockListItem(b, byHeight.get(b.height) ?? null));
      const last = rows.length > 0 ? rows[rows.length - 1] : undefined;
      const nextCursor = hasMore && last ? encodeCursor(last.height) : null;

      return { data, page: { limit, nextCursor } };
    },
  );

  // GET /blocks/:height — detail; ?include=raw adds the raw block payload.
  app.get(
    '/blocks/:height',
    {
      schema: {
        tags: ['blocks'],
        summary: 'Get a block by height',
        params: BlockParams,
        querystring: BlockDetailQuery,
        response: { 200: BlockDetailResponse, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request) => {
      const height = parseUint64(request.params.height);
      if (height === null) {
        throw invalidHeight();
      }

      const block = await getBlock(app.prisma, height);
      if (!block) {
        throw notFound('block not found');
      }

      const attribution = await getProposerByHeight(app.prisma, height);
      const includeRaw = request.query.include === 'raw';
      return { data: toBlockDetail(block, attribution, includeRaw) };
    },
  );
}
