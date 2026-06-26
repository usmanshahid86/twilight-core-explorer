'use client';

import { QueryBoundary } from '@/components/QueryBoundary';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { FreshnessChip, ProjectionBadge } from '@/components/freshness/Freshness';
import { useProjections, useStatus } from '@/lib/api/queries';
import { deriveIndexerFreshness, deriveProjectionHealth } from '@/lib/freshness';
import { formatHeight } from '@/lib/format/height';
import { statusTone } from '@/lib/format/status';

export function ChainStatusPanel() {
  const query = useStatus();
  return (
    <Card>
      <CardHeader title="Chain status" />
      <CardBody>
        <QueryBoundary query={query} context="Chain status" loadingRows={2}>
          {(res) => {
            const indexer = res.data.indexer;
            return (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatCard label="Chain ID" value={res.data.chainId ?? '—'} />
                <StatCard
                  label="Latest indexed"
                  value={formatHeight(indexer?.lastIndexedHeight)}
                  mono
                />
                <StatCard
                  label="Chain tip"
                  value={formatHeight(indexer?.latestChainHeight)}
                  mono
                  hint={
                    indexer ? (
                      <Badge tone={statusTone(indexer.status)}>{indexer.status}</Badge>
                    ) : (
                      <Badge tone="neutral">unknown</Badge>
                    )
                  }
                />
              </div>
            );
          }}
        </QueryBoundary>
      </CardBody>
    </Card>
  );
}

export function IndexerFreshnessPanel() {
  const statusQuery = useStatus();
  const projectionsQuery = useProjections();
  return (
    <Card>
      <CardHeader title="Indexer & projection freshness" />
      <CardBody className="space-y-3">
        <QueryBoundary query={statusQuery} context="Indexer freshness" loadingRows={2}>
          {(res) => {
            const freshness = deriveIndexerFreshness(res.data.indexer);
            const health = deriveProjectionHealth(res.data.projectionFailures);
            return (
              <div className="flex flex-wrap items-center gap-2">
                <FreshnessChip freshness={freshness} />
                <ProjectionBadge health={health} />
                {res.data.indexer?.freshnessSeconds !== null &&
                res.data.indexer?.freshnessSeconds !== undefined ? (
                  <Badge tone="neutral">{res.data.indexer.freshnessSeconds}s since last block</Badge>
                ) : null}
              </div>
            );
          }}
        </QueryBoundary>
        <QueryBoundary query={projectionsQuery} context="Projections" loadingRows={2}>
          {(res) => (
            <div className="text-xs text-text-muted">
              {res.data.length} projection(s) tracked
              {res.data.some((p) => p.error !== null)
                ? ' — one or more reporting an error'
                : ' — all reporting clean'}
              .
            </div>
          )}
        </QueryBoundary>
      </CardBody>
    </Card>
  );
}
