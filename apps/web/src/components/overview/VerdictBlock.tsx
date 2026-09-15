'use client';

import Link from 'next/link';
import { clsx } from 'clsx';
import { useLivenessRisk, useStatus } from '@/lib/api/queries';
import { deriveIndexerFreshness } from '@/lib/freshness';
import { formatHeight } from '@/lib/format/height';
import { statusTone, type BadgeTone } from '@/lib/format/status';

// One-control Overview header: h1 + a status chip, nothing else. The old "Indexer & projection
// details" disclosure duplicated what the Dashboard view (OverviewKpis) and /diagnostics already
// show, so it is gone — the chip links to /diagnostics instead. Healthy renders JUST the green
// dot chip; an unhealthy verdict adds one muted reason line under the header. NOTE 'idle' is a
// HEALTHY indexer state (between ticks) — health is judged by freshness + error, never the word.
const DOT: Record<BadgeTone, string> = {
  success: 'bg-accent-green shadow-[0_0_0_4px_rgb(var(--accent-green)/0.15)]',
  warning: 'bg-accent-yellow shadow-[0_0_0_4px_rgb(var(--accent-yellow)/0.15)]',
  danger: 'bg-accent-red shadow-[0_0_0_4px_rgb(var(--accent-red)/0.15)]',
  neutral: 'bg-text-muted',
  info: 'bg-primary',
};

export function VerdictBlock() {
  const status = useStatus();
  const liveness = useLivenessRisk();

  const indexer = status.data?.data.indexer;
  const risk = liveness.data?.data;
  const synced = deriveIndexerFreshness(indexer ?? null).kind === 'fresh';

  const indexerTone = statusTone(indexer?.status);
  const riskTone = risk ? statusTone(risk.haltRiskLevel) : 'success';

  let verdict: { label: string; tone: BadgeTone };
  let reason: string | null = null;
  if (!indexer) {
    verdict = { label: status.isError ? 'Status unavailable' : 'Loading…', tone: 'neutral' };
  } else if (indexer.error !== null || indexerTone === 'danger') {
    verdict = { label: 'Indexer error', tone: 'danger' };
    reason = indexer.error ?? `indexer status: ${indexer.status}`;
  } else if (!synced) {
    verdict = { label: 'Catching up', tone: 'warning' };
    reason = `${formatHeight(indexer.lagBlocks)} blocks behind the chain tip.`;
  } else if (riskTone === 'danger' || riskTone === 'warning') {
    verdict = { label: `Halt risk: ${risk?.haltRiskLevel}`, tone: riskTone };
    reason = risk?.haltRiskReason ?? null;
  } else {
    verdict = { label: 'Healthy', tone: 'success' };
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-serif text-3xl text-text">Overview</h1>
        <Link
          href="/diagnostics"
          title="Indexer & projection details"
          className="inline-flex items-center gap-2 rounded-full border border-card-border bg-card px-3 py-1 text-sm text-text-secondary hover:border-border-light hover:text-text"
        >
          <span aria-hidden="true" className={clsx('h-2 w-2 rounded-full', DOT[verdict.tone])} />
          {verdict.label}
        </Link>
      </div>
      {reason ? <p className="max-w-2xl text-sm text-text-muted">{reason}</p> : null}
    </div>
  );
}
