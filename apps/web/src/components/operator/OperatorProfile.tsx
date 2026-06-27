import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { DataList } from '@/components/detail/DataList';
import { JsonView } from '@/components/detail/JsonView';
import type { OperatorMetadata } from '@/lib/operator-metadata';

// Extension-ready operator profile: known fields (today: moniker) get dedicated rows; everything else
// surfaces via the `extras` JsonView. When the chain adds a field, promote it in operator-metadata.ts
// and add one DataList row here — no rewrite of anything upstream.
export function OperatorProfile({ metadata }: { metadata: OperatorMetadata }) {
  const hasExtras = Object.keys(metadata.extras).length > 0;
  if (metadata.moniker === undefined && !hasExtras) return null;

  const items = [
    ...(metadata.moniker !== undefined ? [{ label: 'Moniker', value: metadata.moniker }] : []),
    ...(hasExtras ? [{ label: 'Other metadata', value: <JsonView value={metadata.extras} /> }] : []),
  ];
  return (
    <Card>
      <CardHeader title="Operator profile" />
      <CardBody>
        <DataList items={items} />
      </CardBody>
    </Card>
  );
}
