'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { LedgerList, LedgerMarker, LedgerRow } from '@/components/ledger/Ledger';
import {
  useLatestBlocks,
  useLivenessRisk,
  useRecentTxs,
  useStatus,
  useSupply,
} from '@/lib/api/queries';
import { averageBlockSeconds } from '@/lib/epoch-eta';
import { deriveIndexerFreshness } from '@/lib/freshness';
import { formatHeight } from '@/lib/format/height';
import { formatRelativeTime } from '@/lib/format/time';
import { formatAmount } from '@/lib/format/amount';
import { shortenMiddle } from '@/lib/format/address';
import { summarizeMessageTypes } from '@/lib/format/summary';

// Chain home (control-room handoff §2): verdict sentence + the two live ledgers. New rows
// prepend with a 600ms mint fade — tracked by remembering which keys were present last render.

function useFlashKeys(keys: string[]): Set<string> {
  const seen = useRef<Set<string> | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(keys);
      return;
    }
    const fresh = keys.filter((k) => !seen.current?.has(k));
    for (const k of keys) seen.current.add(k);
    if (fresh.length > 0) {
      setFlash(new Set(fresh));
      const t = setTimeout(() => setFlash(new Set()), 700);
      return () => clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys.join('|')]);
  return flash;
}

export function ChainHome() {
  const status = useStatus();
  const liveness = useLivenessRisk();
  const supply = useSupply();
  const blocks = useLatestBlocks(8);
  const txs = useRecentTxs(8);

  const indexer = status.data?.data.indexer;
  const risk = liveness.data?.data;
  const synced = deriveIndexerFreshness(indexer ?? null).kind === 'fresh';
  const avgSecs = averageBlockSeconds(blocks.data?.data.map((b) => b.time) ?? []);
  const coins = supply.data?.data.supply ?? [];
  const native = coins.find((c) => c.denom === 'utwlt') ?? coins[0];
  const total = native ? formatAmount(native.amount, native.denom) : null;

  const unhealthy = risk ? risk.activeSlotCount - risk.healthySlotCount : 0;
  const title = !indexer
    ? 'Chain'
    : !synced
      ? `Indexer ${formatHeight(indexer.lagBlocks)} blocks behind.`
      : unhealthy > 0
        ? `${unhealthy} CoreSlot${unhealthy === 1 ? '' : 's'} down.`
        : 'Network is healthy.';

  const blockRows = blocks.data?.data ?? [];
  const txRows = txs.data?.data ?? [];
  const blockFlash = useFlashKeys(blockRows.map((b) => b.height));
  const txFlash = useFlashKeys(txRows.map((t) => t.hash));

  return (
    <div className="flex flex-col gap-9">
      <div className="flex flex-col gap-3">
        <h1 className="font-serif text-5xl leading-[1.05] tracking-[-0.01em] text-text">{title}</h1>
        <p className="max-w-[620px] text-[15px] leading-relaxed text-text-muted">
          {risk ? `${risk.healthySlotCount} of ${risk.activeSlotCount} CoreSlots signing, ` : ''}
          {synced ? 'indexer at the chain tip' : 'indexer catching up'}
          {avgSecs !== null ? `, average block every ${avgSecs.toFixed(1)}s` : ''}.
          {total ? (
            <>
              {' '}
              Supply <span className="font-mono text-text">{total.display}</span> {total.symbol}.
            </>
          ) : null}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div>
          <LedgerMarker
            action={
              <Link href="/blocks" className="text-text-muted hover:text-text">
                all →
              </Link>
            }
          >
            Blocks
          </LedgerMarker>
          <LedgerList>
            {blockRows.map((b) => (
              <LedgerRow
                key={b.height}
                href={`/blocks/${encodeURIComponent(b.height)}`}
                grid="grid-cols-[96px_1fr_auto]"
                flash={blockFlash.has(b.height)}
              >
                <span className="font-mono">{formatHeight(b.height)}</span>
                <span className="truncate text-text-muted">
                  {b.txCount} tx{b.txCount === 1 ? '' : 's'}
                  {b.proposer.slotId ? ` · slot ${b.proposer.slotId}` : ''}
                </span>
                <span className="font-mono text-text-muted">{formatRelativeTime(b.time)}</span>
              </LedgerRow>
            ))}
          </LedgerList>
        </div>
        <div>
          <LedgerMarker
            action={
              <Link href="/txs" className="text-text-muted hover:text-text">
                all →
              </Link>
            }
          >
            Transactions
          </LedgerMarker>
          <LedgerList>
            {txRows.map((t) => {
              const failed = t.status !== 'success' && t.code !== 0;
              return (
                <LedgerRow
                  key={t.hash}
                  href={`/txs/${encodeURIComponent(t.hash)}`}
                  grid="grid-cols-[8px_1fr_120px_auto]"
                  flash={txFlash.has(t.hash)}
                  className="items-center"
                >
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 rounded-full ${failed ? 'bg-accent-red' : 'bg-primary'}`}
                  />
                  <span className="truncate">{summarizeMessageTypes(t.messageTypes)}</span>
                  <span className="truncate font-mono text-text-muted">{shortenMiddle(t.hash)}</span>
                  <span className="font-mono text-text-muted">{formatHeight(t.height)}</span>
                </LedgerRow>
              );
            })}
          </LedgerList>
        </div>
      </div>
    </div>
  );
}
