import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import { BlockProposerDto, HeightString, Nullable, PageInfoSchema } from './common.js';
import { bigToString, toIso } from '../lib/serialize.js';

export const BlockListItem = Type.Object(
  {
    height: HeightString,
    hash: Nullable(Type.String()),
    time: Nullable(Type.String()),
    txCount: Type.Integer(),
    chainId: Nullable(Type.String()),
    proposer: BlockProposerDto,
  },
  { $id: 'BlockListItem' },
);

export const BlockDetail = Type.Object(
  {
    height: HeightString,
    hash: Nullable(Type.String()),
    time: Nullable(Type.String()),
    txCount: Type.Integer(),
    chainId: Nullable(Type.String()),
    proposer: BlockProposerDto,
    appHash: Nullable(Type.String()),
    validatorsHash: Nullable(Type.String()),
    nextValidatorsHash: Nullable(Type.String()),
    lastBlockHash: Nullable(Type.String()),
    createdAt: Type.String(),
    raw: Type.Optional(Type.Unknown()),
  },
  { $id: 'BlockDetail' },
);

export const BlockListResponse = Type.Object(
  { data: Type.Array(BlockListItem), page: PageInfoSchema },
  { $id: 'BlockListResponse' },
);

export const BlockDetailResponse = Type.Object(
  { data: BlockDetail },
  { $id: 'BlockDetailResponse' },
);

export const BlocksQuery = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
    cursor: Type.Optional(Type.String()),
  },
  { additionalProperties: false }, // any unknown query param (e.g. include=raw) -> 400 invalid_query
);

// No pattern here on purpose: the handler validates the height itself so a non-numeric value
// returns the specific `invalid_height` code rather than a generic schema `invalid_query`.
export const BlockParams = Type.Object({
  height: Type.String(),
});

export const BlockDetailQuery = Type.Object(
  { include: Type.Optional(Type.Literal('raw')) },
  { additionalProperties: false },
);

// ----- row shapes + mappers -----

export interface BlockRow {
  height: bigint;
  hash: string | null;
  time: Date | null;
  chainId: string | null;
  proposerAddress: string | null;
  appHash: string | null;
  validatorsHash: string | null;
  nextValidatorsHash: string | null;
  lastBlockHash: string | null;
  txCount: number;
  rawJson: unknown;
  createdAt: Date;
}

export interface ProposerAttributionRow {
  height: bigint;
  proposerAddress: string | null;
  rawProposerAddress: string | null;
  slotId: bigint | null;
  operatorAddress: string | null;
  attributionStatus: string;
}

type ProposerDto = Static<typeof BlockProposerDto>;

/** Build the proposer DTO from the block plus an OPTIONAL materialized attribution row. When the
 *  attribution is absent the block's own proposer address is surfaced and attributionStatus is null
 *  (unknown). The API never runs the proposer projection. */
export function toProposerDto(block: BlockRow, attribution: ProposerAttributionRow | null): ProposerDto {
  if (attribution) {
    return {
      rawAddress: attribution.rawProposerAddress ?? block.proposerAddress,
      address: attribution.proposerAddress,
      slotId: bigToString(attribution.slotId),
      operatorAddress: attribution.operatorAddress,
      attributionStatus: attribution.attributionStatus,
    };
  }
  return {
    rawAddress: block.proposerAddress,
    address: block.proposerAddress ? block.proposerAddress.toLowerCase() : null,
    slotId: null,
    operatorAddress: null,
    attributionStatus: null,
  };
}

export function toBlockListItem(
  block: BlockRow,
  attribution: ProposerAttributionRow | null,
): Static<typeof BlockListItem> {
  return {
    height: block.height.toString(),
    hash: block.hash,
    time: toIso(block.time),
    txCount: block.txCount,
    chainId: block.chainId,
    proposer: toProposerDto(block, attribution),
  };
}

export function toBlockDetail(
  block: BlockRow,
  attribution: ProposerAttributionRow | null,
  includeRaw: boolean,
): Static<typeof BlockDetail> {
  const detail: Static<typeof BlockDetail> = {
    height: block.height.toString(),
    hash: block.hash,
    time: toIso(block.time),
    txCount: block.txCount,
    chainId: block.chainId,
    proposer: toProposerDto(block, attribution),
    appHash: block.appHash,
    validatorsHash: block.validatorsHash,
    nextValidatorsHash: block.nextValidatorsHash,
    lastBlockHash: block.lastBlockHash,
    createdAt: toIso(block.createdAt) ?? '',
  };
  if (includeRaw) {
    detail.raw = block.rawJson;
  }
  return detail;
}
