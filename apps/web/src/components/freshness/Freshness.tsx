import { Badge } from '@/components/ui/Badge';
import { formatHeight } from '@/lib/format/height';
import type { IndexerFreshness, ProjectionHealth, SampleAge } from '@/lib/freshness';

export function FreshnessChip({ freshness }: { freshness: IndexerFreshness }) {
  if (freshness.kind === 'unknown') {
    return <Badge tone="neutral">indexer: unknown</Badge>;
  }
  if (freshness.kind === 'fresh') {
    return <Badge tone="success">indexer current</Badge>;
  }
  return <Badge tone="warning">indexer {freshness.lagBlocks} blocks behind</Badge>;
}

export function ProjectionBadge({ health }: { health: ProjectionHealth }) {
  if (!health.failing) {
    return <Badge tone="success">projections ok</Badge>;
  }
  return <Badge tone="danger">{health.unresolvedCount} projection failure(s)</Badge>;
}

// Sample freshness for observed-sample surfaces (supply/balances/rewards).
export function SampleAgeLabel({ age }: { age: SampleAge }) {
  if (age.kind === 'none') {
    return <NoSampleLabel />;
  }
  if (age.kind === 'unknown') {
    // We have a sampled height but no latest height to compare — neutral, never "current".
    return <Badge tone="neutral">sample age unknown</Badge>;
  }
  const tone = age.kind === 'old' ? 'warning' : 'success';
  return (
    <Badge tone={tone}>
      {age.kind === 'old' ? `sample ${age.deltaBlocks} blocks behind` : 'sample current'}
    </Badge>
  );
}

// Explicit, reusable "no sample" treatment. Absence of a sample is NEVER rendered as 0 / blank.
export function NoSampleLabel() {
  return <Badge tone="neutral">no sample</Badge>;
}

// A small inline "sampled at height H" note paired with an age badge.
export function SampledAtNote({
  sampledAtHeight,
  age,
}: {
  sampledAtHeight: string | null | undefined;
  age: SampleAge;
}) {
  if (sampledAtHeight === null || sampledAtHeight === undefined || age.kind === 'none') {
    return <NoSampleLabel />;
  }
  return (
    <span className="inline-flex items-center gap-2 text-xs text-text-muted">
      <span>
        sampled at height <span className="font-mono">{formatHeight(sampledAtHeight)}</span>
      </span>
      <SampleAgeLabel age={age} />
    </span>
  );
}
