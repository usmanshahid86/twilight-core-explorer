import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import { HeightString, Nullable } from './common.js';
import { toIso } from '../lib/serialize.js';

// Per-projection diagnostics: cursor state + unresolved-failure breakdown by kind. Deeper than
// /status; reads ONLY ProjectionCursor + ProjectionFailure (never raw signature/liveness evidence).
export const ProjectionDiagnostic = Type.Object(
  {
    projectionName: Type.String(),
    lastProjectedHeight: HeightString,
    status: Type.String(),
    updatedAt: Type.String(),
    error: Nullable(Type.String()),
    unresolvedFailures: Type.Object({
      count: Type.Integer(),
      byKind: Type.Array(Type.Object({ failureKind: Type.String(), count: Type.Integer() })),
    }),
  },
  { $id: 'ProjectionDiagnostic' },
);

export const ProjectionsResponse = Type.Object(
  { data: Type.Array(ProjectionDiagnostic) },
  { $id: 'ProjectionsResponse' },
);

export interface ProjectionCursorRow {
  projectionName: string;
  lastProjectedHeight: bigint;
  status: string;
  updatedAt: Date;
  error: string | null;
}

export interface FailureKindCount {
  projectionName: string;
  failureKind: string;
  count: number;
}

export function toProjectionDiagnostic(
  row: ProjectionCursorRow,
  failures: FailureKindCount[],
): Static<typeof ProjectionDiagnostic> {
  const mine = failures.filter((f) => f.projectionName === row.projectionName);
  return {
    projectionName: row.projectionName,
    lastProjectedHeight: row.lastProjectedHeight.toString(),
    status: row.status,
    updatedAt: toIso(row.updatedAt) ?? '',
    error: row.error,
    unresolvedFailures: {
      count: mine.reduce((sum, f) => sum + f.count, 0),
      byKind: mine.map((f) => ({ failureKind: f.failureKind, count: f.count })),
    },
  };
}
