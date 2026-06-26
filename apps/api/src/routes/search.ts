import type { FastifyInstance } from 'fastify';
import type { Static } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { SearchQuery, SearchResponse, SearchResult } from '../dto/search.js';
import { ErrorResponse } from '../dto/common.js';
import { invalidQuery } from '../lib/errors.js';
import {
  findAccountByAddress,
  findBlockByHash,
  findBlockByHeight,
  findCoreSlotByConsensus,
  findCoreSlotById,
  findCoreSlotByOperator,
  findCoreSlotByPayout,
  findTxByHash,
} from '../repositories/search-repository.js';

type Result = Static<typeof SearchResult>;

const HEX64 = /^[0-9a-fA-F]{64}$/;
const HEX40 = /^[0-9a-fA-F]{40}$/;
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
        throw invalidQuery('q must not be empty');
      }

      // numeric: block height + (9c) CoreSlot by slotId
      if (DIGITS.test(q)) {
        const block = await findBlockByHeight(app.prisma, BigInt(q));
        if (block) results.push({ type: 'block', height: block.height.toString(), hash: block.hash });
        const slot = await findCoreSlotById(app.prisma, BigInt(q));
        if (slot) results.push({ type: 'coreslot', slotId: slot.slotId.toString() });
      }

      // 64-hex is ambiguous: it may be a block hash and/or a tx hash (try the given case + uppercase).
      if (HEX64.test(q)) {
        const block = await findHash(q, (h) => findBlockByHash(app.prisma, h));
        if (block) results.push({ type: 'block', height: block.height.toString(), hash: block.hash });
        const tx = await findHash(q, (h) => findTxByHash(app.prisma, h));
        if (tx) results.push({ type: 'transaction', hash: tx.hash, height: tx.height.toString() });
      }

      // 40-hex consensus address -> (9c) CoreSlot reference (consensus addresses are stored lowercase)
      if (HEX40.test(q)) {
        const slot = await findCoreSlotByConsensus(app.prisma, q.toLowerCase());
        if (slot) results.push({ type: 'coreslot', slotId: slot.slotId.toString(), role: 'consensus' });
      }

      // bech32 address: account + (9c) CoreSlot operator/payout role references
      if (BECH32.test(q)) {
        const account = await findAccountByAddress(app.prisma, q);
        if (account) results.push({ type: 'account', address: account.address });
        const operator = await findCoreSlotByOperator(app.prisma, q);
        if (operator) results.push({ type: 'coreslot', slotId: operator.slotId.toString(), role: 'operator' });
        const payout = await findCoreSlotByPayout(app.prisma, q);
        if (payout) results.push({ type: 'coreslot', slotId: payout.slotId.toString(), role: 'payout' });
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
