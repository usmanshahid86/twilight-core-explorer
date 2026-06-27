'use client';

import { QueryBoundary } from '@/components/QueryBoundary';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Table, Td, Th, Tr } from '@/components/ui/Table';
import { EmptyState } from '@/components/states/States';
import { useCoreSlotLiveness } from '@/lib/api/queries';
import { statusTone } from '@/lib/format/status';
import { bpsToPercent } from '@/lib/format/bps';

// /liveness returns a plain array (one row per windowKind) — NOT paginated.
export function CoreSlotLivenessSection({ slotId }: { slotId: string }) {
  const query = useCoreSlotLiveness(slotId);
  return (
    <Card>
      <CardHeader title="Liveness (by window)" />
      <CardBody>
        <QueryBoundary query={query} context="Liveness" loadingRows={3}>
          {(res) =>
            res.data.length === 0 ? (
              <EmptyState message="No liveness windows." />
            ) : (
              <Table
                head={
                  <>
                    <Th>Window</Th>
                    <Th>Uptime</Th>
                    <Th>Signed / expected</Th>
                    <Th>Missed</Th>
                    <Th>Streak (↑/↓)</Th>
                    <Th>Status</Th>
                  </>
                }
              >
                {res.data.map((w, i) => (
                  <Tr key={`${w.windowKind}-${i}`}>
                    <Td>
                      {w.windowKind}
                      {w.windowSize !== null ? ` (${w.windowSize})` : ''}
                    </Td>
                    <Td mono>{bpsToPercent(w.uptimeBps)}</Td>
                    <Td mono>{`${w.signedCount} / ${w.expectedCount}`}</Td>
                    <Td mono>{w.missedCount}</Td>
                    <Td mono>{`${w.currentSignedStreak} / ${w.currentMissedStreak}`}</Td>
                    <Td>
                      <Badge tone={statusTone(w.summaryStatus)}>{w.summaryStatus}</Badge>
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
