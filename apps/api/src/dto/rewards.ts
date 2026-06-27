import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import { HeightString, Nullable, PageInfoSchema } from './common.js';
import { bigToString, toIso } from '../lib/serialize.js';

// Locked caveat constants (in-data caveat fields; envelope unchanged).
// productionClaimReadiness flipped from the historical `gated_by_phase_7_2` to the durable
// read-only posture after Phase 7.2 merged + live-validated (Phase 12 §17/§18). The three
// data-nature caveats below are unchanged.
export const REWARD_SEMANTICS_AGGREGATE = 'aggregate_projection';
export const PRODUCTION_CLAIM_READINESS = 'read_only_no_claim_action';
export const CLAIM_SEMANTICS_HISTORY = 'event_history_only';
export const CLAIM_SEMANTICS_OBSERVED = 'projection_observed_not_live_claimable';

// ---------- epochs ----------

export const RewardEpochListItem = Type.Object(
  {
    epochNumber: HeightString,
    height: HeightString,
    blockTime: Nullable(Type.String()),
    totalReward: Nullable(Type.String()),
    denom: Nullable(Type.String()),
    activeSlotCount: Nullable(Type.Integer()),
    cumulativeEmitted: Nullable(Type.String()),
    distributionMethod: Nullable(Type.String()),
    rewardSemantics: Type.Literal(REWARD_SEMANTICS_AGGREGATE),
  },
  { $id: 'RewardEpochListItem' },
);

export const RewardEpochDetail = Type.Object(
  {
    epochNumber: HeightString,
    height: HeightString,
    blockTime: Nullable(Type.String()),
    totalReward: Nullable(Type.String()),
    denom: Nullable(Type.String()),
    activeSlotCount: Nullable(Type.Integer()),
    cumulativeEmitted: Nullable(Type.String()),
    distributionMethod: Nullable(Type.String()),
    rewardSemantics: Type.Literal(REWARD_SEMANTICS_AGGREGATE),
    raw: Type.Optional(Type.Unknown()),
  },
  { $id: 'RewardEpochDetail' },
);

export const RewardEpochListResponse = Type.Object(
  { data: Type.Array(RewardEpochListItem), page: PageInfoSchema },
  { $id: 'RewardEpochListResponse' },
);
export const RewardEpochDetailResponse = Type.Object(
  { data: RewardEpochDetail },
  { $id: 'RewardEpochDetailResponse' },
);

// ---------- slot rewards ----------

export const SlotRewardItem = Type.Object(
  {
    epochNumber: HeightString,
    amount: Type.String(),
    denom: Type.String(),
    claimed: Type.Boolean(),
    claimedAtHeight: Nullable(HeightString),
    claimTxHash: Nullable(Type.String()),
    sampledAtHeight: Nullable(HeightString),
    productionClaimReadiness: Type.Literal(PRODUCTION_CLAIM_READINESS),
    claimSemantics: Type.Literal(CLAIM_SEMANTICS_OBSERVED),
  },
  { $id: 'SlotRewardItem' },
);
export const SlotRewardListResponse = Type.Object(
  { data: Type.Array(SlotRewardItem), page: PageInfoSchema },
  { $id: 'SlotRewardListResponse' },
);

// ---------- claims ----------

export const ClaimItem = Type.Object(
  {
    id: HeightString,
    slotId: HeightString,
    claimant: Nullable(Type.String()),
    payoutAddress: Nullable(Type.String()),
    startEpoch: Nullable(HeightString),
    endEpoch: Nullable(HeightString),
    amount: Nullable(Type.String()),
    denom: Nullable(Type.String()),
    height: HeightString,
    txHash: Type.String(),
    msgIndex: Nullable(Type.Integer()),
    productionClaimReadiness: Type.Literal(PRODUCTION_CLAIM_READINESS),
    claimSemantics: Type.Literal(CLAIM_SEMANTICS_HISTORY),
  },
  { $id: 'ClaimItem' },
);
export const ClaimListResponse = Type.Object(
  { data: Type.Array(ClaimItem), page: PageInfoSchema },
  { $id: 'ClaimListResponse' },
);

// ---------- rewards balances ----------

