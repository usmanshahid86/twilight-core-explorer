import type { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  ClaimListResponse,
  ClaimsQuery,
  EpochDetailQuery,
  EpochParams,
  EpochsQuery,
  ParamsQuery,
  RewardEpochDetailResponse,
  RewardEpochListResponse,
  RewardsBalanceListResponse,
  RewardsBalancesQuery,
  RewardsParamsListResponse,
  SlotRewardListResponse,
  SlotRewardsQuery,
  TreasuryPaymentListResponse,
  TreasuryQuery,
  toClaimItem,
  toEpochDetail,
  toEpochListItem,
  toParamsChangeItem,
  toRewardsBalanceItem,
  toSlotRewardItem,
  toTreasuryPaymentItem,
} from '../dto/rewards.js';
import { SlotParams } from '../dto/coreslots.js';
import { ErrorResponse } from '../dto/common.js';
import {
  DEFAULT_LIMIT,
  decodeBigIntPart,
  decodeCursor,
  decodeKeyset,
  encodeCursor,
  encodeKeyset,
  parseUint64,
} from '../lib/pagination.js';
import { badRequest, invalidQuery, notFound } from '../lib/errors.js';
import { parseSlotId } from '../lib/slot-id.js';
import { getCoreSlot } from '../repositories/coreslots-repository.js';
import {
  getEpoch,
  listClaims,
  listEpochs,
  listParamsChanges,
  listRewardsBalances,
  listSlotRewards,
  listTreasuryPayments,
} from '../repositories/rewards-repository.js';

/** Parse an optional numeric filter; out-of-int64 / malformed → 400 invalid_query (not a 500). */
function filterUint64(raw: string | undefined): bigint | undefined {
  if (raw === undefined) return undefined;
  const value = parseUint64(raw);
  if (value === null) {
    throw invalidQuery('numeric value out of range');
  }
  return value;
}

