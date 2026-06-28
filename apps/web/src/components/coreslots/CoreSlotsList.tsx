'use client';

import Link from 'next/link';
import { PaginatedTable, type Column } from '@/components/list/PaginatedTable';
import { Badge } from '@/components/ui/Badge';
import { MonoCopy } from '@/components/ui/MonoCopy';
import { StatusFilter } from '@/components/list/StatusFilter';
import { CORESLOT_STATUS_OPTIONS } from '@/lib/status-filters';
import { useCoreSlotsList, type CoreSlotsResponse } from '@/lib/api/queries';
import { formatHeight } from '@/lib/format/height';
import { statusTone } from '@/lib/format/status';

type Slot = CoreSlotsResponse['data'][number];

export function CoreSlotsList({ status }: { status?: string | undefined }) {
  const query = useCoreSlotsList(status);
  const columns: Column<Slot>[] = [
    {
      header: 'Slot',
      mono: true,
      cell: (s) => (
        <Link href={`/coreslots/${encodeURIComponent(s.slotId)}`} className="text-primary hover:text-primary-light">
          {s.slotId}
        </Link>
      ),
    },
    { header: 'Status', cell: (s) => (s.status ? <Badge tone={statusTone(s.status)}>{s.status}</Badge> : '—') },
    { header: 'Operator', cell: (s) => <MonoCopy value={s.operatorAddress} label="operator" /> },
    { header: 'Power', mono: true, cell: (s) => s.consensusPower ?? '—' },
    { header: 'Reward wt', mono: true, cell: (s) => s.rewardWeight ?? '—' },
    { header: 'Created', mono: true, cell: (s) => formatHeight(s.createdHeight) },
    { header: 'Removed', mono: true, cell: (s) => (s.removedHeight ? formatHeight(s.removedHeight) : '—') },
  ];
  return (
    <div className="space-y-3">
      <StatusFilter
        label="Status"
        paramName="status"
        value={status ?? ''}
        options={CORESLOT_STATUS_OPTIONS}
      />
      <PaginatedTable
        query={query}
        columns={columns}
        rowKey={(s) => s.slotId}
        context="CoreSlots"
        emptyMessage={status ? `No ${status.toLowerCase()} CoreSlots.` : 'No CoreSlots indexed yet.'}
      />
    </div>
  );
}
