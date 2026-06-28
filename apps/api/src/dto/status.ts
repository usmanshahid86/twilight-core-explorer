import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import { HeightString, Nullable } from './common.js';
import { bigToString, toIso, ageSeconds } from '../lib/serialize.js';

const IndexerStatus = Type.Object({
  lastIndexedHeight: HeightString,
  latestChainHeight: Nullable(HeightString),
  lagBlocks: Nullable(HeightString),
  status: Type.String(),
  lastIndexedHash: Nullable(Type.String()),
  updatedAt: Type.String(),
  freshnessSeconds: Nullable(Type.Integer()),
  error: Nullable(Type.String()),
});

const ProjectionStatusSummary = Type.Object({
  projectionName: Type.String(),
  lastProjectedHeight: HeightString,
  status: Type.String(),
  updatedAt: Type.String(),
  error: Nullable(Type.String()),
});

const ProjectionFailureSummary = Type.Object({
  projectionName: Type.String(),
  count: Type.Integer(),
});

// Build/env metadata (13c). gitSha/builtAt are injected by the build/deploy and null locally.
const BuildInfo = Type.Object({
  version: Type.String(),
  gitSha: Nullable(Type.String()),
  builtAt: Nullable(Type.String()),
  // Mirrors `ApiEnv` in config.ts — keep in sync if a 4th env value is ever added.
  environment: Type.Union([
    Type.Literal('production'),
    Type.Literal('development'),
    Type.Literal('test'),
  ]),
});

export const ApiStatusResponse = Type.Object(
  {
    data: Type.Object({
      chainId: Nullable(Type.String()),
      build: BuildInfo,
      indexer: Nullable(IndexerStatus),
      projections: Type.Array(ProjectionStatusSummary),
      projectionFailures: Type.Object({
        unresolvedCount: Type.Integer(),
        byProjection: Type.Array(ProjectionFailureSummary),
      }),
    }),
  },
  { $id: 'ApiStatusResponse' },
);

// ----- mappers (BigInt -> string at this boundary) -----

interface IndexerCursorRow {
  chainId: string;
  lastIndexedHeight: bigint;
  latestChainHeight: bigint | null;
  status: string;
  lastIndexedHash: string | null;
  updatedAt: Date;
  error: string | null;
}

interface ProjectionCursorRow {
  projectionName: string;
  lastProjectedHeight: bigint;
  status: string;
  updatedAt: Date;
  error: string | null;
}

export type IndexerStatusDto = Static<typeof IndexerStatus>;

export function toIndexerStatus(row: IndexerCursorRow, now: number = Date.now()): IndexerStatusDto {
  const lag =
    row.latestChainHeight === null ? null : bigToString(row.latestChainHeight - row.lastIndexedHeight);
  return {
    lastIndexedHeight: row.lastIndexedHeight.toString(),
    latestChainHeight: bigToString(row.latestChainHeight),
    lagBlocks: lag,
    status: row.status,
    lastIndexedHash: row.lastIndexedHash,
    updatedAt: toIso(row.updatedAt) ?? '',
    freshnessSeconds: ageSeconds(row.updatedAt, now),
    error: row.error,
  };
}

export function toProjectionStatus(row: ProjectionCursorRow): Static<typeof ProjectionStatusSummary> {
  return {
    projectionName: row.projectionName,
    lastProjectedHeight: row.lastProjectedHeight.toString(),
    status: row.status,
    updatedAt: toIso(row.updatedAt) ?? '',
    error: row.error,
  };
}
