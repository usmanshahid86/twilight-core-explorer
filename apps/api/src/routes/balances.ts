import type { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  AccountBalancesParams,
  AccountBalancesResponse,
  SupplyQuery,
  SupplyResponse,
  toAccountBalancesResponse,
  toSupplyResponse,
} from '../dto/balances.js';
import { ErrorResponse } from '../dto/common.js';
import { parseUint64 } from '../lib/pagination.js';
import { invalidQuery, notFound } from '../lib/errors.js';
import {
  getAccountBalances,
  getLatestSupplyHeight,
  getSupplyAtHeight,
} from '../repositories/balances-repository.js';

export async function balancesRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // ---- total supply (sampled) ----
  app.get(
    '/supply',
    {
      schema: {
        tags: ['supply'],
        summary: 'Total sampled supply (latest or at a specific height)',
        querystring: SupplyQuery,
        response: { 200: SupplyResponse, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request) => {
      let height: bigint;
      if (request.query.height !== undefined) {
        const parsed = parseUint64(request.query.height);
        if (parsed === null) {
          throw invalidQuery('height out of range');
        }
        height = parsed;
      } else {
        const latest = await getLatestSupplyHeight(app.prisma);
        if (latest === null) {
          throw notFound('no supply sample');
        }
        height = latest;
      }

      const rows = await getSupplyAtHeight(app.prisma, height, request.query.denom);
      if (rows.length === 0) {
        throw notFound('no supply sample at height');
      }
      return toSupplyResponse(height, rows);
    },
  );

  // ---- account balances (sampled subresource; does not modify /accounts/:address) ----
  app.get(
    '/accounts/:address/balances',
    {
      schema: {
        tags: ['accounts'],
        summary: 'Current sampled balances for an account',
        params: AccountBalancesParams,
        response: { 200: AccountBalancesResponse },
      },
    },
    async (request) => {
      const rows = await getAccountBalances(app.prisma, request.params.address);
      return toAccountBalancesResponse(request.params.address, rows);
    },
  );
}
