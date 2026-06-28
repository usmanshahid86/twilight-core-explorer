'use client';

import { QueryBoundary } from '@/components/QueryBoundary';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { SampledAtNote } from '@/components/freshness/Freshness';
import { useStatus, useSupply } from '@/lib/api/queries';
import { deriveSampleAge } from '@/lib/freshness';
import { formatAmount } from '@/lib/format/amount';

export function SupplyPanel() {
  const supply = useSupply();
  const status = useStatus();
  return (
    <Card>
      <CardHeader title="Supply (sampled)" href="/supply" linkLabel="Supply detail" />
      <CardBody>
        <QueryBoundary query={supply} context="Supply" loadingRows={2}>
          {(res) => {
            const utwlt = res.data.supply.find((c) => c.denom === 'utwlt');
            const latestIndexed = status.data?.data.indexer?.lastIndexedHeight ?? null;
            const age = deriveSampleAge(res.data.sampledAtHeight, latestIndexed);
            const amount = utwlt ? formatAmount(utwlt.amount, utwlt.denom) : null;
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <StatCard
                    label="Total supply"
                    value={amount ? `${amount.display} ${amount.symbol}` : '—'}
                    hint={amount ? `${amount.raw} ${amount.rawDenom}` : 'no utwlt sample'}
                    mono
                  />
                  <StatCard
                    label="Other denoms"
                    value={Math.max(0, res.data.supply.length - (utwlt ? 1 : 0))}
                    mono
                  />
                </div>
                <SampledAtNote sampledAtHeight={res.data.sampledAtHeight} age={age} />
              </div>
            );
          }}
        </QueryBoundary>
      </CardBody>
    </Card>
  );
}
