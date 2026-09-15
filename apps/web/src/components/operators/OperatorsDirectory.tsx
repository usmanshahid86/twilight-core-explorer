'use client';

import Link from 'next/link';
import { clsx } from 'clsx';
import { SourceChip } from '@/components/provenance/SourceChip';
import { EmptyState, ErrorState, LoadingState } from '@/components/states/States';
import { useCoreSlots, useOperators } from '@/lib/api/queries';
import { formatAmount } from '@/lib/format/amount';
import { formatHeight } from '@/lib/format/height';
import { shortenMiddle } from '@/lib/format/address';
import { statusTone } from '@/lib/format/status';
import { curatedOperator } from '@/lib/operator-directory';
import { formatRewardWeight, formatSlotStatus } from '@/lib/format/slot';

// The merged Operators + Registry view (phase 14c/15 §4 + user request): ONE table carrying
// the registry's identity columns (status, power, reward weight, created/removed heights)
// beside the operator verdict figures (chain) and feed health. Client-side join of the
// registry list and the operators directory by slotId — both already exist as endpoints.

const GRID =
  'grid-cols-[52px_1fr_90px_90px_1fr] md:grid-cols-[52px_minmax(150px,1fr)_100px_120px_60px_60px_90px_90px_110px_80px_130px]';

export function OperatorsDirectory() {
  const operators = useOperators();
  const registry = useCoreSlots();

  if (operators.isPending || registry.isPending) return <LoadingState rows={5} />;
  if (operators.isError) return <ErrorState error={operators.error} context="Operators" />;
  if (registry.isError) return <ErrorState error={registry.error} context="Registry" />;

  const regBySlot = new Map(registry.data.data.map((s) => [s.slotId, s]));
  const rows = operators.data.data;
  if (rows.length === 0) return <EmptyState message="No CoreSlots in the registry." />;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[980px] border-t border-card-border">
        <div
          className={clsx(
            'grid items-center gap-3 border-b border-card-border py-2 font-mono text-[11px] uppercase tracking-[.08em] text-text-muted',
            GRID,
          )}
        >
          <span>slot</span>
          <span>operator</span>
          <span>status</span>
          <span className="hidden md:block">consensus</span>
          <span className="hidden text-right md:block">power</span>
          <span className="hidden text-right md:block">weight</span>
          <span className="hidden text-right md:block">created</span>
          <span className="text-right">settled</span>
          <span className="hidden text-right md:block">paid · 30d</span>
          <span className="hidden text-right md:block">latency</span>
          <span>status feed</span>
        </div>
        {rows.map((r) => {
          const reg = regBySlot.get(r.slotId);
          const paid = r.verdict ? formatAmount(r.verdict.paid30, r.verdict.denom) : null;
          const statusWord = formatSlotStatus(r.status ?? reg?.status);
          return (
            <Link
              key={r.slotId}
              href={`/operators/${encodeURIComponent(r.slotId)}`}
              className={clsx(
                'grid items-baseline gap-3 border-b border-card-hover py-[11px] text-[13px] text-text hover:text-primary',
                GRID,
              )}
            >
              <span className="font-mono">{r.slotId}</span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">
                  {curatedOperator(r.slotId)?.name ??
                    r.moniker ??
                    (r.operatorAddress ? shortenMiddle(r.operatorAddress, 12, 6) : '—')}
                </span>
                {r.moniker && r.operatorAddress ? (
                  <span className="hidden truncate font-mono text-[11px] text-text-muted lg:inline">
                    {shortenMiddle(r.operatorAddress, 10, 5)}
                  </span>
                ) : null}
              </span>
              <span
                className={clsx(
                  'font-mono text-xs',
                  statusTone(statusWord) === 'success' ? 'text-accent-green' : 'text-text-muted',
                )}
              >
                {statusWord ?? '—'}
                {reg?.removedHeight ? (
                  <span className="text-accent-red"> @{formatHeight(reg.removedHeight)}</span>
                ) : null}
              </span>
              <span className="hidden truncate font-mono text-[11px] text-text-muted md:block">
                {reg?.consensusAddress ? shortenMiddle(reg.consensusAddress, 8, 6) : '—'}
              </span>
              <span className="hidden text-right font-mono text-text-muted md:block">
                {reg?.consensusPower ?? '—'}
              </span>
              <span className="hidden text-right font-mono text-text-muted md:block">
                {formatRewardWeight(reg?.rewardWeight)}
              </span>
              <span className="hidden text-right font-mono text-text-muted md:block">
                {reg?.createdHeight ? formatHeight(reg.createdHeight) : '—'}
              </span>
              <span className="text-right font-mono">
                {r.verdict ? `${r.verdict.settledAll}/${r.verdict.owedAll}` : '—'}
              </span>
              <span className="hidden text-right font-mono md:block">
                {paid ? paid.display : '—'}
              </span>
              <span className="hidden text-right font-mono text-text-muted md:block">
                {r.verdict?.medianLatencyBlocks != null
                  ? `~${r.verdict.medianLatencyBlocks} blk`
                  : '—'}
              </span>
              <span className="flex items-center gap-2">
                {r.feed.publishesStatus ? (
                  <>
                    <span className="text-primary">publishes</span>
                    {r.feed.ageSeconds !== null ? (
                      <span className="font-mono text-[11px] text-text-muted">
                        {r.feed.ageSeconds}s ago
                      </span>
                    ) : null}
                  </>
                ) : (
                  <SourceChip kind="no-status" />
                )}
              </span>
            </Link>
          );
        })}
      </div>
      <p className="pt-2.5 text-xs text-text-muted">
        Identity, power, weight and heights are the registry&apos;s chain facts;
        settled/paid/latency are the operator verdict figures; the feed column is the
        explorer&apos;s own observation. There is no trust score — these figures are the whole
        of the explorer&apos;s opinion.
      </p>
    </div>
  );
}
