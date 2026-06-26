import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import { HeightString, Nullable, PageInfoSchema } from './common.js';
import { bigToString, toIso } from '../lib/serialize.js';

// ---- CoreSlot core ----

const CoreSlotHealthQuick = Type.Object({
  healthStatus: Type.String(),
  healthReason: Nullable(Type.String()),
  isActiveAtLatest: Type.Boolean(),
  uptimeBps: Nullable(Type.Integer()),
  currentMissedStreak: Type.Integer(),
  summaryStatus: Nullable(Type.String()),
});

export const CoreSlotListItem = Type.Object(
  {
    slotId: HeightString,
    status: Nullable(Type.String()),
    operatorAddress: Nullable(Type.String()),
    payoutAddress: Nullable(Type.String()),
    consensusAddress: Nullable(Type.String()),
    consensusPower: Nullable(HeightString),
    rewardWeight: Nullable(Type.String()),
    createdHeight: Nullable(HeightString),
    updatedHeight: HeightString,
    removedHeight: Nullable(HeightString),
  },
  { $id: 'CoreSlotListItem' },
);

export const CoreSlotDetail = Type.Object(
  {
    slotId: HeightString,
    status: Nullable(Type.String()),
    operatorAddress: Nullable(Type.String()),
    payoutAddress: Nullable(Type.String()),
    consensusAddress: Nullable(Type.String()),
    consensusPower: Nullable(HeightString),
    rewardWeight: Nullable(Type.String()),
    createdHeight: Nullable(HeightString),
    updatedHeight: HeightString,
    removedHeight: Nullable(HeightString),
    consensusPubkey: Nullable(Type.Unknown()),
    metadata: Nullable(Type.Unknown()),
    health: Nullable(CoreSlotHealthQuick),
    raw: Type.Optional(Type.Unknown()),
  },
  { $id: 'CoreSlotDetail' },
);

export const CoreSlotListResponse = Type.Object(
  { data: Type.Array(CoreSlotListItem), page: PageInfoSchema },
  { $id: 'CoreSlotListResponse' },
);
export const CoreSlotDetailResponse = Type.Object({ data: CoreSlotDetail }, { $id: 'CoreSlotDetailResponse' });

export const CoreSlotsQuery = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
    cursor: Type.Optional(Type.String()),
    status: Type.Optional(Type.String()),
    operatorAddress: Type.Optional(Type.String()),
    consensusAddress: Type.Optional(Type.String()),
    payoutAddress: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export const SlotParams = Type.Object({ slotId: Type.String() });
export const CoreSlotDetailQuery = Type.Object(
  { include: Type.Optional(Type.Literal('raw')) },
  { additionalProperties: false },
);

// ---- events (lifecycle | metadata | payout) ----

export const EVENT_KINDS = ['lifecycle', 'metadata', 'payout'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const CoreSlotEvent = Type.Object(
  {
    kind: Type.Union(EVENT_KINDS.map((k) => Type.Literal(k))),
    height: HeightString,
    eventId: HeightString,
    txHash: Nullable(Type.String()),
    msgIndex: Nullable(Type.Integer()),
    detail: Type.Unknown(),
  },
  { $id: 'CoreSlotEvent' },
);

export const CoreSlotEventsResponse = Type.Object(
  { data: Type.Array(CoreSlotEvent), page: PageInfoSchema },
  { $id: 'CoreSlotEventsResponse' },
);
export const SlotEventsQuery = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
    cursor: Type.Optional(Type.String()),
    kind: Type.Optional(Type.Union(EVENT_KINDS.map((k) => Type.Literal(k)))),
  },
  { additionalProperties: false },
);

// ---- windows ----

export const ConsensusWindowDto = Type.Object(
  {
    id: HeightString,
    consensusAddress: Type.String(),
    operatorAddress: Nullable(Type.String()),
    consensusPower: Nullable(HeightString),
    validatorUpdateHeight: Nullable(HeightString),
    effectiveFromHeight: HeightString,
    effectiveToHeight: Nullable(HeightString),
    status: Type.String(),
    openedByKind: Type.String(),
    closedByKind: Nullable(Type.String()),
  },
  { $id: 'ConsensusWindow' },
);
export const WindowsResponse = Type.Object(
  { data: Type.Array(ConsensusWindowDto), page: PageInfoSchema },
  { $id: 'WindowsResponse' },
);

// ---- key rotations ----

export const KeyRotationDto = Type.Object(
  {
    id: HeightString,
    status: Type.String(),
    operatorAddress: Nullable(Type.String()),
    oldConsensusAddress: Nullable(Type.String()),
    newConsensusAddress: Nullable(Type.String()),
    requestedHeight: Nullable(HeightString),
    effectiveHeight: Nullable(HeightString),
    appliedHeight: Nullable(HeightString),
    cancelledHeight: Nullable(HeightString),
    reason: Nullable(Type.String()),
    requestTxHash: Nullable(Type.String()),
    appliedTxHash: Nullable(Type.String()),
    cancelledTxHash: Nullable(Type.String()),
  },
  { $id: 'KeyRotation' },
);
export const KeyRotationsResponse = Type.Object(
  { data: Type.Array(KeyRotationDto), page: PageInfoSchema },
  { $id: 'KeyRotationsResponse' },
);

// ---- proposed blocks ----

export const ProposedBlockDto = Type.Object(
  {
    height: HeightString,
    time: Nullable(Type.String()),
    proposerAddress: Nullable(Type.String()),
    attributionStatus: Type.String(),
  },
  { $id: 'ProposedBlock' },
);
export const ProposedBlocksResponse = Type.Object(
  { data: Type.Array(ProposedBlockDto), page: PageInfoSchema },
  { $id: 'ProposedBlocksResponse' },
);

