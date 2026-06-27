'use client';

import { useState } from 'react';
import { DetailShell } from '@/components/detail/DetailShell';
import { DataList, type DataItem } from '@/components/detail/DataList';
import { RawSection } from '@/components/detail/RawSection';
import { Card, CardBody } from '@/components/ui/Card';
import { ErrorState, InvalidInput, LoadingState } from '@/components/states/States';
import { formatHeight } from '@/lib/format/height';
import { formatAbsoluteTime } from '@/lib/format/time';
import { useRewardEpoch, useRewardEpochRaw } from '@/lib/api/queries';
import { RewardAmount } from './RewardAmount';
import { RewardCaveat } from './RewardCaveat';

const VALID_EPOCH = /^[1-9]\d*$/;

export function RewardEpochDetail({ epoch }: { epoch: string }) {
  const [rawExpanded, setRawExpanded] = useState(false);
  const valid = VALID_EPOCH.test(epoch);
  const query = useRewardEpoch(valid ? epoch : '');
  const rawQuery = useRewardEpochRaw(valid ? epoch : '', rawExpanded);

  if (!valid) {
    return (
      <DetailShell title="Epoch">
        <InvalidInput message="Epoch must be a positive integer." />
      </DetailShell>
    );
  }
  if (query.isPending) {
    return (
      <DetailShell title="Epoch">
        <LoadingState rows={6} />
      </DetailShell>
    );
  }
  if (query.isError) {
    return (
      <DetailShell title="Epoch">
        <ErrorState error={query.error} context="Epoch" />
      </DetailShell>
    );
  }

  const e = query.data.data;
  const items: DataItem[] = [
    { label: 'Epoch', value: e.epochNumber },
    { label: 'Height', value: formatHeight(e.height) },
    { label: 'Time', value: formatAbsoluteTime(e.blockTime) },
    { label: 'Total reward', value: <RewardAmount raw={e.totalReward} denom={e.denom} /> },
    { label: 'Denom', value: e.denom ?? '—' },
    { label: 'Active slots', value: e.activeSlotCount ?? '—' },
    {
      label: 'Cumulative emitted',
      value: <RewardAmount raw={e.cumulativeEmitted} denom={e.denom} />,
    },
    { label: 'Distribution method', value: e.distributionMethod ?? '—' },
  ];

  return (
    <DetailShell title={`Epoch ${e.epochNumber}`}>
      <Card>
        <CardBody>
          <RewardCaveat>
            rewardSemantics: <span className="font-mono">{e.rewardSemantics}</span> — aggregate
            network-emission context, not claim truth.
          </RewardCaveat>
          <DataList items={items} />
        </CardBody>
      </Card>
      <RawSection
        expanded={rawExpanded}
        onToggle={() => setRawExpanded((v) => !v)}
        query={rawQuery}
      />
    </DetailShell>
  );
}
