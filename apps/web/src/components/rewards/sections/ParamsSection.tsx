'use client';

import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { PaginatedTable, type Column } from '@/components/list/PaginatedTable';
import { MonoCopy } from '@/components/ui/MonoCopy';
import { JsonView } from '@/components/detail/JsonView';
import { formatHeight } from '@/lib/format/height';
import { useRewardsParams, type RewardsParamsResponse } from '@/lib/api/queries';

type ParamsChange = RewardsParamsResponse['data'][number];

export function ParamsSection() {
  const query = useRewardsParams();

  const columns: Column<ParamsChange>[] = [
    { header: 'Change', cell: (p) => p.changeType },
    { header: 'Authority', cell: (p) => <MonoCopy value={p.authority} label="authority" /> },
    { header: 'Height', mono: true, cell: (p) => formatHeight(p.height) },
    { header: 'Tx', cell: (p) => <MonoCopy value={p.txHash} label="tx hash" /> },
    { header: 'Params', cell: (p) => <JsonView value={p.params} /> },
  ];

  return (
    <Card>
      <CardHeader title="Params changes" />
      <CardBody>
        <PaginatedTable
          query={query}
          columns={columns}
          rowKey={(p) => p.id}
          context="Params changes"
          emptyMessage="No rewards params changes recorded."
        />
      </CardBody>
    </Card>
  );
}
