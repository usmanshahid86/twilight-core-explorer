'use client';

import Link from 'next/link';
import { PaginatedTable, type Column } from '@/components/list/PaginatedTable';
import { MonoCopy } from '@/components/ui/MonoCopy';
import { useBlocksList, type BlocksResponse } from '@/lib/api/queries';
import { formatHeight } from '@/lib/format/height';
import { formatRelativeTime } from '@/lib/format/time';

type Block = BlocksResponse['data'][number];

export function BlocksList() {
  const query = useBlocksList();
  const columns: Column<Block>[] = [
    {
      header: 'Height',
      mono: true,
      cell: (b) => (
        <Link href={`/blocks/${encodeURIComponent(b.height)}`} className="text-primary hover:text-primary-light">
          {formatHeight(b.height)}
        </Link>
      ),
    },
    { header: 'Age', cell: (b) => formatRelativeTime(b.time) },
    { header: 'Txs', mono: true, cell: (b) => b.txCount },
    {
      header: 'Proposer',
      cell: (b) => (
        <MonoCopy
          value={b.proposer.operatorAddress ?? b.proposer.address ?? b.proposer.rawAddress}
          label="proposer"
        />
      ),
    },
  ];
  return (
    <PaginatedTable
      query={query}
      columns={columns}
      rowKey={(b) => b.height}
      context="Blocks"
      emptyMessage="No blocks indexed yet."
    />
  );
}
