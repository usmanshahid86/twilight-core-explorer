import type { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  NetworkRiskResponse,
  ProposerLeaderboardResponse,
  ValidatorSetQuery,
  ValidatorSetResponse,
  toNetworkRisk,
  toProposerLeaderboardItem,
  toValidatorSetMember,
} from '../dto/network.js';
import { ErrorResponse } from '../dto/common.js';
import { notFound } from '../lib/errors.js';
import {
  getNetworkRisk,
  getProposerLeaderboard,
  getValidatorSetAtHeight,
} from '../repositories/network-repository.js';

export async function networkRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.get(
    '/network/proposers',
    {
      schema: {
        tags: ['network'],
        summary: 'Proposer leaderboard (attributed blocks per CoreSlot)',
        response: { 200: ProposerLeaderboardResponse },
      },
    },
    async () => {
      const rows = await getProposerLeaderboard(app.prisma);
      return { data: rows.map(toProposerLeaderboardItem) };
    },
  );

  app.get(
    '/network/validator-set',
    {
      schema: {
        tags: ['network'],
        summary: 'Active CoreSlot set at a height',
        querystring: ValidatorSetQuery,
        response: { 200: ValidatorSetResponse, 400: ErrorResponse },
      },
    },
    async (request) => {
      const rows = await getValidatorSetAtHeight(app.prisma, BigInt(request.query.height));
      return { data: rows.map(toValidatorSetMember) };
    },
  );

  app.get(
    '/network/liveness-risk',
    {
      schema: {
        tags: ['network'],
        summary: 'Current network halt-risk snapshot',
        response: { 200: NetworkRiskResponse, 404: ErrorResponse },
      },
    },
    async () => {
      const risk = await getNetworkRisk(app.prisma);
      if (!risk) {
        throw notFound('network liveness-risk snapshot not found');
      }
      return { data: toNetworkRisk(risk) };
    },
  );
}
