import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import { HeightString, Nullable } from './common.js';
import { bigToString } from '../lib/serialize.js';

// Liveness summaries + the current health snapshot. All status strings pass through verbatim — the
// API never reinterprets 8c policy. Window kinds: lifetime, recent_100, recent_500, recent_1000.

export const LivenessSummaryDto = Type.Object(
  {
    windowKind: Type.String(),
    windowSize: Nullable(Type.Integer()),
    operatorAddress: Nullable(Type.String()),
    consensusAddress: Nullable(Type.String()),
    firstCommittedHeight: Nullable(HeightString),
    lastCommittedHeight: Nullable(HeightString),
    spanHeightCount: Nullable(HeightString),
    evidenceHeightCount: Type.Integer(),
    expectedCount: Type.Integer(),
    signedCount: Type.Integer(),
    missedCount: Type.Integer(),
    absentMissedCount: Type.Integer(),
    nilMissedCount: Type.Integer(),
    uptimeBps: Nullable(Type.Integer()),
    currentSignedStreak: Type.Integer(),
    currentMissedStreak: Type.Integer(),
    latestMissedHeight: Nullable(HeightString),
    invalidHeightCount: Type.Integer(),
    summaryStatus: Type.String(),
  },
  { $id: 'LivenessSummary' },
);

export const LivenessResponse = Type.Object(
  { data: Type.Array(LivenessSummaryDto) },
  { $id: 'LivenessResponse' },
);
export const LivenessQuery = Type.Object(
  { windowKind: Type.Optional(Type.String()) },
  { additionalProperties: false },
);

export const CoreSlotHealthDto = Type.Object(
  {
    slotId: HeightString,
    healthStatus: Type.String(),
    healthReason: Nullable(Type.String()),
    isActiveAtLatest: Type.Boolean(),
    primaryWindowKind: Type.String(),
    expectedCount: Type.Integer(),
    signedCount: Type.Integer(),
    missedCount: Type.Integer(),
    absentMissedCount: Type.Integer(),
    nilMissedCount: Type.Integer(),
    uptimeBps: Nullable(Type.Integer()),
    lifetimeUptimeBps: Nullable(Type.Integer()),
    recent500UptimeBps: Nullable(Type.Integer()),
    recent1000UptimeBps: Nullable(Type.Integer()),
    currentSignedStreak: Type.Integer(),
    currentMissedStreak: Type.Integer(),
    latestMissedHeight: Nullable(HeightString),
    firstCommittedHeight: Nullable(HeightString),
    lastCommittedHeight: Nullable(HeightString),
    summaryStatus: Nullable(Type.String()),
    invalidHeightCount: Type.Integer(),
    policyVersion: Type.String(),
  },
  { $id: 'CoreSlotHealth' },
);
export const CoreSlotHealthResponse = Type.Object(
  { data: CoreSlotHealthDto },
  { $id: 'CoreSlotHealthResponse' },
);

export interface LivenessSummaryRow {
  windowKind: string;
  windowSize: number | null;
  operatorAddress: string | null;
  consensusAddress: string | null;
  firstCommittedHeight: bigint | null;
  lastCommittedHeight: bigint | null;
  spanHeightCount: bigint | null;
  evidenceHeightCount: number;
  expectedCount: number;
  signedCount: number;
  missedCount: number;
  absentMissedCount: number;
  nilMissedCount: number;
  uptimeBps: number | null;
  currentSignedStreak: number;
  currentMissedStreak: number;
  latestMissedHeight: bigint | null;
  invalidHeightCount: number;
  summaryStatus: string;
}

export function toLivenessSummary(row: LivenessSummaryRow): Static<typeof LivenessSummaryDto> {
  return {
    windowKind: row.windowKind,
    windowSize: row.windowSize,
    operatorAddress: row.operatorAddress,
    consensusAddress: row.consensusAddress,
    firstCommittedHeight: bigToString(row.firstCommittedHeight),
    lastCommittedHeight: bigToString(row.lastCommittedHeight),
    spanHeightCount: bigToString(row.spanHeightCount),
    evidenceHeightCount: row.evidenceHeightCount,
    expectedCount: row.expectedCount,
    signedCount: row.signedCount,
    missedCount: row.missedCount,
    absentMissedCount: row.absentMissedCount,
    nilMissedCount: row.nilMissedCount,
    uptimeBps: row.uptimeBps,
    currentSignedStreak: row.currentSignedStreak,
    currentMissedStreak: row.currentMissedStreak,
    latestMissedHeight: bigToString(row.latestMissedHeight),
    invalidHeightCount: row.invalidHeightCount,
    summaryStatus: row.summaryStatus,
  };
}

export interface HealthSnapshotRow {
  slotId: bigint;
  healthStatus: string;
  healthReason: string | null;
  isActiveAtLatest: boolean;
  primaryWindowKind: string;
  expectedCount: number;
  signedCount: number;
  missedCount: number;
  absentMissedCount: number;
  nilMissedCount: number;
  uptimeBps: number | null;
  lifetimeUptimeBps: number | null;
  recent500UptimeBps: number | null;
  recent1000UptimeBps: number | null;
  currentSignedStreak: number;
  currentMissedStreak: number;
  latestMissedHeight: bigint | null;
  firstCommittedHeight: bigint | null;
  lastCommittedHeight: bigint | null;
  summaryStatus: string | null;
  invalidHeightCount: number;
  policyVersion: string;
}

export function toCoreSlotHealth(row: HealthSnapshotRow): Static<typeof CoreSlotHealthDto> {
  return {
    slotId: row.slotId.toString(),
    healthStatus: row.healthStatus,
    healthReason: row.healthReason,
    isActiveAtLatest: row.isActiveAtLatest,
    primaryWindowKind: row.primaryWindowKind,
    expectedCount: row.expectedCount,
    signedCount: row.signedCount,
    missedCount: row.missedCount,
    absentMissedCount: row.absentMissedCount,
    nilMissedCount: row.nilMissedCount,
    uptimeBps: row.uptimeBps,
    lifetimeUptimeBps: row.lifetimeUptimeBps,
    recent500UptimeBps: row.recent500UptimeBps,
    recent1000UptimeBps: row.recent1000UptimeBps,
    currentSignedStreak: row.currentSignedStreak,
    currentMissedStreak: row.currentMissedStreak,
    latestMissedHeight: bigToString(row.latestMissedHeight),
    firstCommittedHeight: bigToString(row.firstCommittedHeight),
    lastCommittedHeight: bigToString(row.lastCommittedHeight),
    summaryStatus: row.summaryStatus,
    invalidHeightCount: row.invalidHeightCount,
    policyVersion: row.policyVersion,
  };
}
