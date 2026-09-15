'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CopyButton } from '@/components/ui/CopyButton';
import { OperatorLink } from '@/components/operator/OperatorLink';
import { EmptyState, ErrorState, InvalidInput, LoadingState } from '@/components/states/States';
import { RawSection } from '@/components/detail/RawSection';
import { BlockTxsSection } from './BlockTxsSection';
import { isNotFound } from '@/lib/api/client';
import { useBlock, useBlockRaw, useStatus } from '@/lib/api/queries';
import { deriveHeightIndexingState } from '@/lib/freshness';
import { formatHeight } from '@/lib/format/height';
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/format/time';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[3px] border-b border-card-hover py-2.5">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="break-all font-mono text-[13px]">{children}</span>
    </div>
  );
}

function NavLine({ height }: { height?: string }) {
  const h = height && /^[1-9]\d*$/.test(height) ? BigInt(height) : null;
  return (
    <div className="flex gap-4 font-mono text-xs text-text-muted">
      <Link href="/chain" className="hover:text-text">
        ← chain
      </Link>
      {h !== null ? (
        <>
          <span aria-hidden="true">·</span>
          {h > 1n ? (
            <Link href={`/blocks/${(h - 1n).toString()}`} className="hover:text-text">
              ‹ {formatHeight((h - 1n).toString())}
            </Link>
          ) : null}
          <Link href={`/blocks/${(h + 1n).toString()}`} className="hover:text-text">
            {formatHeight((h + 1n).toString())} ›
          </Link>
        </>
      ) : null}
    </div>
  );
}

// Control-room block page: nav line (← chain · ‹ prev next ›), caption (age · proposed by),
// the h1, a transactions ledger, `+ raw block` (lazy), and the facts rail on the right.
export function BlockDetail({ height }: { height: string; tab?: string | string[] | undefined }) {
  // Client-side, string-safe malformed-height check (no Number()): a canonical positive integer
  // (rejects "0", leading zeros, and empty). The API still validates (invalid_height / not_found)
  // and ErrorState branches on error.code.
  const valid = /^[1-9]\d*$/.test(height);
  const query = useBlock(valid ? height : '');
  const status = useStatus();
  const [rawOpen, setRawOpen] = useState(false);
  const raw = useBlockRaw(valid ? height : '', rawOpen);

  if (!valid) {
    return (
      <div className="flex flex-col gap-7">
        <NavLine />
        <h1 className="font-serif text-5xl leading-[1.05] tracking-[-0.01em]">Block {height}</h1>
        <InvalidInput message="Block height must be a positive integer." />
      </div>
    );
  }
  if (query.isPending) {
    return (
      <div className="flex flex-col gap-7">
        <NavLine height={height} />
        <LoadingState rows={6} />
      </div>
    );
  }
  if (query.isError) {
    // During backfill a not_found for an on-chain height means "not indexed YET" — an expected
    // state worth naming, not a hard failure.
    const heightState = isNotFound(query.error)
      ? deriveHeightIndexingState(height, status.data?.data.indexer ?? null)
      : { kind: 'unknown' as const };
    return (
      <div className="flex flex-col gap-7">
        <NavLine height={height} />
        <h1 className="font-serif text-5xl leading-[1.05] tracking-[-0.01em]">Block {formatHeight(height)}</h1>
        {heightState.kind === 'pending' ? (
          <EmptyState
            message={`Block ${formatHeight(height)} isn’t indexed yet — the indexer is at ${formatHeight(
              heightState.lastIndexedHeight,
            )} of ${formatHeight(heightState.latestChainHeight)}. It will appear as the backfill catches up.`}
          />
        ) : heightState.kind === 'beyond-tip' ? (
          <EmptyState
            message={`Block ${formatHeight(height)} doesn’t exist yet — the chain tip is ${formatHeight(
              heightState.latestChainHeight,
            )}.`}
          />
        ) : (
          <ErrorState error={query.error} context="Block" />
        )}
      </div>
    );
  }

  const b = query.data.data;

  return (
    <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-7">
        <NavLine height={b.height} />

        <div className="flex flex-col gap-3">
          <div className="font-mono text-xs uppercase tracking-[.1em] text-text-muted">
            {formatRelativeTime(b.time)} · proposed by{' '}
            {b.proposer.operatorAddress ? (
              <OperatorLink operatorAddress={b.proposer.operatorAddress} />
            ) : (
              <span>{b.proposer.slotId ? `slot ${b.proposer.slotId}` : 'unknown'}</span>
            )}
            {b.proposer.slotId && b.proposer.operatorAddress ? ` · slot ${b.proposer.slotId}` : ''}
          </div>
          <h1 className="font-serif text-5xl leading-[1.05] tracking-[-0.01em]">
            Block {formatHeight(b.height)}
          </h1>
        </div>

        <div className="font-mono text-xs uppercase tracking-[.08em] text-primary">
          ⸸ {b.txCount} transaction{b.txCount === 1 ? '' : 's'}
        </div>
        <div className="-mt-4">
          <BlockTxsSection height={b.height} />
        </div>

        <button
          type="button"
          onClick={() => setRawOpen((o) => !o)}
          className="self-start font-mono text-[12.5px] text-text-muted hover:text-text"
        >
          {rawOpen ? '− hide raw block' : '+ raw block'}
        </button>
        {rawOpen ? <RawSection expanded onToggle={() => setRawOpen((o) => !o)} query={raw} /> : null}
      </div>

      {/* Facts rail */}
      <div className="border-l border-card-border pl-6 text-[13px] lg:mt-10">
        <Fact label="hash">
          {b.hash ? (
            <span className="inline-flex items-start gap-1.5">
              <span className="break-all">{b.hash}</span>
              <CopyButton value={b.hash} label="block hash" />
            </span>
          ) : (
            '—'
          )}
        </Fact>
        <Fact label="time">{formatAbsoluteTime(b.time)}</Fact>
        <Fact label="app hash">{b.appHash}</Fact>
        <Fact label="previous">{b.lastBlockHash}</Fact>
        <Fact label="chain">{b.chainId ?? '—'}</Fact>
      </div>
    </div>
  );
}
