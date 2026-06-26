import type { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  CoreSlotDetailQuery,
  CoreSlotDetailResponse,
  CoreSlotEventsResponse,
  CoreSlotListResponse,
  CoreSlotsQuery,
  EVENT_KINDS,
  KeyRotationsResponse,
  ListQuery,
  ProposedBlocksResponse,
  SlotEventsQuery,
  SlotParams,
  WindowsResponse,
  toCoreSlotDetail,
  toCoreSlotEvent,
  toCoreSlotListItem,
  toKeyRotation,
  toProposedBlock,
  toWindow,
} from '../dto/coreslots.js';
import type { EventKind } from '../dto/coreslots.js';
import {
  CoreSlotHealthResponse,
  LivenessQuery,
  LivenessResponse,
  toCoreSlotHealth,
  toLivenessSummary,
} from '../dto/coreslot-liveness.js';
import { ErrorResponse } from '../dto/common.js';
import {
  DEFAULT_LIMIT,
  decodeBigIntPart,
  decodeCursor,
  decodeKeyset,
  encodeCursor,
  encodeKeyset,
} from '../lib/pagination.js';
import { invalidCursor, notFound } from '../lib/errors.js';
import { parseSlotId } from '../lib/slot-id.js';
import {
  getBlockTimes,
  getCoreSlot,
  listCoreSlots,
  listKeyRotations,
  listProposedBlocks,
  listSlotEvents,
  listWindows,
} from '../repositories/coreslots-repository.js';
import {
  getHealthSnapshot,
  listLivenessSummaries,
} from '../repositories/coreslot-liveness-repository.js';

