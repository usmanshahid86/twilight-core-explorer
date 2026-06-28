import type { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  AccountDetailQuery,
  AccountDetailResponse,
  AccountListResponse,
  AccountParams,
  AccountsQuery,
  toAccountDetail,
  toAccountListItem,
} from '../dto/accounts.js';
import { ErrorResponse } from '../dto/common.js';
import { DEFAULT_LIMIT, decodeKeyset, encodeKeyset } from '../lib/pagination.js';
import { invalidCursor, notFound } from '../lib/errors.js';
import { getAccount, listAccounts } from '../repositories/accounts-repository.js';

// Account cursors are emitted from a bech32 account address (encodeKeyset([address])). Validate the
// decoded part has that shape so a structurally-valid-but-meaningless cursor is rejected. (No bech32
// dependency — a charset check is sufficient and stays within 9b scope.)
const ACCOUNT_ADDRESS = /^twilight1[0-9a-z]+$/;

function decodeAccountCursor(cursor: string): string {
  const address = decodeKeyset(cursor, 1)[0];
  if (!address || !ACCOUNT_ADDRESS.test(address)) {
    throw invalidCursor();
  }
  return address;
}

export async function accountsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.get(
    '/accounts',
    {
      schema: {
        tags: ['accounts'],
        summary: 'List accounts (address order)',
        querystring: AccountsQuery,
        response: { 200: AccountListResponse, 400: ErrorResponse },
      },
      config: { cacheControl: 'revalidate' }, // cacheable with always-revalidate (ETag)
    },
    async (request) => {
      const limit = request.query.limit ?? DEFAULT_LIMIT;
      const afterAddress =
        request.query.cursor !== undefined ? decodeAccountCursor(request.query.cursor) : undefined;

      const fetched = await listAccounts(app.prisma, {
        afterAddress,
        accountKind: request.query.accountKind,
        limit: limit + 1,
      });
      const hasMore = fetched.length > limit;
      const rows = hasMore ? fetched.slice(0, limit) : fetched;

      const data = rows.map(toAccountListItem);
      const last = rows.length > 0 ? rows[rows.length - 1] : undefined;
      const nextCursor = hasMore && last ? encodeKeyset([last.address]) : null;

      return { data, page: { limit, nextCursor } };
    },
  );

  app.get(
    '/accounts/:address',
    {
      schema: {
        tags: ['accounts'],
        summary: 'Get an account by address',
        params: AccountParams,
        querystring: AccountDetailQuery,
        response: { 200: AccountDetailResponse, 404: ErrorResponse },
      },
      config: { cacheControl: 'revalidate' },
    },
    async (request) => {
      const account = await getAccount(app.prisma, request.params.address);
      if (!account) {
        throw notFound('account not found');
      }
      const includeRaw = request.query.include === 'raw';
      return { data: toAccountDetail(account, includeRaw) };
    },
  );
}
