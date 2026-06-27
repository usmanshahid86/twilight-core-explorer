'use client';

import Link from 'next/link';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { PaginatedTable, type Column } from '@/components/list/PaginatedTable';
import { MonoCopy } from '@/components/ui/MonoCopy';
import { formatHeight } from '@/lib/format/height';
import { shortenMiddle } from '@/lib/format/address';
import {
  useRewardsClaims,
  type ClaimsFilter,
  type RewardsClaimsResponse,
} from '@/lib/api/queries';
import { RewardAmount } from '../RewardAmount';
import { RewardCaveat } from '../RewardCaveat';

type Claim = RewardsClaimsResponse['data'][number];

/** `filter` (slotId/claimant) powers cross-links; no filter UI is rendered (deferred). */
export function ClaimsSection({ filter }: { filter?: ClaimsFilter }) {
  const query = useRewardsClaims(filter ?? {});
  const firstRow = query.data?.pages[0]?.data[0];

  const columns: Column<Claim>[] = [
    {
      header: 'Slot',
      mono: true,
      cell: (c) => (
        <Link
          href={`/coreslots/${encodeURIComponent(c.slotId)}`}
          className="text-primary hover:text-primary-light"
        >
          {c.slotId}
        </Link>
      ),
    },
    { header: 'Claimant', cell: (c) => <MonoCopy value={c.claimant} label="claimant" /> },
    { header: 'Amount', cell: (c) => <RewardAmount raw={c.amount} denom={c.denom} /> },
    {
      // Epoch ordinals render verbatim (no thousands grouping) — consistent with EpochsSection /
      // RewardEpochDetail; formatHeight is for block heights, not epoch numbers.
      header: 'Epochs',
      mono: true,
      cell: (c) => `${c.startEpoch ?? '—'} → ${c.endEpoch ?? '—'}`,
    },
    { header: 'Height', mono: true, cell: (c) => formatHeight(c.height) },
    {
      header: 'Tx',
      mono: true,
      cell: (c) => (
        <Link
          href={`/txs/${encodeURIComponent(c.txHash)}`}
          className="font-mono text-primary hover:text-primary-light"
          title={c.txHash}
        >
          {shortenMiddle(c.txHash)}
        </Link>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader title="Claims (history)" />
      <CardBody>
        {firstRow ? (
          <RewardCaveat>
            productionClaimReadiness:{' '}
            <span className="font-mono">{firstRow.productionClaimReadiness}</span>; claimSemantics:{' '}
            <span className="font-mono">{firstRow.claimSemantics}</span> — historical claim events;
            the explorer performs no claim action.
          </RewardCaveat>
        ) : null}
        <PaginatedTable
          query={query}
          columns={columns}
          rowKey={(c) => c.id}
          context="Claims"
          emptyMessage="No claim events recorded."
        />
      </CardBody>
    </Card>
  );
}
