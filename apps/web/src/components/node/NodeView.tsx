'use client';

import Link from 'next/link';
import { LedgerList, LedgerMarker, LedgerRow } from '@/components/ledger/Ledger';
import { NextPayoutCard, UnsettledCard } from './NodeRail';
import { NodeEvents } from './NodeEvents';
import { ErrorState, LoadingState } from '@/components/states/States';
import {
  useCoreSlot,
  useCoreSlotHealth,
  useCoreSlotProposedBlocks,
  useProposers,
  useSettlementStatus,
  useSigningHeatmap,
} from '@/lib/api/queries';
import { parseOperatorMetadata } from '@/lib/operator-metadata';
import { formatHeight } from '@/lib/format/height';
import { formatRelativeTime } from '@/lib/format/time';
import { formatAmount } from '@/lib/format/amount';
import { bpsToPercent } from '@/lib/format/bps';
import { formatRewardWeight } from '@/lib/format/slot';
import { deriveSettlementState } from '@/lib/settlement-state';
import { isDownStatus, isHealthyStatus } from '@/lib/format/status';
import { clsx } from 'clsx';

// The My-node dashboard (control-room handoff §1) — also reused (without the payout rail) for
// any other slot via /coreslots/[id]. Every figure is chain-derived; the NEXT PAYOUT card is
// the one labelled estimate. "claimed/unclaimed" from the prototype maps to settled/open
// settlements — this chain has no claim step.

function Stat({ label, value, mint = false }: { label: string; value: string; mint?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-text-muted">{label}</span>
      <span className={clsx('font-mono text-xl', mint ? 'text-primary' : 'text-text')}>{value}</span>
    </div>
  );
}

