'use client';

import Link from 'next/link';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Table, Td, Th, Tr } from '@/components/ui/Table';
import { MonoCopy } from '@/components/ui/MonoCopy';
import { OperatorLink } from '@/components/operator/OperatorLink';
import { EmptyState, ErrorState, LoadingState } from '@/components/states/States';
import { useOperatorDirectory, useStatus, useValidatorSet } from '@/lib/api/queries';
import { formatHeight } from '@/lib/format/height';

// Operator-forward: leads with the operator (name via the non-blocking directory) linked to the
// operator page. The validator set requires a height, derived from /status (string-safe, no Number()).
export function ValidatorSetSection() {
  const status = useStatus();
  const latest = status.data?.data.indexer?.lastIndexedHeight;
  const height = typeof latest === 'string' && /^\d+$/.test(latest) ? latest : undefined;
  const vset = useValidatorSet(height);
  const slotIds = (vset.data?.data ?? []).map((v) => v.slotId);
  const directory = useOperatorDirectory(slotIds);

  return (
    <Card>
      <CardHeader title={height ? `Validator set at height ${formatHeight(height)}` : 'Validator set'} />
      <CardBody>
        {height === undefined ? (
          status.isError ? (
            <ErrorState error={status.error} context="Status" />
          ) : (
            <div className="text-sm text-text-muted">Latest height unavailable — cannot load the validator set.</div>
          )
        ) : vset.isPending ? (
          <LoadingState rows={4} />
        ) : vset.isError ? (
          <ErrorState error={vset.error} context="Validator set" />
        ) : vset.data.data.length === 0 ? (
          <EmptyState message="No active validators at this height." />
        ) : (
          <Table
            head={
              <>
                <Th>Operator</Th>
                <Th>Slot</Th>
                <Th>Consensus</Th>
                <Th>Power</Th>
                <Th>Effective</Th>
              </>
            }
          >
            {vset.data.data.map((v) => (
              <Tr key={v.slotId}>
                <Td>
                  <OperatorLink operatorAddress={v.operatorAddress} name={directory.data?.[v.slotId]?.displayName} />
                </Td>
                <Td mono>
                  <Link href={`/coreslots/${encodeURIComponent(v.slotId)}`} className="text-primary hover:text-primary-light">
                    {v.slotId}
                  </Link>
                </Td>
                <Td>
                  <MonoCopy value={v.consensusAddress} head={8} tail={6} label="consensus" />
                </Td>
                <Td mono>{v.consensusPower ?? '—'}</Td>
                <Td mono>{`${formatHeight(v.effectiveFromHeight)} → ${v.effectiveToHeight ? formatHeight(v.effectiveToHeight) : '…'}`}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </CardBody>
    </Card>
  );
}
