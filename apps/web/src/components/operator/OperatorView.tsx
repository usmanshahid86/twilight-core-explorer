'use client';

import Link from 'next/link';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { MonoCopy } from '@/components/ui/MonoCopy';
import { DetailShell } from '@/components/detail/DetailShell';
import { EmptyState, ErrorState, LoadingState } from '@/components/states/States';
import { CoreSlotDetail } from '@/components/coreslots/CoreSlotDetail';
import { OperatorProfile } from './OperatorProfile';
import { useCoreSlot, useOperatorResolution } from '@/lib/api/queries';
import { parseOperatorMetadata, displayName } from '@/lib/operator-metadata';
import type { OperatorRole } from '@/lib/operator-resolver';

const ROLE_LABEL: Record<OperatorRole, string> = {
  operator: 'operator address',
  consensus: 'consensus address',
  payout: 'payout address',
};

// Operator (validator-equivalent) page. No /operator endpoint: resolve address -> CoreSlot via the
// /coreslots filters, then reuse CoreSlotDetail for the resolved slot. One operator = one slot (chain
// rule); >1 is a surfaced anomaly. The slot detail query is shared (deduped) with CoreSlotDetail.
export function OperatorView({ address }: { address: string }) {
  const resolution = useOperatorResolution(address);
  const slots = resolution.data?.slots ?? [];
  const primarySlot = slots[0];
  const slotDetail = useCoreSlot(primarySlot?.slotId ?? '');

  if (resolution.isPending) {
    return (
      <DetailShell title="Operator">
        <LoadingState rows={4} />
      </DetailShell>
    );
  }
  if (resolution.isError) {
    return (
      <DetailShell title="Operator">
        <ErrorState error={resolution.error} context="Operator" />
      </DetailShell>
    );
  }

  const { matchedRole } = resolution.data;
  if (matchedRole === null || primarySlot === undefined) {
    return (
      <DetailShell title="Operator">
        <EmptyState message="No CoreSlot found for this address." />
      </DetailShell>
    );
  }

  const operatorAddress = primarySlot.operatorAddress;
  const meta = slotDetail.data ? parseOperatorMetadata(slotDetail.data.data.metadata) : { extras: {} };
  const name = displayName({ moniker: meta.moniker, operatorAddress });

  return (
    <DetailShell title={name}>
      <Card>
        <CardBody className="space-y-2">
          <div className="text-sm text-text-muted">
            Operator (validator) — runs CoreSlot <span className="font-mono text-text">{primarySlot.slotId}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">matched by {ROLE_LABEL[matchedRole]}</Badge>
            <span className="text-xs text-text-muted">searched:</span>
            <MonoCopy value={address} head={14} tail={8} label="searched address" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-text-muted">operator:</span>
            <MonoCopy value={operatorAddress} head={14} tail={8} label="operator address" />
          </div>
          {slots.length > 1 ? (
            <div className="rounded-xl border border-accent-yellow/30 bg-accent-yellow/10 px-4 py-2 text-xs text-accent-yellow">
              Multiple CoreSlots matched this address (unexpected — one operator should own one CoreSlot).
              Showing slot {primarySlot.slotId}.
            </div>
          ) : null}
          <div className="pt-1">
            <Link href="/rewards" className="text-sm text-primary hover:text-primary-light">
              View rewards →
            </Link>
          </div>
        </CardBody>
      </Card>

      <OperatorProfile metadata={meta} />

      <CoreSlotDetail slotId={primarySlot.slotId} />
    </DetailShell>
  );
}
