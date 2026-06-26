import { Type } from '@sinclair/typebox';
import { HeightString, Nullable } from './common.js';

// 9b search resolves a query string to typed REFERENCES (not full entities) the client then follows.
// Scope is locked to generic references: block height, block hash, tx hash, account address.
// (slotId / consensus hex / valcons / role refs are deferred to 9c.)

const BlockRef = Type.Object({
  type: Type.Literal('block'),
  height: HeightString,
  hash: Nullable(Type.String()),
});

const TransactionRef = Type.Object({
  type: Type.Literal('transaction'),
  hash: Type.String(),
  height: HeightString,
});

const AccountRef = Type.Object({
  type: Type.Literal('account'),
  address: Type.String(),
});

export const SearchResult = Type.Union([BlockRef, TransactionRef, AccountRef], { $id: 'SearchResult' });

export const SearchResponse = Type.Object(
  { data: Type.Array(SearchResult) },
  { $id: 'SearchResponse' },
);

export const SearchQuery = Type.Object(
  { q: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);
