'use client';

import Link from 'next/link';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Table, Td, Th, Tr } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { OperatorLink } from '@/components/operator/OperatorLink';
import { EmptyState, ErrorState, LoadingState } from '@/components/states/States';
import { useCoreSlotHealthFanout, useCoreSlots } from '@/lib/api/queries';
import { statusTone } from '@/lib/format/status';
import { bpsToPercent } from '@/lib/format/bps';

// Per-slot health table. Health comes from a bounded, non-blocking fan-out: rows render immediately
// from the slot list, and each slot's health fills in (or stays "—" if that slot's fetch failed).
export function PerSlotHealthTable() {
  const slotsQuery = useCoreSlots();
  const slots = slotsQuery.data?.data ?? [];
  const slotIds = slots.map((s) => s.slotId);
  const healthQuery = useCoreSlotHealthFanout(slotIds);
  const healthBySlot = new Map((healthQuery.data ?? []).map((h) => [h.slotId, h.health]));
  const capped = slotsQuery.data?.data !== undefined && slotsQuery.data.page.nextCursor !== null;

  return (
    <Card>
      <CardHeader title="Per-CoreSlot health" />
      <CardBody className="space-y-3">
        {slotsQuery.isPending ? (
          <LoadingState rows={4} />
        ) : slotsQuery.isError ? (
          <ErrorState error={slotsQuery.error} context="CoreSlots" />
        ) : slots.length === 0 ? (
          <EmptyState message="No CoreSlots indexed yet." />
        ) : (
          <>
            <Table
              caption="Per-CoreSlot health"
              head={
                <>
                  <Th>Slot</Th>
                  <Th>Operator</Th>
                  <Th>Status</Th>
                  <Th>Uptime</Th>
                  <Th>Missed streak</Th>
                  <Th>Active</Th>
                </>
              }
            >
              {slots.map((s) => {
                const h = healthBySlot.get(s.slotId) ?? null;
                return (
                  <Tr key={s.slotId}>
                    <Td mono>
                      <Link href={`/coreslots/${encodeURIComponent(s.slotId)}`} className="text-primary hover:text-primary-light">
                        {s.slotId}
                      </Link>
                    </Td>
                    <Td>
                      <OperatorLink operatorAddress={s.operatorAddress} />
                    </Td>
                    <Td>{h ? <Badge tone={statusTone(h.healthStatus)}>{h.healthStatus}</Badge> : <span className="text-text-muted">—</span>}</Td>
                    <Td mono>{h ? bpsToPercent(h.uptimeBps) : '—'}</Td>
                    <Td mono>{h ? h.currentMissedStreak : '—'}</Td>
                    <Td>
                      {h ? (
                        h.isActiveAtLatest ? <Badge tone="success">yes</Badge> : <Badge tone="neutral">no</Badge>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </Table>
            {capped ? (
              <div className="text-xs text-text-muted">
                Showing the first 100 CoreSlots. More are available — open individual CoreSlot pages for
                full detail.
              </div>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}
