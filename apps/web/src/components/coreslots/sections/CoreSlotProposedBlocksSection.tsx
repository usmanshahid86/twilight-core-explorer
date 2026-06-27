'use client';

import Link from 'next/link';
import { PaginatedTable, type Column } from '@/components/list/PaginatedTable';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useCoreSlotProposedBlocks, type CoreSlotProposedBlocksResponse } from '@/lib/api/queries';
import { formatHeight } from '@/lib/format/height';
import { formatRelativeTime } from '@/lib/format/time';
import { statusTone } from '@/lib/format/status';

type Row = CoreSlotProposedBlocksResponse['data'][number];

export function CoreSlotProposedBlocksSection({ slotId }: { slotId: string }) {
  const query = useCoreSlotProposedBlocks(slotId);
  const columns: Column<Row>[] = [
    {
      header: 'Height',
      mono: true,
      cell: (r) => (
        <Link href={`/blocks/${encodeURIComponent(r.height)}`} className="text-primary hover:text-primary-light">
          {formatHeight(r.height)}
        </Link>
      ),
    },
    { header: 'Age', cell: (r) => formatRelativeTime(r.time) },
    { header: 'Attribution', cell: (r) => <Badge tone={statusTone(r.attributionStatus)}>{r.attributionStatus}</Badge> },
  ];
  return (
    <Card>
      <CardHeader title="Proposed blocks" />
      <CardBody>
        <PaginatedTable
          query={query}
          columns={columns}
          rowKey={(r) => r.height}
          context="Proposed blocks"
          emptyMessage="No blocks proposed by this slot."
        />
      </CardBody>
    </Card>
  );
}
