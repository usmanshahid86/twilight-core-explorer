'use client';

import { PaginatedTable, type Column } from '@/components/list/PaginatedTable';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useCoreSlotRewards, type CoreSlotRewardsResponse } from '@/lib/api/queries';
import { formatAmount } from '@/lib/format/amount';
import { formatHeight } from '@/lib/format/height';
import { RewardCaveat } from '@/components/rewards/RewardCaveat';

type Reward = CoreSlotRewardsResponse['data'][number];

// Small CAVEATED rewards subsection (allowed in Phase 11). Full rewards economics is Phase 12.
// The caveat text is sourced from the contract fields on the rows — never implied or invented.
export function CoreSlotRewardsSection({ slotId }: { slotId: string }) {
  const query = useCoreSlotRewards(slotId);
  const firstRow = query.data?.pages[0]?.data[0];

  const columns: Column<Reward>[] = [
    { header: 'Epoch', mono: true, cell: (r) => r.epochNumber },
    {
      header: 'Amount',
      mono: true,
      cell: (r) => {
        const a = formatAmount(r.amount, r.denom);
        return `${a.display} ${a.symbol}`;
      },
    },
    {
      header: 'Claimed (observed)',
      cell: (r) =>
        r.claimed ? (
          <Badge tone="neutral">observed @ {formatHeight(r.claimedAtHeight)}</Badge>
        ) : (
          <span className="text-text-muted">—</span>
        ),
    },
    { header: 'Sampled at', mono: true, cell: (r) => formatHeight(r.sampledAtHeight) },
  ];

  return (
    <Card>
      <CardHeader title="Rewards (observed projection)" />
      <CardBody>
        {firstRow ? (
          <RewardCaveat>
            Observed/historical projection — <span className="font-medium">not live-claimable</span>.
            claimSemantics: <span className="font-mono">{firstRow.claimSemantics}</span>; production claim
            readiness: <span className="font-mono">{firstRow.productionClaimReadiness}</span>.
          </RewardCaveat>
        ) : null}
        <PaginatedTable
          query={query}
          columns={columns}
          rowKey={(r) => r.epochNumber}
          context="Rewards"
          emptyMessage="No rewards recorded for this slot."
        />
      </CardBody>
    </Card>
  );
}
