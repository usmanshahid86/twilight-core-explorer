import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import { HeightString, Nullable } from './common.js';

// ---------- supply ----------

const Coin = Type.Object({ denom: Type.String(), amount: Type.String() });

export const SupplyResponse = Type.Object(
  {
    data: Type.Object({
      sampledAtHeight: HeightString,
      source: Type.Literal('sampled'),
      supply: Type.Array(Coin),
    }),
  },
  { $id: 'SupplyResponse' },
);

export const SupplyQuery = Type.Object(
  {
    height: Type.Optional(Type.String({ pattern: '^\\d+$' })),
    denom: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

// ---------- account balances ----------

export const AccountBalancesResponse = Type.Object(
  {
    data: Type.Object({
      address: Type.String(),
      sampled: Type.Boolean(),
      sampledAtHeight: Nullable(HeightString),
      source: Type.Literal('sampled'),
      balances: Type.Array(Coin),
    }),
  },
  { $id: 'AccountBalancesResponse' },
);

export const AccountBalancesParams = Type.Object({ address: Type.String() });

// ---------- row shapes + mappers ----------

export interface SupplyRow {
  height: bigint;
  denom: string;
  amount: string;
}

export function toSupplyResponse(
  sampledAtHeight: bigint,
  rows: SupplyRow[],
): Static<typeof SupplyResponse> {
  return {
    data: {
      sampledAtHeight: sampledAtHeight.toString(),
      source: 'sampled',
      supply: rows.map((r) => ({ denom: r.denom, amount: r.amount })),
    },
  };
}

export interface AccountBalanceRow {
  denom: string;
  amount: string;
  sampledAtHeight: bigint;
}

export function toAccountBalancesResponse(
  address: string,
  rows: AccountBalanceRow[],
): Static<typeof AccountBalancesResponse> {
  if (rows.length === 0) {
    // Unsampled: no materialized sample exists. Absence is NOT proof of zero — never fabricate a row.
    return {
      data: { address, sampled: false, sampledAtHeight: null, source: 'sampled', balances: [] },
    };
  }
  // All rows from one sample share a height; use the max defensively.
  const sampledAtHeight = rows.reduce((m, r) => (r.sampledAtHeight > m ? r.sampledAtHeight : m), rows[0]!.sampledAtHeight);
  return {
    data: {
      address,
      sampled: true,
      sampledAtHeight: sampledAtHeight.toString(),
      source: 'sampled',
      balances: rows.map((r) => ({ denom: r.denom, amount: r.amount })),
    },
  };
}