export function NodeView({ slotId, ownNode = true }: { slotId: string; ownNode?: boolean }) {
  const slot = useCoreSlot(slotId);
  const health = useCoreSlotHealth(slotId);
  const heatmap = useSigningHeatmap(200);
  const proposers = useProposers();
  const settlements = useSettlementStatus({ slotId });
  const proposed = useCoreSlotProposedBlocks(slotId);

  if (slot.isPending) return <LoadingState rows={8} />;
  if (slot.isError) return <ErrorState error={slot.error} context="CoreSlot" />;

  const c = slot.data.data;
  const h = health.data?.data ?? null;
  const meta = parseOperatorMetadata(c.metadata);

  // Signing tape: this slot's row of the 200-block heatmap window.
  const heat = heatmap.data?.data;
  const tapeRow = heat?.slots.find((s) => s.slotId === slotId);
  const cells = tapeRow?.cells ?? [];
  const heights = heat?.heights ?? [];
  const missedIdx = cells.flatMap((c2, i) => (c2 === 'missed' ? [i] : []));
  const lastMissedHeight = missedIdx.length > 0 ? heights[missedIdx[missedIdx.length - 1] as number] : null;

  // Verdict: signing normally / degraded / down, from the health projection.
  const missedRecent = h?.missedCount ?? 0;
  const down = h ? !h.isActiveAtLatest || isDownStatus(h.healthStatus) : false;
  const degraded = !down && h !== null && !isHealthyStatus(h.healthStatus);
  const title = down
    ? `Down${h?.latestMissedHeight ? ` since block ${formatHeight(h.latestMissedHeight)}` : ''}.`
    : degraded
      ? `Degraded — ${missedRecent} block${missedRecent === 1 ? '' : 's'} missed in the last ${h?.expectedCount ?? 100}.`
      : 'Signing normally.';

  // Settlement rows double as the rewards ledger, the earned-to-date sum, and the events feed.
  const statusRows = settlements.data?.pages.flatMap((p) => p.data) ?? [];
  const slotSummaries = settlements.data?.pages[0]?.slots ?? [];
  const ownSummary = slotSummaries.find((s) => s.slotId === slotId);
  const earned = statusRows.reduce((acc, r) => acc + BigInt(r.entitlementAmount), 0n);
  const earnedFmt = formatAmount(earned.toString(), statusRows[0]?.denom ?? 'utwlt');

  const proposedCount = proposers.data?.data.find((p) => p.slotId === slotId)?.blocksProposed;
  const proposedRows = (proposed.data?.pages[0]?.data ?? []).slice(0, 5);

  return (
    <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-9">
        {/* Verdict */}
        <div className="flex flex-col gap-3">
          <div className="font-mono text-xs uppercase tracking-[.1em] text-text-muted">
            CoreSlot {slotId}
            {meta.moniker ? ` · ${meta.moniker}` : ''}
          </div>
          <h1 className="font-serif text-5xl leading-[1.05] tracking-[-0.01em]">
            {title}
            {h && !down ? (
              <>
                <br />
                <span className="font-medium text-text-muted">
                  {missedRecent} block{missedRecent === 1 ? '' : 's'} missed in the last{' '}
                  {h.expectedCount ?? 100}.
                </span>
              </>
            ) : null}
          </h1>
          <div className="flex flex-wrap gap-7 pt-1.5">
            <Stat
              label={`Uptime · last ${h?.expectedCount ?? 100} blocks`}
              value={h ? bpsToPercent(h.uptimeBps) : '…'}
              mint
            />
            <Stat
              label="Proposed"
              value={proposedCount !== undefined ? String(proposedCount) : '…'}
            />
            <Stat
              label="Earned to date"
              value={statusRows.length > 0 ? `${earnedFmt.display} ${earnedFmt.symbol}` : '…'}
            />
            <Stat label="Reward weight" value={formatRewardWeight(c.rewardWeight)} />
          </div>
        </div>

        {/* Signing tape */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between font-mono text-xs">
            <span className="uppercase tracking-[.08em] text-primary">
              ⸸ signing · last {cells.length || 200} blocks
            </span>
            <span className="text-text-muted">
              {missedIdx.length === 0
                ? 'none missed'
                : `${missedIdx.length} missed${lastMissedHeight ? ` at ${formatHeight(lastMissedHeight)}` : ''}`}
            </span>
          </div>
          <div
            className="flex h-9 gap-px rounded border border-card-border bg-background-secondary p-1"
            role="img"
            aria-label={`Signing record for CoreSlot ${slotId}: ${missedIdx.length} missed of the last ${cells.length} blocks`}
          >
            {cells.map((cell, i) => (
              <span
                key={i}
                className={clsx(
                  'flex-1 rounded-[1px]',
                  cell === 'missed' ? 'bg-accent-red' : cell === 'signed' ? 'bg-primary/60' : 'bg-card-hover',
                )}
              />
            ))}
          </div>
          <div className="flex justify-between font-mono text-[11px] text-text-muted">
            <span>{heights[0] ? formatHeight(heights[0]) : ''}</span>
            <span>now</span>
          </div>
        </div>

        {/* Two ledgers */}
        <div className="grid grid-cols-1 gap-7 xl:grid-cols-2">
          <div>
            <LedgerMarker>Rewards · recent epochs</LedgerMarker>
            <LedgerList>
              {statusRows.slice(0, 5).map((r) => {
                const state = deriveSettlementState(r, ownSummary);
                const amt = formatAmount(r.entitlementAmount, r.denom);
                return (
                  <LedgerRow
                    key={r.epochNumber}
                    href={`/mining/settlements/${encodeURIComponent(slotId)}/${encodeURIComponent(r.epochNumber)}`}
                    grid="grid-cols-[64px_1fr_auto]"
                  >
                    <span className="font-mono">{r.epochNumber}</span>
                    <span className="truncate text-text-muted">{state}</span>
                    <span
                      className={clsx(
                        'font-mono',
                        state === 'settled' ? 'text-primary' : state === 'late' ? 'text-accent-red' : 'text-accent-yellow',
                      )}
                    >
                      +{amt.display}
                    </span>
                  </LedgerRow>
                );
              })}
            </LedgerList>
            <Link
              href={ownNode ? '/node/settlements' : `/economy?tab=settlements&slotId=${slotId}`}
              className="mt-2.5 inline-block text-[13px] text-primary hover:text-primary-light"
            >
              All settlements →
            </Link>
          </div>
          <div>
            <LedgerMarker>{ownNode ? 'Blocks I proposed' : 'Blocks proposed'}</LedgerMarker>
            <LedgerList>
              {proposedRows.map((b) => (
                <LedgerRow
                  key={b.height}
                  href={`/blocks/${encodeURIComponent(b.height)}`}
                  grid="grid-cols-[90px_1fr_auto]"
                >
                  <span className="font-mono">{formatHeight(b.height)}</span>
                  <span className="truncate text-text-muted">
                    {b.time ? formatRelativeTime(b.time) : ''}
                  </span>
                  <span className="font-mono text-text-muted">{b.attributionStatus ?? ''}</span>
                </LedgerRow>
              ))}
            </LedgerList>
          </div>
        </div>
      </div>

      {/* Right rail */}
      <div className="flex flex-col gap-5">
        {ownNode ? <NextPayoutCard slotId={slotId} rewardWeight={c.rewardWeight} /> : null}
        {ownNode ? <UnsettledCard rows={statusRows} summary={ownSummary} /> : null}
        <NodeEvents slotId={slotId} statusRows={statusRows} summary={ownSummary} />
      </div>
    </div>
  );
}
