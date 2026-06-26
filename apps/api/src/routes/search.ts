import type { FastifyInstance } from 'fastify';
import type { Static } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { SearchQuery, SearchResponse, SearchResult } from '../dto/search.js';
import { ErrorResponse } from '../dto/common.js';
import {
  findAccountByAddress,
  findBlockByHash,
  findBlockByHeight,
  findTxByHash,
} from '../repositories/search-repository.js';

type Result = Static<typeof SearchResult>;

const HEX64 = /^[0-9a-fA-F]{64}$/;
const DIGITS = /^\d+$/;
const BECH32 = /^twilight1[0-9a-z]+$/;

export async function searchRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.get(
    '/search',
    {
      schema: {
        tags: ['search'],
        summary: 'Resolve a query to typed references',
        querystring: SearchQuery,
        response: { 200: SearchResponse, 400: ErrorResponse },
      },
    },
    async (request) => {
      const q = request.query.q.trim();
      const results: Result[] = [];
      if (q.length === 0) {
        return { data: results };
      }

      // block by height
      if (DIGITS.test(q)) {
        const block = await findBlockByHeight(app.prisma, BigInt(q));
        if (block) results.push({ type: 'block', height: block.height.toString(), hash: block.hash });
      }

      // 64-hex is ambiguous: it may be a block hash and/or a tx hash (try the given case + uppercase).
      if (HEX64.test(q)) {
        const block = await findHash(q, (h) => findBlockByHash(app.prisma, h));
        if (block) results.push({ type: 'block', height: block.height.toString(), hash: block.hash });
        const tx = await findHash(q, (h) => findTxByHash(app.prisma, h));
        if (tx) results.push({ type: 'transaction', hash: tx.hash, height: tx.height.toString() });
      }

      // account address (bech32)
      if (BECH32.test(q)) {
        const account = await findAccountByAddress(app.prisma, q);
        if (account) results.push({ type: 'account', address: account.address });
      }

      return { data: results };
    },
  );
}

/** Try a hash lookup with the given casing, then uppercase (this chain stores hashes uppercase). */
async function findHash<T>(q: string, lookup: (hash: string) => Promise<T | null>): Promise<T | null> {
  const direct = await lookup(q);
  if (direct) return direct;
  const upper = q.toUpperCase();
  return upper !== q ? lookup(upper) : null;
}
