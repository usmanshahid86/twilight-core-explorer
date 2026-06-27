'use client';

import Link from 'next/link';
import { QueryBoundary } from '@/components/QueryBoundary';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Table, Td, Th, Tr } from '@/components/ui/Table';
import { OperatorLink } from '@/components/operator/OperatorLink';
import { EmptyState } from '@/components/states/States';
import { useOperatorDirectory, useProposers } from '@/lib/api/queries';

// Operator-forward proposer leaderboard, sorted by blocksProposed desc with a stable slotId tie-break.
export function ProposerLeaderboard() {
  const proposers = useProposers();
  const slotIds = (proposers.data?.data ?? []).map((p) => p.slotId);
  const directory = useOperatorDirectory(slotIds);
  return (
    <Card>
      <CardHeader title="Proposer leaderboard" />
      <CardBody>
        <QueryBoundary query={proposers} context="Proposers" loadingRows={4}>
          {(res) => {
            // blocksProposed is a bounded integer (safe to compare numerically); tie-break by slotId.
            const rows = [...res.data].sort(
              (a, b) =>
                b.blocksProposed - a.blocksProposed ||
                (a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0),
            );
            return rows.length === 0 ? (
              <EmptyState message="No proposers yet." />
            ) : (
              <Table
                head={
                  <>
                    <Th>#</Th>
                    <Th>Operator</Th>
                    <Th>Slot</Th>
                    <Th>Blocks proposed</Th>
                  </>
                }
              >
                {rows.map((p, i) => (
                  <Tr key={p.slotId}>
                    <Td mono>{i + 1}</Td>
                    <Td>
                      <OperatorLink operatorAddress={p.operatorAddress} name={directory.data?.[p.slotId]?.displayName} />
                    </Td>
                    <Td mono>
                      <Link href={`/coreslots/${encodeURIComponent(p.slotId)}`} className="text-primary hover:text-primary-light">
                        {p.slotId}
                      </Link>
                    </Td>
                    <Td mono>{p.blocksProposed}</Td>
                  </Tr>
                ))}
              </Table>
            );
          }}
        </QueryBoundary>
      </CardBody>
    </Card>
  );
}
