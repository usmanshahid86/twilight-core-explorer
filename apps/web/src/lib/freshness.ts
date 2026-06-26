// The Phase 10 freshness model: distinguish API-unavailable / indexer-lagging / projection-failing /
// sample-old / no-sample. All height math is BigInt/string (never Number). Sources: /api/v1/status,
// /api/v1/projections, and `sampledAtHeight` on samples.
import type { StatusResponse } from './api/queries';

export type StatusData = StatusResponse['data'];

const LAG_BLOCK_THRESHOLD = 5n;
const SAMPLE_OLD_THRESHOLD = 50n;

export type IndexerFreshness =
  | { kind: 'unknown' }
  | { kind: 'fresh'; lagBlocks: string; freshnessSeconds: number | null }
  | { kind: 'lagging'; lagBlocks: string; freshnessSeconds: number | null };

export function deriveIndexerFreshness(indexer: StatusData['indexer']): IndexerFreshness {
  if (indexer === null) return { kind: 'unknown' };
  const lag = indexer.lagBlocks;
  if (lag === null || !/^\d+$/.test(lag)) return { kind: 'unknown' };
  const lagging = BigInt(lag) > LAG_BLOCK_THRESHOLD;
  const base = { lagBlocks: lag, freshnessSeconds: indexer.freshnessSeconds };
  return lagging ? { kind: 'lagging', ...base } : { kind: 'fresh', ...base };
}

export type ProjectionHealth = { failing: boolean; unresolvedCount: number };

export function deriveProjectionHealth(failures: StatusData['projectionFailures']): ProjectionHealth {
  return { failing: failures.unresolvedCount > 0, unresolvedCount: failures.unresolvedCount };
}

// Sample freshness: compare an observed sample's height to the latest indexed height.
export type SampleAge =
  | { kind: 'none' }
  | { kind: 'fresh'; deltaBlocks: string }
  | { kind: 'old'; deltaBlocks: string };

export function deriveSampleAge(
  sampledAtHeight: string | null | undefined,
  latestIndexedHeight: string | null | undefined,
): SampleAge {
  if (!sampledAtHeight || !/^\d+$/.test(sampledAtHeight)) return { kind: 'none' };
  if (!latestIndexedHeight || !/^\d+$/.test(latestIndexedHeight)) {
    return { kind: 'fresh', deltaBlocks: '0' };
  }
  const raw = BigInt(latestIndexedHeight) - BigInt(sampledAtHeight);
  const delta = raw < 0n ? 0n : raw;
  return delta > SAMPLE_OLD_THRESHOLD
    ? { kind: 'old', deltaBlocks: delta.toString() }
    : { kind: 'fresh', deltaBlocks: delta.toString() };
}