export async function rewardsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // ---- epochs ----
  app.get(
    '/rewards/epochs',
    {
      schema: {
        tags: ['rewards'],
        summary: 'List reward epochs (aggregate projection, not claim truth)',
        querystring: EpochsQuery,
        response: { 200: RewardEpochListResponse, 400: ErrorResponse },
      },
    },
    async (request) => {
      const limit = request.query.limit ?? DEFAULT_LIMIT;
      const beforeEpoch = request.query.cursor !== undefined ? decodeCursor(request.query.cursor) : undefined;
      const fetched = await listEpochs(app.prisma, { beforeEpoch, limit: limit + 1 });
      const hasMore = fetched.length > limit;
      const rows = hasMore ? fetched.slice(0, limit) : fetched;
      const last = rows.length > 0 ? rows[rows.length - 1] : undefined;
      const nextCursor = hasMore && last ? encodeCursor(last.epochNumber) : null;
      return { data: rows.map(toEpochListItem), page: { limit, nextCursor } };
    },
  );

  app.get(
    '/rewards/epochs/:epoch',
    {
      schema: {
        tags: ['rewards'],
        summary: 'Get a reward epoch by number',
        params: EpochParams,
        querystring: EpochDetailQuery,
        response: { 200: RewardEpochDetailResponse, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request) => {
      const epochNumber = parseUint64(request.params.epoch);
      if (epochNumber === null) {
        throw badRequest('invalid_epoch', 'invalid epoch');
      }
      const row = await getEpoch(app.prisma, epochNumber);
      if (!row) {
        throw notFound('epoch not found');
      }
      return { data: toEpochDetail(row, request.query.include === 'raw') };
    },
  );

  // ---- per-slot rewards ----
  app.get(
    '/coreslots/:slotId/rewards',
    {
      schema: {
        tags: ['rewards'],
        summary: 'Reward history for a CoreSlot (observed projection, not live claimable)',
        params: SlotParams,
        querystring: SlotRewardsQuery,
        response: { 200: SlotRewardListResponse, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request) => {
      const slotId = parseSlotId(request.params.slotId);
      const slot = await getCoreSlot(app.prisma, slotId);
      if (!slot) {
        throw notFound('coreslot not found');
      }
      const limit = request.query.limit ?? DEFAULT_LIMIT;
      const beforeEpoch = request.query.cursor !== undefined ? decodeCursor(request.query.cursor) : undefined;
      const fetched = await listSlotRewards(app.prisma, { slotId, beforeEpoch, limit: limit + 1 });
      const hasMore = fetched.length > limit;
      const rows = hasMore ? fetched.slice(0, limit) : fetched;
      const last = rows.length > 0 ? rows[rows.length - 1] : undefined;
      const nextCursor = hasMore && last ? encodeCursor(last.epochNumber) : null;
      return { data: rows.map(toSlotRewardItem), page: { limit, nextCursor } };
    },
  );

  // ---- claims (history only) ----
  app.get(
    '/rewards/claims',
    {
      schema: {
        tags: ['rewards'],
        summary: 'Reward claim history (event history only; not live claimable)',
        querystring: ClaimsQuery,
        response: { 200: ClaimListResponse, 400: ErrorResponse },
      },
    },
    async (request) => {
      const limit = request.query.limit ?? DEFAULT_LIMIT;
      let beforeHeight: bigint | undefined;
      let beforeId: bigint | undefined;
      if (request.query.cursor !== undefined) {
        const [h, i] = decodeKeyset(request.query.cursor, 2);
        beforeHeight = decodeBigIntPart(h as string);
        beforeId = decodeBigIntPart(i as string);
      }
      const fetched = await listClaims(app.prisma, {
        beforeHeight,
        beforeId,
        slotId: filterUint64(request.query.slotId),
        claimant: request.query.claimant,
        txHash: request.query.txHash,
        fromHeight: filterUint64(request.query.fromHeight),
        toHeight: filterUint64(request.query.toHeight),
        limit: limit + 1,
      });
      const hasMore = fetched.length > limit;
      const rows = hasMore ? fetched.slice(0, limit) : fetched;
      const last = rows.length > 0 ? rows[rows.length - 1] : undefined;
      const nextCursor = hasMore && last ? encodeKeyset([last.height, last.id]) : null;
      return { data: rows.map(toClaimItem), page: { limit, nextCursor } };
    },
  );

  // ---- rewards balances (supply excluded by default) ----
  app.get(
    '/rewards/balances',
    {
      schema: {
        tags: ['rewards'],
        summary: 'Rewards/module balance samples (supply excluded by default)',
        querystring: RewardsBalancesQuery,
        response: { 200: RewardsBalanceListResponse, 400: ErrorResponse },
      },
    },
    async (request) => {
      const limit = request.query.limit ?? DEFAULT_LIMIT;
      const beforeId = request.query.cursor !== undefined ? decodeCursor(request.query.cursor) : undefined;
      const fetched = await listRewardsBalances(app.prisma, {
        beforeId,
        sampleKind: request.query.sampleKind,
        denom: request.query.denom,
        height: filterUint64(request.query.height),
        limit: limit + 1,
      });
      const hasMore = fetched.length > limit;
      const rows = hasMore ? fetched.slice(0, limit) : fetched;
      const last = rows.length > 0 ? rows[rows.length - 1] : undefined;
      const nextCursor = hasMore && last ? encodeCursor(last.id) : null;
      return { data: rows.map(toRewardsBalanceItem), page: { limit, nextCursor } };
    },
  );

  // ---- params history ----
  app.get(
    '/rewards/params',
    {
      schema: {
        tags: ['rewards'],
        summary: 'Rewards parameter-change history',
        querystring: ParamsQuery,
        response: { 200: RewardsParamsListResponse, 400: ErrorResponse },
      },
    },
    async (request) => {
      const limit = request.query.limit ?? DEFAULT_LIMIT;
      const beforeId = request.query.cursor !== undefined ? decodeCursor(request.query.cursor) : undefined;
      const fetched = await listParamsChanges(app.prisma, {
        beforeId,
        changeType: request.query.changeType,
        limit: limit + 1,
      });
      const hasMore = fetched.length > limit;
      const rows = hasMore ? fetched.slice(0, limit) : fetched;
      const last = rows.length > 0 ? rows[rows.length - 1] : undefined;
      const nextCursor = hasMore && last ? encodeCursor(last.id) : null;
      return { data: rows.map(toParamsChangeItem), page: { limit, nextCursor } };
    },
  );

  // ---- treasury payments ----
  app.get(
    '/rewards/treasury-payments',
    {
      schema: {
        tags: ['rewards'],
        summary: 'Rewards treasury-payment history',
        querystring: TreasuryQuery,
        response: { 200: TreasuryPaymentListResponse, 400: ErrorResponse },
      },
    },
    async (request) => {
      const limit = request.query.limit ?? DEFAULT_LIMIT;
      const beforeId = request.query.cursor !== undefined ? decodeCursor(request.query.cursor) : undefined;
      const fetched = await listTreasuryPayments(app.prisma, { beforeId, limit: limit + 1 });
      const hasMore = fetched.length > limit;
      const rows = hasMore ? fetched.slice(0, limit) : fetched;
      const last = rows.length > 0 ? rows[rows.length - 1] : undefined;
      const nextCursor = hasMore && last ? encodeCursor(last.id) : null;
      return { data: rows.map(toTreasuryPaymentItem), page: { limit, nextCursor } };
    },
  );
}