export async function coreslotsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  const requireSlot = async (slotId: bigint): Promise<void> => {
    const slot = await getCoreSlot(app.prisma, slotId);
    if (!slot) {
      throw notFound('coreslot not found');
    }
  };

  // ---- list / detail ----

  app.get(
    '/coreslots',
    {
      schema: {
        tags: ['coreslots'],
        summary: 'List CoreSlots',
        querystring: CoreSlotsQuery,
        response: { 200: CoreSlotListResponse, 400: ErrorResponse },
      },
    },
    async (request) => {
      const limit = request.query.limit ?? DEFAULT_LIMIT;
      const afterSlotId =
        request.query.cursor !== undefined
          ? decodeBigIntPart(decodeKeyset(request.query.cursor, 1)[0] as string)
          : undefined;

      const fetched = await listCoreSlots(app.prisma, {
        afterSlotId,
        status: request.query.status,
        operatorAddress: request.query.operatorAddress,
        consensusAddress: request.query.consensusAddress,
        payoutAddress: request.query.payoutAddress,
        limit: limit + 1,
      });
      const hasMore = fetched.length > limit;
      const rows = hasMore ? fetched.slice(0, limit) : fetched;
      const last = rows.length > 0 ? rows[rows.length - 1] : undefined;
      const nextCursor = hasMore && last ? encodeKeyset([last.slotId]) : null;

      return { data: rows.map(toCoreSlotListItem), page: { limit, nextCursor } };
    },
  );

  app.get(
    '/coreslots/:slotId',
    {
      schema: {
        tags: ['coreslots'],
        summary: 'Get a CoreSlot by id',
        params: SlotParams,
        querystring: CoreSlotDetailQuery,
        response: { 200: CoreSlotDetailResponse, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request) => {
      const slotId = parseSlotId(request.params.slotId);
      const slot = await getCoreSlot(app.prisma, slotId);
      if (!slot) {
        throw notFound('coreslot not found');
      }
      const health = await getHealthSnapshot(app.prisma, slotId);
      return { data: toCoreSlotDetail(slot, health, request.query.include === 'raw') };
    },
  );

  // ---- events (lifecycle | metadata | payout) ----

  app.get(
    '/coreslots/:slotId/events',
    {
      schema: {
        tags: ['coreslots'],
        summary: 'CoreSlot event history (lifecycle, metadata, payout)',
        params: SlotParams,
        querystring: SlotEventsQuery,
        response: { 200: CoreSlotEventsResponse, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request) => {
      const slotId = parseSlotId(request.params.slotId);
      await requireSlot(slotId);
      const limit = request.query.limit ?? DEFAULT_LIMIT;

      let cursor;
      if (request.query.cursor !== undefined) {
        const [h, kind, id] = decodeKeyset(request.query.cursor, 3);
        if (!EVENT_KINDS.includes(kind as EventKind)) {
          throw invalidCursor();
        }
        cursor = { height: decodeBigIntPart(h as string), kind: kind as EventKind, id: decodeBigIntPart(id as string) };
      }

      const fetched = await listSlotEvents(app.prisma, {
        slotId,
        cursor,
        kind: request.query.kind,
        limit,
      });
      const hasMore = fetched.length > limit;
      const rows = hasMore ? fetched.slice(0, limit) : fetched;
      const last = rows.length > 0 ? rows[rows.length - 1] : undefined;
      const nextCursor = hasMore && last ? encodeKeyset([last.height, last.kind, last.id]) : null;

      return { data: rows.map(toCoreSlotEvent), page: { limit, nextCursor } };
    },
  );

  // ---- windows ----

  app.get(
    '/coreslots/:slotId/windows',
    {
      schema: {
        tags: ['coreslots'],
        summary: 'Consensus windows for a CoreSlot',
        params: SlotParams,
        querystring: ListQuery,
        response: { 200: WindowsResponse, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request) => {
      const slotId = parseSlotId(request.params.slotId);
      await requireSlot(slotId);
      const limit = request.query.limit ?? DEFAULT_LIMIT;

      let beforeFrom: bigint | undefined;
      let beforeId: bigint | undefined;
      if (request.query.cursor !== undefined) {
        const [f, id] = decodeKeyset(request.query.cursor, 2);
        beforeFrom = decodeBigIntPart(f as string);
        beforeId = decodeBigIntPart(id as string);
      }

      const fetched = await listWindows(app.prisma, { slotId, beforeFrom, beforeId, limit: limit + 1 });
      const hasMore = fetched.length > limit;
      const rows = hasMore ? fetched.slice(0, limit) : fetched;
      const last = rows.length > 0 ? rows[rows.length - 1] : undefined;
      const nextCursor = hasMore && last ? encodeKeyset([last.effectiveFromHeight, last.id]) : null;

      return { data: rows.map(toWindow), page: { limit, nextCursor } };
    },
  );

  // ---- key rotations ----

  app.get(
    '/coreslots/:slotId/key-rotations',
    {
      schema: {
        tags: ['coreslots'],
        summary: 'Consensus key-rotation history for a CoreSlot',
        params: SlotParams,
        querystring: ListQuery,
        response: { 200: KeyRotationsResponse, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request) => {
      const slotId = parseSlotId(request.params.slotId);
      await requireSlot(slotId);
      const limit = request.query.limit ?? DEFAULT_LIMIT;
      const beforeId =
        request.query.cursor !== undefined ? decodeCursor(request.query.cursor) : undefined;

      const fetched = await listKeyRotations(app.prisma, { slotId, beforeId, limit: limit + 1 });
      const hasMore = fetched.length > limit;
      const rows = hasMore ? fetched.slice(0, limit) : fetched;
      const last = rows.length > 0 ? rows[rows.length - 1] : undefined;
      const nextCursor = hasMore && last ? encodeCursor(last.id) : null;

      return { data: rows.map(toKeyRotation), page: { limit, nextCursor } };
    },
  );

  // ---- proposed blocks ----

  app.get(
    '/coreslots/:slotId/proposed-blocks',
    {
      schema: {
        tags: ['coreslots'],
        summary: 'Blocks proposed by a CoreSlot',
        params: SlotParams,
        querystring: ListQuery,
        response: { 200: ProposedBlocksResponse, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request) => {
      const slotId = parseSlotId(request.params.slotId);
      await requireSlot(slotId);
      const limit = request.query.limit ?? DEFAULT_LIMIT;
      const beforeHeight =
        request.query.cursor !== undefined ? decodeCursor(request.query.cursor) : undefined;

      const fetched = await listProposedBlocks(app.prisma, { slotId, beforeHeight, limit: limit + 1 });
      const hasMore = fetched.length > limit;
      const rows = hasMore ? fetched.slice(0, limit) : fetched;
      const times = await getBlockTimes(app.prisma, rows.map((r) => r.height));
      const last = rows.length > 0 ? rows[rows.length - 1] : undefined;
      const nextCursor = hasMore && last ? encodeCursor(last.height) : null;

      return {
        data: rows.map((r) => toProposedBlock(r, times.get(r.height) ?? null)),
        page: { limit, nextCursor },
      };
    },
  );

  // ---- liveness summaries ----

  app.get(
    '/coreslots/:slotId/liveness',
    {
      schema: {
        tags: ['coreslots'],
        summary: 'CoreSlot liveness summaries (by window kind)',
        params: SlotParams,
        querystring: LivenessQuery,
        response: { 200: LivenessResponse, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request) => {
      const slotId = parseSlotId(request.params.slotId);
      await requireSlot(slotId);
      const rows = await listLivenessSummaries(app.prisma, { slotId, windowKind: request.query.windowKind });
      return { data: rows.map(toLivenessSummary) };
    },
  );

  // ---- health snapshot ----

  app.get(
    '/coreslots/:slotId/health',
    {
      schema: {
        tags: ['coreslots'],
        summary: 'CoreSlot current health snapshot',
        params: SlotParams,
        response: { 200: CoreSlotHealthResponse, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request) => {
      const slotId = parseSlotId(request.params.slotId);
      const health = await getHealthSnapshot(app.prisma, slotId);
      if (!health) {
        throw notFound('health snapshot not found');
      }
      return { data: toCoreSlotHealth(health) };
    },
  );
}
