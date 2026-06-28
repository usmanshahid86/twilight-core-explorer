'use client';

import Link from 'next/link';
import { PaginatedTable, type Column } from '@/components/list/PaginatedTable';
import { Badge } from '@/components/ui/Badge';
import { CopyButton } from '@/components/ui/CopyButton';
import { useAccountsList, type AccountsResponse } from '@/lib/api/queries';
import { formatHeight } from '@/lib/format/height';
import { shortenMiddle } from '@/lib/format/address';

type Account = AccountsResponse['data'][number];

export function AccountsList() {
  const query = useAccountsList();
  const columns: Column<Account>[] = [
    {
      header: 'Address',
      cell: (a) => (
        <span className="inline-flex items-center gap-1.5">
          <Link href={`/accounts/${encodeURIComponent(a.address)}`} className="font-mono text-primary hover:text-primary-light">
            {shortenMiddle(a.address)}
          </Link>
          <CopyButton value={a.address} label="address" />
        </span>
      ),
    },
    { header: 'Kind', cell: (a) => (a.accountKind ? <Badge tone="neutral">{a.accountKind}</Badge> : '—') },
    { header: 'First seen', mono: true, cell: (a) => formatHeight(a.firstSeenHeight) },
    { header: 'Last seen', mono: true, cell: (a) => formatHeight(a.lastSeenHeight) },
    { header: 'Txs', mono: true, cell: (a) => a.txCount },
  ];
  return (
    <PaginatedTable
      query={query}
      columns={columns}
      rowKey={(a) => a.address}
      context="Accounts"
      emptyMessage="No accounts indexed yet."
    />
  );
}
