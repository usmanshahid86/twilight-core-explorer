'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  useCoreSlotHealthFanout,
  useCoreSlots,
  useSigningHeatmap,
} from '@/lib/api/queries';
import { getLinkedSlot } from '@/lib/linked-slot';
import { shortenMiddle } from '@/lib/format/address';
import { bpsToPercent } from '@/lib/format/bps';
import { isHealthyStatus } from '@/lib/format/status';
import { EmptyState, ErrorState, LoadingState } from '@/components/states/States';

// The slots Overview table — the ruled table (control-room handoff §3) MERGED with the old
// per-slot health table: health word, in-set flag and missed streak fold in as columns. A
// Fira Code header row and
// hairline rows. Signed-last-100 renders as 50 flex cells, each cell aggregating a PAIR of
// heights from the 100-block heatmap window (missed if either was missed) so the strip stays
// honest about its window while fitting the 220px column. The viewer's linked slot gets a
// `you` tag and the own-row mint tint.

const GRID = 'grid-cols-[56px_1fr_90px_80px_70px] md:grid-cols-[56px_1fr_170px_100px_80px_70px_70px]';

function pairCells(cells: ('signed' | 'missed' | null)[]): ('signed' | 'missed' | null)[] {
  const out: ('signed' | 'missed' | null)[] = [];
  for (let i = 0; i < cells.length; i += 2) {
    const a = cells[i] ?? null;
    const b = cells[i + 1] ?? null;
    out.push(a === 'missed' || b === 'missed' ? 'missed' : (a ?? b));
  }
  return out;
}

export function ValidatorsTable() {
  const slots = useCoreSlots();
  const heatmap = useSigningHeatmap(100);
  const active = (slots.data?.data ?? []).filter((s) => s.status === 'ACTIVE');
  const health = useCoreSlotHealthFanout(active.map((s) => s.slotId));

  const [linkedSlotId, setLinkedSlotId] = useState<string | null>(null);
  useEffect(() => {
    setLinkedSlotId(getLinkedSlot()?.slotId ?? null);
  }, []);

  if (slots.isPending) return <LoadingState rows={6} />;
  if (slots.isError) return <ErrorState error={slots.error} context="Validators" />;
  if (active.length === 0) return <EmptyState message="No active CoreSlots in the registry." />;

  const healthBySlot = new Map((health.data ?? []).map((h) => [h.slotId, h.health]));
  const heatBySlot = new Map(
    (heatmap.data?.data.slots ?? []).map((s) => [s.slotId, s.cells]),
  );

  return (
    <div className="border-t border-card-border">
      <div
        className={clsx(
          'grid items-center gap-3.5 border-b border-card-border py-2 font-mono text-[11px] uppercase tracking-[.08em] text-text-muted',
          GRID,
        )}
      >
        <span>slot</span>
        <span>operator</span>
        <span className="hidden md:block">signed · last 100</span>
        <span>health</span>
        <span className="text-right">uptime</span>
        <span className="hidden text-right md:block">streak</span>
        <span className="text-right">power</span>
      </div>
      {active.map((s) => {
        const h = healthBySlot.get(s.slotId) ?? null;
        const cells = pairCells(heatBySlot.get(s.slotId) ?? []);
        const mine = linkedSlotId === s.slotId;
        const healthy = h === null || isHealthyStatus(h.healthStatus);
        return (
          <Link
            key={s.slotId}
            href={`/coreslots/${encodeURIComponent(s.slotId)}`}
            className={clsx(
              'grid items-center gap-3.5 border-b border-card-hover py-[11px] text-[13.5px] text-text hover:text-primary',
              GRID,
              mine && 'bg-primary/5',
            )}
          >
            <span className="font-mono">{s.slotId}</span>
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden="true"
                className={clsx(
                  'h-2 w-2 shrink-0 rounded-full',
                  healthy ? 'bg-accent-green' : 'bg-accent-yellow',
                )}
              />
              <span className="truncate font-mono text-xs text-text-secondary">
                {s.operatorAddress ? shortenMiddle(s.operatorAddress, 12, 6) : '—'}
              </span>
              {mine ? <span className="font-mono text-[11px] text-primary">you</span> : null}
            </span>
            <span
              className="hidden h-3.5 gap-px md:flex"
              role="img"
              aria-label={
                h
                  ? `slot ${s.slotId}: uptime ${bpsToPercent(h.uptimeBps)} over the last 100 blocks`
                  : `slot ${s.slotId} signing history`
              }
            >
              {cells.map((c, i) => (
                <span
                  key={i}
                  className={clsx(
                    'flex-1',
                    c === 'missed' ? 'bg-accent-red' : c === 'signed' ? 'bg-primary/55' : 'bg-card-hover',
                  )}
                />
              ))}
            </span>
            <span className="min-w-0">
              <span
                className={clsx(
                  'font-mono text-xs',
                  h === null ? 'text-text-muted' : healthy ? 'text-accent-green' : 'text-accent-red',
                )}
              >
                {h ? h.healthStatus : '…'}
              </span>
              {h && !h.isActiveAtLatest ? (
                <span className="ml-1.5 font-mono text-[11px] text-accent-red">out of set</span>
              ) : null}
            </span>
            <span className="text-right font-mono">{h ? bpsToPercent(h.uptimeBps) : '…'}</span>
            <span
              className={clsx(
                'hidden text-right font-mono md:block',
                h && h.currentMissedStreak > 0 ? 'text-accent-red' : 'text-text-muted',
              )}
            >
              {h ? h.currentMissedStreak : '—'}
            </span>
            <span className="text-right font-mono text-text-muted">{s.consensusPower ?? '—'}</span>
          </Link>
        );
      })}
    </div>
  );
}
