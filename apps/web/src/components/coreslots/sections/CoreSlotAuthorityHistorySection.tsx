'use client';

import Link from 'next/link';
import { PaginatedTable, type Column } from '@/components/list/PaginatedTable';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { JsonView } from '@/components/detail/JsonView';
import { MonoCopy } from '@/components/ui/MonoCopy';
import {
  useCoreSlotEvents,
  useCoreSlotKeyRotations,
  useCoreSlotWindows,
  type CoreSlotEventsResponse,
  type CoreSlotKeyRotationsResponse,
  type CoreSlotWindowsResponse,
} from '@/lib/api/queries';
import { formatHeight } from '@/lib/format/height';
import { statusTone } from '@/lib/format/status';

type Event = CoreSlotEventsResponse['data'][number];
type Rotation = CoreSlotKeyRotationsResponse['data'][number];
type ConsensusWindow = CoreSlotWindowsResponse['data'][number];

function txLink(hash: string | null) {
  if (!hash) return <span className="text-text-muted">—</span>;
  return (
    <Link href={`/txs/${encodeURIComponent(hash)}`} className="font-mono text-primary hover:text-primary-light">
      {hash.slice(0, 10)}…
    </Link>
  );
}

function EventsTable({ slotId }: { slotId: string }) {
  const query = useCoreSlotEvents(slotId);
  const columns: Column<Event>[] = [
    { header: 'Kind', cell: (e) => <Badge tone="info">{e.kind}</Badge> },
    { header: 'Height', mono: true, cell: (e) => formatHeight(e.height) },
    { header: 'Tx', cell: (e) => txLink(e.txHash) },
    { header: 'Detail', cell: (e) => <JsonView value={e.detail} /> },
  ];
  return (
    <PaginatedTable
      query={query}
      columns={columns}
      rowKey={(e) => e.eventId}
      context="Events"
      emptyMessage="No lifecycle / metadata / payout events."
    />
  );
}

function KeyRotationsTable({ slotId }: { slotId: string }) {
  const query = useCoreSlotKeyRotations(slotId);
  const columns: Column<Rotation>[] = [
    { header: 'Status', cell: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    { header: 'Old → new', cell: (r) => (
      <span className="inline-flex items-center gap-1">
        <MonoCopy value={r.oldConsensusAddress} head={8} tail={4} label="old consensus" />
        <span className="text-text-muted">→</span>
        <MonoCopy value={r.newConsensusAddress} head={8} tail={4} label="new consensus" />
      </span>
    ) },
    { header: 'Requested', mono: true, cell: (r) => formatHeight(r.requestedHeight) },
    { header: 'Applied', mono: true, cell: (r) => formatHeight(r.appliedHeight) },
    { header: 'Tx', cell: (r) => txLink(r.appliedTxHash ?? r.requestTxHash) },
  ];
  return (
    <PaginatedTable
      query={query}
      columns={columns}
      rowKey={(r) => r.id}
      context="Key rotations"
      emptyMessage="No key rotations."
    />
  );
}

function WindowsTable({ slotId }: { slotId: string }) {
  const query = useCoreSlotWindows(slotId);
  const columns: Column<ConsensusWindow>[] = [
    { header: 'Status', cell: (w) => <Badge tone={statusTone(w.status)}>{w.status}</Badge> },
    { header: 'Effective', mono: true, cell: (w) => `${formatHeight(w.effectiveFromHeight)} → ${w.effectiveToHeight ? formatHeight(w.effectiveToHeight) : '…'}` },
    { header: 'Opened / closed by', cell: (w) => `${w.openedByKind}${w.closedByKind ? ` / ${w.closedByKind}` : ''}` },
    { header: 'Power', mono: true, cell: (w) => w.consensusPower ?? '—' },
  ];
  return (
    <PaginatedTable
      query={query}
      columns={columns}
      rowKey={(w) => w.id}
      context="Consensus windows"
      emptyMessage="No consensus windows."
    />
  );
}

// PoA authority/trust surface: lifecycle/metadata/payout events, key rotations, consensus windows.
// No CoreSlot→tx list endpoint exists, so event/rotation txHashes link to /txs/{hash} individually.
export function CoreSlotAuthorityHistorySection({ slotId }: { slotId: string }) {
  return (
    <>
      <Card>
        <CardHeader title="Authority events" />
        <CardBody>
          <EventsTable slotId={slotId} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Key rotations" />
        <CardBody>
          <KeyRotationsTable slotId={slotId} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Consensus windows" />
        <CardBody>
          <WindowsTable slotId={slotId} />
        </CardBody>
      </Card>
    </>
  );
}
