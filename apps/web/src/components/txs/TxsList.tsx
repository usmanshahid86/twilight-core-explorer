'use client';

import Link from 'next/link';
import { PaginatedTable, type Column } from '@/components/list/PaginatedTable';
import { Badge } from '@/components/ui/Badge';
import { CopyButton } from '@/components/ui/CopyButton';
import { useTxsList, type TxsResponse } from '@/lib/api/queries';
import { formatHeight } from '@/lib/format/height';
import { statusTone } from '@/lib/format/status';
import { shortenMiddle } from '@/lib/format/address';

type Tx = TxsResponse['data'][number];

export function TxsList() {
  const query = useTxsList();
  const columns: Column<Tx>[] = [
    {
      header: 'Hash',
      cell: (t) => (
        <span className="inline-flex items-center gap-1.5">
          <Link
            href={`/txs/${encodeURIComponent(t.hash)}`}
            className="font-mono text-primary hover:text-primary-light"
          >
            {shortenMiddle(t.hash)}
          </Link>
          <CopyButton value={t.hash} label="tx hash" />
        </span>
      ),
    },
    {
      header: 'Height',
      mono: true,
      cell: (t) => (
        <Link href={`/blocks/${encodeURIComponent(t.height)}`} className="text-primary hover:text-primary-light">
          {formatHeight(t.height)}
        </Link>
      ),
    },
    { header: 'Index', mono: true, cell: (t) => t.index },
    { header: 'Type', cell: (t) => t.messageTypes[0] ?? '—' },
    { header: 'Status', cell: (t) => <Badge tone={statusTone(t.status)}>{t.status}</Badge> },
  ];
  return (
    <PaginatedTable
      query={query}
      columns={columns}
      rowKey={(t) => t.hash}
      context="Transactions"
      emptyMessage="No transactions indexed yet."
    />
  );
}
