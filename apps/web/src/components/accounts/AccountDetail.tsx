'use client';

import { useState } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { MonoCopy } from '@/components/ui/MonoCopy';
import { DataList } from '@/components/detail/DataList';
import { DetailShell } from '@/components/detail/DetailShell';
import { RawSection } from '@/components/detail/RawSection';
import { ErrorState, LoadingState } from '@/components/states/States';
import { BalancesSection } from './BalancesSection';
import { useAccount, useAccountRaw } from '@/lib/api/queries';
import { formatHeight } from '@/lib/format/height';

// Account identity + sampled balances. No related-transaction history: the Phase 9 API exposes no
// address/signer tx filter, so we do not invent one (omitted by contract).
export function AccountDetail({ address }: { address: string }) {
  const query = useAccount(address);
  const [rawOpen, setRawOpen] = useState(false);
  const raw = useAccountRaw(address, rawOpen);

  if (query.isPending) {
    return (
      <DetailShell title="Account">
        <LoadingState rows={4} />
      </DetailShell>
    );
  }
  if (query.isError) {
    return (
      <DetailShell title="Account">
        <ErrorState error={query.error} context="Account" />
      </DetailShell>
    );
  }

  const a = query.data.data;
  return (
    <DetailShell title="Account">
      <Card>
        <CardBody>
          <DataList
            items={[
              { label: 'Address', value: <MonoCopy value={a.address} head={20} tail={12} label="address" /> },
              { label: 'Kind', value: a.accountKind ? <Badge tone="neutral">{a.accountKind}</Badge> : '—' },
              { label: 'First seen', value: <span className="font-mono">{formatHeight(a.firstSeenHeight)}</span> },
              { label: 'Last seen', value: <span className="font-mono">{formatHeight(a.lastSeenHeight)}</span> },
              { label: 'Tx count', value: <span className="font-mono">{a.txCount}</span> },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Sampled balances" />
        <CardBody>
          <BalancesSection address={a.address} />
        </CardBody>
      </Card>

      <RawSection expanded={rawOpen} onToggle={() => setRawOpen((o) => !o)} query={raw} />
    </DetailShell>
  );
}
