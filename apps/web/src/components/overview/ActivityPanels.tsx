'use client';

import Link from 'next/link';
import { QueryBoundary } from '@/components/QueryBoundary';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Table, Td, Th, Tr } from '@/components/ui/Table';
import { MonoCopy } from '@/components/ui/MonoCopy';
import { CopyButton } from '@/components/ui/CopyButton';
import { shortenMiddle } from '@/lib/format/address';
import { EmptyState } from '@/components/states/States';
import { useLatestBlocks, useRecentTxs } from '@/lib/api/queries';
import { formatHeight } from '@/lib/format/height';
import { formatRelativeTime } from '@/lib/format/time';
import { statusTone } from '@/lib/format/status';

export function LatestBlocksPanel() {
  const query = useLatestBlocks(8);
  return (
    <Card>
      <CardHeader title="Latest blocks" href="/blocks" linkLabel="All blocks" />
      <CardBody>
        <QueryBoundary query={query} context="Latest blocks" loadingRows={5}>
          {(res) =>
            res.data.length === 0 ? (
              <EmptyState message="No blocks indexed yet." />
            ) : (
              <Table
                head={
                  <>
                    <Th>Height</Th>
                    <Th>Age</Th>
                    <Th>Txs</Th>
                    <Th>Proposer</Th>
                  </>
                }
              >
                {res.data.map((b) => {
                  const proposer = b.proposer.operatorAddress ?? b.proposer.address ?? b.proposer.rawAddress;
                  return (
                    <Tr key={b.height}>
                      <Td mono>
                        <Link href={`/blocks/${encodeURIComponent(b.height)}`} className="text-primary hover:text-primary-light">
                          {formatHeight(b.height)}
                        </Link>
                      </Td>
                      <Td>{formatRelativeTime(b.time)}</Td>
                      <Td mono>{b.txCount}</Td>
                      <Td>
                        <MonoCopy value={proposer} label="proposer" />
                      </Td>
                    </Tr>
                  );
                })}
              </Table>
            )
          }
        </QueryBoundary>
      </CardBody>
    </Card>
  );
}

export function RecentTxPanel() {
  const query = useRecentTxs(8);
  return (
    <Card>
      <CardHeader title="Recent transactions" href="/txs" linkLabel="All transactions" />
      <CardBody>
        <QueryBoundary query={query} context="Recent transactions" loadingRows={5}>
          {(res) =>
            res.data.length === 0 ? (
              <EmptyState message="No transactions indexed yet." />
            ) : (
              <Table
                head={
                  <>
                    <Th>Hash</Th>
                    <Th>Height</Th>
                    <Th>Type</Th>
                    <Th>Status</Th>
                  </>
                }
              >
                {res.data.map((t) => (
                  <Tr key={t.hash}>
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        <Link
                          href={`/txs/${encodeURIComponent(t.hash)}`}
                          className="font-mono text-primary hover:text-primary-light"
                        >
                          {shortenMiddle(t.hash)}
                        </Link>
                        <CopyButton value={t.hash} label="tx hash" />
                      </span>
                    </Td>
                    <Td mono>{formatHeight(t.height)}</Td>
                    <Td>{t.messageTypes[0] ?? '—'}</Td>
                    <Td>
                      <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                    </Td>
                  </Tr>
                ))}
              </Table>
            )
          }
        </QueryBoundary>
      </CardBody>
    </Card>
  );
}
