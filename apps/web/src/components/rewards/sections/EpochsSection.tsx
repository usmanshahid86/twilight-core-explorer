'use client';

import Link from 'next/link';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { PaginatedTable, type Column } from '@/components/list/PaginatedTable';
import { formatHeight } from '@/lib/format/height';
import { formatAbsoluteTime } from '@/lib/format/time';
import { useRewardsEpochs, type RewardsEpochsResponse } from '@/lib/api/queries';
import { RewardAmount } from '../RewardAmount';
import { RewardCaveat } from '../RewardCaveat';

type Epoch = RewardsEpochsResponse['data'][number];

export function EpochsSection() {
  const query = useRewardsEpochs();
  const firstRow = query.data?.pages[0]?.data[0];

  const columns: Column<Epoch>[] = [
    {
      header: 'Epoch',
      mono: true,
      cell: (e) => (
        <Link
          href={`/rewards/epochs/${encodeURIComponent(e.epochNumber)}`}
          className="text-primary hover:text-primary-light"
        >
          {e.epochNumber}
        </Link>
      ),
    },
    { header: 'Height', mono: true, cell: (e) => formatHeight(e.height) },
    { header: 'Time', cell: (e) => formatAbsoluteTime(e.blockTime) },
    { header: 'Total reward', cell: (e) => <RewardAmount raw={e.totalReward} denom={e.denom} /> },
    {
      header: 'Active slots',
      mono: true,
      cell: (e) => (e.activeSlotCount ?? '—'),
    },
    {
      header: 'Cumulative emitted',
      cell: (e) => <RewardAmount raw={e.cumulativeEmitted} denom={e.denom} />,
    },
    {
      header: 'Distribution',
      cell: (e) => e.distributionMethod ?? <span className="text-text-muted">—</span>,
    },
  ];

  return (
    <Card>
      <CardHeader title="Epochs" />
      <CardBody>
        {firstRow ? (
          <RewardCaveat>
            rewardSemantics: <span className="font-mono">{firstRow.rewardSemantics}</span> —
            aggregate network-emission context, not claim truth.
          </RewardCaveat>
        ) : null}
        <PaginatedTable
          query={query}
          columns={columns}
          rowKey={(e) => e.epochNumber}
          context="Epochs"
          emptyMessage="No finalized epochs yet."
        />
      </CardBody>
    </Card>
  );
}