export const RewardsBalanceItem = Type.Object(
  {
    id: HeightString,
    sampleKind: Type.String(),
    source: Type.Literal('sampled'),
    height: HeightString,
    address: Nullable(Type.String()),
    moduleName: Nullable(Type.String()),
    denom: Type.String(),
    amount: Type.String(),
  },
  { $id: 'RewardsBalanceItem' },
);
export const RewardsBalanceListResponse = Type.Object(
  { data: Type.Array(RewardsBalanceItem), page: PageInfoSchema },
  { $id: 'RewardsBalanceListResponse' },
);

// ---------- params / treasury ----------

export const RewardsParamsChangeItem = Type.Object(
  {
    id: HeightString,
    height: HeightString,
    txHash: Nullable(Type.String()),
    msgIndex: Nullable(Type.Integer()),
    authority: Nullable(Type.String()),
    changeType: Type.String(),
    params: Nullable(Type.Unknown()),
  },
  { $id: 'RewardsParamsChangeItem' },
);
export const RewardsParamsListResponse = Type.Object(
  { data: Type.Array(RewardsParamsChangeItem), page: PageInfoSchema },
  { $id: 'RewardsParamsListResponse' },
);

export const TreasuryPaymentItem = Type.Object(
  {
    id: HeightString,
    height: HeightString,
    recipient: Nullable(Type.String()),
    denom: Nullable(Type.String()),
    amount: Nullable(Type.String()),
    purpose: Nullable(Type.String()),
  },
  { $id: 'TreasuryPaymentItem' },
);
export const TreasuryPaymentListResponse = Type.Object(
  { data: Type.Array(TreasuryPaymentItem), page: PageInfoSchema },
  { $id: 'TreasuryPaymentListResponse' },
);

// ---------- queries ----------

const LIMIT = Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 }));
const CURSOR = Type.Optional(Type.String());
const DIGITS = Type.Optional(Type.String({ pattern: '^\\d+$' }));

export const EpochsQuery = Type.Object({ limit: LIMIT, cursor: CURSOR }, { additionalProperties: false });
export const EpochParams = Type.Object({ epoch: Type.String() });
export const EpochDetailQuery = Type.Object(
  { include: Type.Optional(Type.Literal('raw')) },
  { additionalProperties: false },
);
export const SlotRewardsQuery = Type.Object({ limit: LIMIT, cursor: CURSOR }, { additionalProperties: false });
export const ClaimsQuery = Type.Object(
  {
    limit: LIMIT,
    cursor: CURSOR,
    slotId: DIGITS,
    claimant: Type.Optional(Type.String()),
    txHash: Type.Optional(Type.String()),
    fromHeight: DIGITS,
    toHeight: DIGITS,
  },
  { additionalProperties: false },
);
export const RewardsBalancesQuery = Type.Object(
  {
    limit: LIMIT,
    cursor: CURSOR,
    sampleKind: Type.Optional(Type.String()),
    denom: Type.Optional(Type.String()),
    height: DIGITS,
  },
  { additionalProperties: false },
);
export const ParamsQuery = Type.Object(
  { limit: LIMIT, cursor: CURSOR, changeType: Type.Optional(Type.String()) },
  { additionalProperties: false },
);
export const TreasuryQuery = Type.Object({ limit: LIMIT, cursor: CURSOR }, { additionalProperties: false });

// ---------- row shapes + mappers ----------

export interface EpochRow {
  epochNumber: bigint;
  height: bigint;
  blockTime: Date | null;
  totalReward: string | null;
  denom: string | null;
  activeSlotCount: number | null;
  cumulativeEmitted: string | null;
  distributionMethod: string | null;
  rawSnapshotJson: unknown;
}

export function toEpochListItem(r: EpochRow): Static<typeof RewardEpochListItem> {
  return {
    epochNumber: r.epochNumber.toString(),
    height: r.height.toString(),
    blockTime: toIso(r.blockTime),
    totalReward: r.totalReward,
    denom: r.denom,
    activeSlotCount: r.activeSlotCount,
    cumulativeEmitted: r.cumulativeEmitted,
    distributionMethod: r.distributionMethod,
    rewardSemantics: REWARD_SEMANTICS_AGGREGATE,
  };
}

