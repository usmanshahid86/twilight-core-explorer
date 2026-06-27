'use client';

import { useState } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { MonoCopy } from '@/components/ui/MonoCopy';
import { DataList } from '@/components/detail/DataList';
import { DetailShell } from '@/components/detail/DetailShell';
import { RawSection } from '@/components/detail/RawSection';
import { ErrorState, InvalidInput, LoadingState } from '@/components/states/States';
import { BlockTxsSection } from './BlockTxsSection';
import { useBlock, useBlockRaw } from '@/lib/api/queries';
import { formatHeight } from '@/lib/format/height';
import { formatAbsoluteTime } from '@/lib/format/time';
import { statusTone } from '@/lib/format/status';

export function BlockDetail({ height }: { height: string }) {
  // Client-side, string-safe malformed-height check (no Number()): a canonical positive integer
  // (rejects "0", leading zeros, and empty). The API still validates (invalid_height / not_found)
  // and ErrorState branches on error.code.
  const valid = /^[1-9]\d*$/.test(height);
  const query = useBlock(valid ? height : '');
  const [rawOpen, setRawOpen] = useState(false);
  const raw = useBlockRaw(valid ? height : '', rawOpen);

  if (!valid) {
    return (
      <DetailShell title={`Block ${height}`}>
        <InvalidInput message="Block height must be a positive integer." />
      </DetailShell>
    );
  }
  if (query.isPending) {
    return (
      <DetailShell title="Block">
        <LoadingState rows={6} />
      </DetailShell>
    );
  }
  if (query.isError) {
    return (
      <DetailShell title={`Block ${formatHeight(height)}`}>
        <ErrorState error={query.error} context="Block" />
      </DetailShell>
    );
  }

  const b = query.data.data;
  const proposer = b.proposer.operatorAddress ?? b.proposer.address ?? b.proposer.rawAddress;
  return (
    <DetailShell title={`Block ${formatHeight(b.height)}`}>
      <Card>
        <CardBody>
          <DataList
            items={[
              { label: 'Height', value: <span className="font-mono">{formatHeight(b.height)}</span> },
              { label: 'Hash', value: <MonoCopy value={b.hash} head={16} tail={10} label="block hash" /> },
              { label: 'Time', value: formatAbsoluteTime(b.time) },
              { label: 'Chain', value: b.chainId ?? '—' },
              { label: 'Transactions', value: <span className="font-mono">{b.txCount}</span> },
              { label: 'Proposer', value: <MonoCopy value={proposer} label="proposer" /> },
              {
                label: 'Attribution',
                value: b.proposer.attributionStatus ? (
                  <Badge tone={statusTone(b.proposer.attributionStatus)}>{b.proposer.attributionStatus}</Badge>
                ) : (
                  '—'
                ),
              },
              { label: 'App hash', value: <MonoCopy value={b.appHash} label="app hash" /> },
              { label: 'Last block hash', value: <MonoCopy value={b.lastBlockHash} label="last block hash" /> },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Transactions in this block" />
        <CardBody>
          <BlockTxsSection height={b.height} />
        </CardBody>
      </Card>

      <RawSection expanded={rawOpen} onToggle={() => setRawOpen((o) => !o)} query={raw} />
    </DetailShell>
  );
}
