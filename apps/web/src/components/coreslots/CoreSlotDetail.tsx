'use client';

import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { MonoCopy } from '@/components/ui/MonoCopy';
import { DataList } from '@/components/detail/DataList';
import { DetailShell } from '@/components/detail/DetailShell';
import { JsonView } from '@/components/detail/JsonView';
import { ErrorState, InvalidInput, LoadingState } from '@/components/states/States';
import { useCoreSlot } from '@/lib/api/queries';
import { formatHeight } from '@/lib/format/height';
import { statusTone } from '@/lib/format/status';
import { bpsToPercent } from '@/lib/format/bps';
import { CoreSlotHealthSection } from './sections/CoreSlotHealthSection';
import { CoreSlotLivenessSection } from './sections/CoreSlotLivenessSection';
import { CoreSlotProposedBlocksSection } from './sections/CoreSlotProposedBlocksSection';
import { CoreSlotAuthorityHistorySection } from './sections/CoreSlotAuthorityHistorySection';
import { CoreSlotRewardsSection } from './sections/CoreSlotRewardsSection';
import { CoreSlotRawSection } from './sections/CoreSlotRawSection';

export function CoreSlotDetail({ slotId }: { slotId: string }) {
  // String-safe numeric-slot-id check (no Number()). Neutral message matches the regex; the API still
  // validates (invalid_slot_id / not_found) and ErrorState branches on error.code.
  const valid = /^\d+$/.test(slotId);
  const query = useCoreSlot(valid ? slotId : '');

  if (!valid) {
    return (
      <DetailShell title={`CoreSlot ${slotId}`}>
        <InvalidInput message="CoreSlot id must be a numeric slot id." />
      </DetailShell>
    );
  }
  if (query.isPending) {
    return (
      <DetailShell title="CoreSlot">
        <LoadingState rows={5} />
      </DetailShell>
    );
  }
  if (query.isError) {
    return (
      <DetailShell title={`CoreSlot ${slotId}`}>
        <ErrorState error={query.error} context="CoreSlot" />
      </DetailShell>
    );
  }

  const c = query.data.data;
  return (
    <DetailShell title={`CoreSlot ${c.slotId}`}>
      <Card>
        <CardBody>
          <DataList
            items={[
              { label: 'Slot id', value: <span className="font-mono">{c.slotId}</span> },
              { label: 'Status', value: c.status ? <Badge tone={statusTone(c.status)}>{c.status}</Badge> : '—' },
              { label: 'Operator', value: <MonoCopy value={c.operatorAddress} label="operator" /> },
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
    </DetailShell>
  );
}
