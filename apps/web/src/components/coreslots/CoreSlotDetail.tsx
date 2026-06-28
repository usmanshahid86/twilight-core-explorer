'use client';

import type { ReactNode } from 'react';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { MonoCopy } from '@/components/ui/MonoCopy';
import { CopyButton } from '@/components/ui/CopyButton';
import { DataList } from '@/components/detail/DataList';
import { DetailShell } from '@/components/detail/DetailShell';
import { JsonView } from '@/components/detail/JsonView';
import { OperatorLink } from '@/components/operator/OperatorLink';
import { ErrorState, InvalidInput, LoadingState } from '@/components/states/States';
import { useCoreSlot } from '@/lib/api/queries';
import { parseOperatorMetadata } from '@/lib/operator-metadata';
import { formatHeight } from '@/lib/format/height';
import { statusTone } from '@/lib/format/status';
import { bpsToPercent } from '@/lib/format/bps';
import { CoreSlotHealthSection } from './sections/CoreSlotHealthSection';
import { CoreSlotLivenessSection } from './sections/CoreSlotLivenessSection';
import { CoreSlotProposedBlocksSection } from './sections/CoreSlotProposedBlocksSection';
import { CoreSlotAuthorityHistorySection } from './sections/CoreSlotAuthorityHistorySection';
import { CoreSlotRewardsSection } from './sections/CoreSlotRewardsSection';
import { CoreSlotRawSection } from './sections/CoreSlotRawSection';

export function CoreSlotDetail({ slotId, embedded = false }: { slotId: string; embedded?: boolean }) {
  // String-safe numeric-slot-id check (no Number()). Neutral message matches the regex; the API still
  // validates (invalid_slot_id / not_found) and ErrorState branches on error.code.
  const valid = /^\d+$/.test(slotId);
  const query = useCoreSlot(valid ? slotId : '');

  // Embedded (e.g. inside the operator page) renders headless — no DetailShell h1 — so the host keeps a
  // single h1 (M-010). Standalone wraps with the breadcrumbed shell (M-006).
  const wrap = (title: string, node: ReactNode) =>
    embedded ? (
      <div className="space-y-6">{node}</div>
    ) : (
      <DetailShell title={title} backHref="/coreslots" backLabel="CoreSlots">
        {node}
      </DetailShell>
    );

  if (!valid) {
    return wrap(`CoreSlot ${slotId}`, <InvalidInput message="CoreSlot id must be a numeric slot id." />);
  }
  if (query.isPending) {
    return wrap('CoreSlot', <LoadingState rows={5} />);
  }
  if (query.isError) {
    return wrap(`CoreSlot ${slotId}`, <ErrorState error={query.error} context="CoreSlot" />);
  }

  const c = query.data.data;
  const operatorMeta = parseOperatorMetadata(c.metadata);
  return wrap(
    `CoreSlot ${c.slotId}`,
    <>
      <Card>
        <CardBody>
          <DataList
            items={[
              { label: 'Slot id', value: <span className="font-mono">{c.slotId}</span> },
              { label: 'Status', value: c.status ? <Badge tone={statusTone(c.status)}>{c.status}</Badge> : '—' },
              {
                label: 'Operator',
                value: c.operatorAddress ? (
                  <span className="inline-flex items-center gap-1.5">
                    <OperatorLink operatorAddress={c.operatorAddress} name={operatorMeta.moniker} />
                    <CopyButton value={c.operatorAddress} label="operator address" />
                  </span>
                ) : (
                  '—'
                ),
              },
              { label: 'Payout', value: <MonoCopy value={c.payoutAddress} label="payout" /> },
              { label: 'Consensus', value: <MonoCopy value={c.consensusAddress} label="consensus" /> },
              { label: 'Consensus power', value: <span className="font-mono">{c.consensusPower ?? '—'}</span> },
              { label: 'Reward weight', value: <span className="font-mono">{c.rewardWeight ?? '—'}</span> },
              {
                label: 'Created / updated',
                value: <span className="font-mono">{`${formatHeight(c.createdHeight)} / ${formatHeight(c.updatedHeight)}`}</span>,
              },
              { label: 'Removed', value: c.removedHeight ? <span className="font-mono">{formatHeight(c.removedHeight)}</span> : '—' },
              { label: 'Consensus pubkey', value: <JsonView value={c.consensusPubkey} /> },
              { label: 'Metadata', value: <JsonView value={c.metadata} /> },
            ]}
          />
        </CardBody>
      </Card>

      {c.health ? (
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-text-muted">At latest:</span>
              <Badge tone={statusTone(c.health.healthStatus)}>{c.health.healthStatus}</Badge>
              <Badge tone={c.health.isActiveAtLatest ? 'success' : 'neutral'}>
                {c.health.isActiveAtLatest ? 'active' : 'inactive'}
              </Badge>
              <Badge tone="neutral">uptime {bpsToPercent(c.health.uptimeBps)}</Badge>
              {c.health.summaryStatus ? (
                <Badge tone={statusTone(c.health.summaryStatus)}>{c.health.summaryStatus}</Badge>
              ) : null}
            </div>
          </CardBody>
        </Card>
      ) : null}

      <CoreSlotHealthSection slotId={c.slotId} />
      <CoreSlotLivenessSection slotId={c.slotId} />
      <CoreSlotProposedBlocksSection slotId={c.slotId} />
      <CoreSlotAuthorityHistorySection slotId={c.slotId} />
      <CoreSlotRewardsSection slotId={c.slotId} />
      <CoreSlotRawSection slotId={c.slotId} />
    </>,
  );
}