export const ListQuery = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
    cursor: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

// ---- row shapes + mappers ----

export interface CoreSlotRow {
  slotId: bigint;
  status: string | null;
  operatorAddress: string | null;
  payoutAddress: string | null;
  consensusAddress: string | null;
  consensusPubkeyJson: unknown;
  metadataJson: unknown;
  rewardWeight: string | null;
  consensusPower: bigint | null;
  createdHeight: bigint | null;
  updatedHeight: bigint;
  removedHeight: bigint | null;
  rawSnapshotJson: unknown;
}

export interface HealthRow {
  healthStatus: string;
  healthReason: string | null;
  isActiveAtLatest: boolean;
  uptimeBps: number | null;
  currentMissedStreak: number;
  summaryStatus: string | null;
}

export function toCoreSlotListItem(row: CoreSlotRow): Static<typeof CoreSlotListItem> {
  return {
    slotId: row.slotId.toString(),
    status: row.status,
    operatorAddress: row.operatorAddress,
    payoutAddress: row.payoutAddress,
    consensusAddress: row.consensusAddress,
    consensusPower: bigToString(row.consensusPower),
    rewardWeight: row.rewardWeight,
    createdHeight: bigToString(row.createdHeight),
    updatedHeight: row.updatedHeight.toString(),
    removedHeight: bigToString(row.removedHeight),
  };
}

export function toCoreSlotDetail(
  row: CoreSlotRow,
  health: HealthRow | null,
  includeRaw: boolean,
): Static<typeof CoreSlotDetail> {
  const detail: Static<typeof CoreSlotDetail> = {
    slotId: row.slotId.toString(),
    status: row.status,
    operatorAddress: row.operatorAddress,
    payoutAddress: row.payoutAddress,
    consensusAddress: row.consensusAddress,
    consensusPower: bigToString(row.consensusPower),
    rewardWeight: row.rewardWeight,
    createdHeight: bigToString(row.createdHeight),
    updatedHeight: row.updatedHeight.toString(),
    removedHeight: bigToString(row.removedHeight),
    consensusPubkey: row.consensusPubkeyJson ?? null,
    metadata: row.metadataJson ?? null,
    health: health
      ? {
          healthStatus: health.healthStatus,
          healthReason: health.healthReason,
          isActiveAtLatest: health.isActiveAtLatest,
          uptimeBps: health.uptimeBps,
          currentMissedStreak: health.currentMissedStreak,
          summaryStatus: health.summaryStatus,
        }
      : null,
  };
  if (includeRaw) {
    detail.raw = row.rawSnapshotJson ?? null;
  }
  return detail;
}

/** Internal merged-event candidate (sorting/cursor use the BigInt height/id). */
export interface EventCandidate {
  kind: EventKind;
  height: bigint;
  id: bigint;
  txHash: string | null;
  msgIndex: number | null;
  detail: unknown;
}

export function toCoreSlotEvent(c: EventCandidate): Static<typeof CoreSlotEvent> {
  return {
    kind: c.kind,
    height: c.height.toString(),
    eventId: c.id.toString(),
    txHash: c.txHash,
    msgIndex: c.msgIndex,
    detail: c.detail ?? null,
  };
}

export interface WindowRow {
  id: bigint;
  consensusAddress: string;
  operatorAddress: string | null;
  consensusPower: bigint | null;
  validatorUpdateHeight: bigint | null;
  effectiveFromHeight: bigint;
  effectiveToHeight: bigint | null;
  status: string;
  openedByKind: string;
  closedByKind: string | null;
}

export function toWindow(row: WindowRow): Static<typeof ConsensusWindowDto> {
  return {
    id: row.id.toString(),
    consensusAddress: row.consensusAddress,
    operatorAddress: row.operatorAddress,
    consensusPower: bigToString(row.consensusPower),
    validatorUpdateHeight: bigToString(row.validatorUpdateHeight),
    effectiveFromHeight: row.effectiveFromHeight.toString(),
    effectiveToHeight: bigToString(row.effectiveToHeight),
    status: row.status,
    openedByKind: row.openedByKind,
    closedByKind: row.closedByKind,
  };
}

export interface KeyRotationRow {
  id: bigint;
  status: string;
  operatorAddress: string | null;
  oldConsensusAddress: string | null;
  newConsensusAddress: string | null;
  requestedHeight: bigint | null;
  effectiveHeight: bigint | null;
  appliedHeight: bigint | null;
  cancelledHeight: bigint | null;
  reason: string | null;
  requestTxHash: string | null;
  appliedTxHash: string | null;
  cancelledTxHash: string | null;
}

export function toKeyRotation(row: KeyRotationRow): Static<typeof KeyRotationDto> {
  return {
    id: row.id.toString(),
    status: row.status,
    operatorAddress: row.operatorAddress,
    oldConsensusAddress: row.oldConsensusAddress,
    newConsensusAddress: row.newConsensusAddress,
    requestedHeight: bigToString(row.requestedHeight),
    effectiveHeight: bigToString(row.effectiveHeight),
    appliedHeight: bigToString(row.appliedHeight),
    cancelledHeight: bigToString(row.cancelledHeight),
    reason: row.reason,
    requestTxHash: row.requestTxHash,
    appliedTxHash: row.appliedTxHash,
    cancelledTxHash: row.cancelledTxHash,
  };
}

export interface ProposedBlockRow {
  height: bigint;
  proposerAddress: string | null;
  attributionStatus: string;
}

export function toProposedBlock(row: ProposedBlockRow, time: Date | null): Static<typeof ProposedBlockDto> {
  return {
    height: row.height.toString(),
    time: toIso(time),
    proposerAddress: row.proposerAddress,
    attributionStatus: row.attributionStatus,
  };
}
