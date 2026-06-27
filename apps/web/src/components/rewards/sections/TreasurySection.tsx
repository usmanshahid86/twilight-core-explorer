'use client';

import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { PaginatedTable, type Column } from '@/components/list/PaginatedTable';
import { MonoCopy } from '@/components/ui/MonoCopy';
import { formatHeight } from '@/lib/format/height';
import { useRewardsTreasury, type RewardsTreasuryResponse } from '@/lib/api/queries';
import { RewardAmount } from '../RewardAmount';

type Payment = RewardsTreasuryResponse['data'][number];

export function TreasurySection() {
  const query = useRewardsTreasury();

  const columns: Column<Payment>[] = [
    { header: 'Recipient', cell: (p) => <MonoCopy value={p.recipient} label="recipient" /> },
    { header: 'Amount', cell: (p) => <RewardAmount raw={p.amount} denom={p.denom} /> },
    {
      header: 'Purpose',
      cell: (p) => p.purpose ?? <span className="text-text-muted">—</span>,
    },
    { header: 'Height', mono: true, cell: (p) => formatHeight(p.height) },
  ];

  return (
    <Card>
      <CardHeader title="Treasury payments" />
      <CardBody>
        <PaginatedTable
          query={query}
          columns={columns}
          rowKey={(p) => p.id}
          context="Treasury payments"
          emptyMessage="No treasury payments recorded."
        />
      </CardBody>
    </Card>
  );
}
