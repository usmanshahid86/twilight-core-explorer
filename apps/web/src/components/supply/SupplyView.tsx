'use client';

import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Table, Td, Th, Tr } from '@/components/ui/Table';
import { QueryBoundary } from '@/components/QueryBoundary';
import { SampledAtNote } from '@/components/freshness/Freshness';
import { useStatus, useSupply } from '@/lib/api/queries';
import { deriveSampleAge } from '@/lib/freshness';
import { RewardAmount } from '@/components/rewards/RewardAmount';

/**
 * Sampled total supply (Phase 12c). Renders ONLY the observed denom -> amount sample at a sampled
 * height, with the `source:"sampled"` caveat + freshness. Deliberately NOT a computed economic
 * breakdown: no circulating / bonded / total-vs-available labels, no cap / halving / emission
 * schedule (none of which the contract exposes). Absence of a sample renders NoSample, never 0.
 */
export function SupplyView() {
  const supply = useSupply();
  const status = useStatus();

  return (
    <Card>
      <CardHeader title="Total supply (sampled)" />
      <CardBody>
        <QueryBoundary query={supply} context="Supply" loadingRows={3}>
          {(res) => {
            const latestIndexed = status.data?.data.indexer?.lastIndexedHeight ?? null;
            const age = deriveSampleAge(res.data.sampledAtHeight, latestIndexed);
            return (
              <div className="space-y-3">
                <p className="text-xs text-text-muted">
                  Observed total supply at a sampled height — not a computed economic breakdown.
                  source: <span className="font-mono">{res.data.source}</span>.
                </p>
                <Table
                  head={
                    <>
                      <Th>Denom</Th>
                      <Th>Amount</Th>
                    </>
                  }
                >
                  {/* The contract returns 200 only with a non-empty supply at a sampled height;
                      the no-sample case is a 404 (-> ErrorState/NotFound via QueryBoundary). */}
                  {res.data.supply.map((c) => (
                    <Tr key={c.denom}>
                      <Td mono>{c.denom}</Td>
                      <Td mono>
                        <RewardAmount raw={c.amount} denom={c.denom} />
                      </Td>
                    </Tr>
                  ))}
                </Table>
                <SampledAtNote sampledAtHeight={res.data.sampledAtHeight} age={age} />
              </div>
            );
          }}
        </QueryBoundary>
      </CardBody>
    </Card>
  );
}