export function toEpochDetail(r: EpochRow, includeRaw: boolean): Static<typeof RewardEpochDetail> {
  const detail: Static<typeof RewardEpochDetail> = {
    epochNumber: r.epochNumber.toString(),
    height: r.height.toString(),
    blockTime: toIso(r.blockTime),
    totalReward: r.totalReward,
    denom: r.denom,
    activeSlotCount: r.activeSlotCount,
    cumulativeEmitted: r.cumulativeEmitted,
    distributionMethod: r.distributionMethod,
    rewardSemantics: REWARD_SEMANTICS_AGGREGATE,
  };
  if (includeRaw) {
    detail.raw = r.rawSnapshotJson ?? null;
  }
  return detail;
}

export interface SlotRewardRow {
  epochNumber: bigint;
  amount: string;
  denom: string;
  claimed: boolean;
  claimedAtHeight: bigint | null;
  claimTxHash: string | null;
  sampledAtHeight: bigint | null;
}

export function toSlotRewardItem(r: SlotRewardRow): Static<typeof SlotRewardItem> {
  return {
    epochNumber: r.epochNumber.toString(),
    amount: r.amount,
    denom: r.denom,
    claimed: r.claimed,
    claimedAtHeight: bigToString(r.claimedAtHeight),
    claimTxHash: r.claimTxHash,
    sampledAtHeight: bigToString(r.sampledAtHeight),
    productionClaimReadiness: PRODUCTION_CLAIM_READINESS,
    claimSemantics: CLAIM_SEMANTICS_OBSERVED,
  };
}

export interface ClaimRow {
  id: bigint;
  slotId: bigint;
  claimant: string | null;
  payoutAddress: string | null;
  startEpoch: bigint | null;
  endEpoch: bigint | null;
  amount: string | null;
  denom: string | null;
  height: bigint;
  txHash: string;
  msgIndex: number | null;
}

export function toClaimItem(r: ClaimRow): Static<typeof ClaimItem> {
  return {
    id: r.id.toString(),
    slotId: r.slotId.toString(),
    claimant: r.claimant,
    payoutAddress: r.payoutAddress,
    startEpoch: bigToString(r.startEpoch),
    endEpoch: bigToString(r.endEpoch),
    amount: r.amount,
    denom: r.denom,
    height: r.height.toString(),
    txHash: r.txHash,
    msgIndex: r.msgIndex,
    productionClaimReadiness: PRODUCTION_CLAIM_READINESS,
    claimSemantics: CLAIM_SEMANTICS_HISTORY,
  };
}

export interface RewardsBalanceRow {
  id: bigint;
  sampleKind: string;
  height: bigint;
  address: string | null;
  moduleName: string | null;
  denom: string;
  amount: string;
}

export function toRewardsBalanceItem(r: RewardsBalanceRow): Static<typeof RewardsBalanceItem> {
  return {
    id: r.id.toString(),
    sampleKind: r.sampleKind,
    source: 'sampled',
    height: r.height.toString(),
    address: r.address,
    moduleName: r.moduleName,
    denom: r.denom,
    amount: r.amount,
  };
}

export interface ParamsChangeRow {
  id: bigint;
  height: bigint;
  txHash: string | null;
  msgIndex: number | null;
  authority: string | null;
  changeType: string;
  paramsJson: unknown;
}

export function toParamsChangeItem(r: ParamsChangeRow): Static<typeof RewardsParamsChangeItem> {
  return {
    id: r.id.toString(),
    height: r.height.toString(),
    txHash: r.txHash,
    msgIndex: r.msgIndex,
    authority: r.authority,
    changeType: r.changeType,
    params: r.paramsJson ?? null,
  };
}

export interface TreasuryPaymentRow {
  id: bigint;
  height: bigint;
  recipient: string | null;
  denom: string | null;
  amount: string | null;
  purpose: string | null;
}

export function toTreasuryPaymentItem(r: TreasuryPaymentRow): Static<typeof TreasuryPaymentItem> {
  return {
    id: r.id.toString(),
    height: r.height.toString(),
    recipient: r.recipient,
    denom: r.denom,
    amount: r.amount,
    purpose: r.purpose,
  };
}
