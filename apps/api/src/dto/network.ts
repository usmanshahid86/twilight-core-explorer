import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import { HeightString, Nullable } from './common.js';
import { bigToString } from '../lib/serialize.js';

// ---- proposer leaderboard ----

export const ProposerLeaderboardItem = Type.Object(
  {
    slotId: HeightString,
    operatorAddress: Nullable(Type.String()),
    blocksProposed: Type.Integer(),
  },
  { $id: 'ProposerLeaderboardItem' },
);
export const ProposerLeaderboardResponse = Type.Object(
  { data: Type.Array(ProposerLeaderboardItem) },
  { $id: 'ProposerLeaderboardResponse' },
);

// ---- validator set at height ----

export const ValidatorSetMember = Type.Object(
  {
    slotId: HeightString,
    consensusAddress: Type.String(),
    operatorAddress: Nullable(Type.String()),
    consensusPower: Nullable(HeightString),
    effectiveFromHeight: HeightString,
    effectiveToHeight: Nullable(HeightString),
  },
  { $id: 'ValidatorSetMember' },
);
export const ValidatorSetResponse = Type.Object(
  { data: Type.Array(ValidatorSetMember) },
  { $id: 'ValidatorSetResponse' },
);
export const ValidatorSetQuery = Type.Object(
  { height: Type.String({ pattern: '^\\d+$' }) },
  { additionalProperties: false },
);

// ---- network liveness risk ----

export const NetworkRiskDto = Type.Object(
  {
    haltRiskLevel: Type.String(),
    haltRiskReason: Nullable(Type.String()),
    latestCommittedHeight: Nullable(HeightString),
    activeSlotCount: Type.Integer(),
    healthySlotCount: Type.Integer(),
    degradedSlotCount: Type.Integer(),
    downSlotCount: Type.Integer(),
    incompleteSlotCount: Type.Integer(),
    unknownSlotCount: Type.Integer(),
    availableSlotCount: Type.Integer(),
    unavailableSlotCount: Type.Integer(),
    availablePowerBps: Nullable(Type.Integer()),
    unavailablePowerBps: Nullable(Type.Integer()),
    policyVersion: Type.String(),
  },
  { $id: 'NetworkRisk' },
);
export const NetworkRiskResponse = Type.Object({ data: NetworkRiskDto }, { $id: 'NetworkRiskResponse' });

// ---- mappers ----

export function toProposerLeaderboardItem(row: {
  slotId: bigint;
  operatorAddress: string | null;
  blocksProposed: number;
}): Static<typeof ProposerLeaderboardItem> {
  return {
    slotId: row.slotId.toString(),
    operatorAddress: row.operatorAddress,
    blocksProposed: row.blocksProposed,
  };
}

export interface ValidatorWindowRow {
  slotId: bigint;
  consensusAddress: string;
  operatorAddress: string | null;
  consensusPower: bigint | null;
  effectiveFromHeight: bigint;
  effectiveToHeight: bigint | null;
}

export function toValidatorSetMember(row: ValidatorWindowRow): Static<typeof ValidatorSetMember> {
  return {
    slotId: row.slotId.toString(),
    consensusAddress: row.consensusAddress,
    operatorAddress: row.operatorAddress,
    consensusPower: bigToString(row.consensusPower),
    effectiveFromHeight: row.effectiveFromHeight.toString(),
    effectiveToHeight: bigToString(row.effectiveToHeight),
  };
}

export interface NetworkRiskRow {
  haltRiskLevel: string;
  haltRiskReason: string | null;
  latestCommittedHeight: bigint | null;
  activeSlotCount: number;
  healthySlotCount: number;
  degradedSlotCount: number;
  downSlotCount: number;
  incompleteSlotCount: number;
  unknownSlotCount: number;
  availableSlotCount: number;
  unavailableSlotCount: number;
  availablePowerBps: number | null;
  unavailablePowerBps: number | null;
  policyVersion: string;
}

export function toNetworkRisk(row: NetworkRiskRow): Static<typeof NetworkRiskDto> {
  return {
    haltRiskLevel: row.haltRiskLevel,
    haltRiskReason: row.haltRiskReason,
    latestCommittedHeight: bigToString(row.latestCommittedHeight),
    activeSlotCount: row.activeSlotCount,
    healthySlotCount: row.healthySlotCount,
    degradedSlotCount: row.degradedSlotCount,
    downSlotCount: row.downSlotCount,
    incompleteSlotCount: row.incompleteSlotCount,
    unknownSlotCount: row.unknownSlotCount,
    availableSlotCount: row.availableSlotCount,
    unavailableSlotCount: row.unavailableSlotCount,
    availablePowerBps: row.availablePowerBps,
    unavailablePowerBps: row.unavailablePowerBps,
    policyVersion: row.policyVersion,
  };
}
