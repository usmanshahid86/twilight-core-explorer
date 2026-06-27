'use client';

import { QueryBoundary } from '@/components/QueryBoundary';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { useCoreSlotHealth } from '@/lib/api/queries';
import { statusTone } from '@/lib/format/status';
import { bpsToPercent } from '@/lib/format/bps';
import { formatHeight } from '@/lib/format/height';

// Reusable: CoreSlot detail + (Phase 11c) Operator page both render this by slotId.
export function CoreSlotHealthSection({ slotId }: { slotId: string }) {
  const query = useCoreSlotHealth(slotId);
  return (
    <Card>
      <CardHeader title="Health" />
      <CardBody>
        <QueryBoundary query={query} context="Health" loadingRows={3}>
          {(res) => {
            const h = res.data;
            return (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(h.healthStatus)}>{h.healthStatus}</Badge>
                  <Badge tone={h.isActiveAtLatest ? 'success' : 'neutral'}>
                    {h.isActiveAtLatest ? 'active at latest' : 'inactive at latest'}
                  </Badge>
                  {h.healthReason ? <span className="text-xs text-text-muted">{h.healthReason}</span> : null}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatCard label="Uptime" value={bpsToPercent(h.uptimeBps)} mono />
                  <StatCard label="Lifetime" value={bpsToPercent(h.lifetimeUptimeBps)} mono />
                  <StatCard label="Recent 500" value={bpsToPercent(h.recent500UptimeBps)} mono />
                  <StatCard label="Recent 1000" value={bpsToPercent(h.recent1000UptimeBps)} mono />
                  <StatCard label="Signed / expected" value={`${h.signedCount} / ${h.expectedCount}`} mono />
                  <StatCard label="Missed (absent/nil)" value={`${h.missedCount} (${h.absentMissedCount}/${h.nilMissedCount})`} mono />
                  <StatCard label="Signed streak" value={h.currentSignedStreak} mono />
                  <StatCard label="Missed streak" value={h.currentMissedStreak} mono />
                </div>
                <div className="text-xs text-text-muted">
                  primary window: {h.primaryWindowKind} · last committed{' '}
                  <span className="font-mono">{formatHeight(h.lastCommittedHeight)}</span> · policy{' '}
                  {h.policyVersion}
                </div>
              </div>
            );
          }}
        </QueryBoundary>
      </CardBody>
    </Card>
  );
}
