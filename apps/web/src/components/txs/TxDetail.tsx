'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CopyButton } from '@/components/ui/CopyButton';
import { JsonView } from '@/components/detail/JsonView';
import { RawSection } from '@/components/detail/RawSection';
import { EmptyState, ErrorState, LoadingState } from '@/components/states/States';
import { useTx, useTxRaw, type TxDetailResponse } from '@/lib/api/queries';
import { formatHeight } from '@/lib/format/height';
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/format/time';
import { formatAmount } from '@/lib/format/amount';
import { shortenMiddle } from '@/lib/format/address';
import { summarizeTxDetail, txParties } from '@/lib/format/summary';
import { activeTab, type TabDef } from '@/components/ui/Tabs';
import { clsx } from 'clsx';

type Message = TxDetailResponse['data']['messages'][number];
type TxEvent = TxDetailResponse['data']['events'][number];

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Fee coin as display text; null when there is no fee (zero-fee chain) or the shape is odd. */
function feeDisplay(fee: unknown): string | null {
  const coins = asRecord(fee).amount;
  const first = asRecord(Array.isArray(coins) ? coins[0] : undefined);
  if (typeof first.amount !== 'string' || typeof first.denom !== 'string') return null;
  const a = formatAmount(first.amount, first.denom);
  return `${a.display} ${a.symbol}`;
}

/** One-line "key=value" summary of an event's attributes, addresses shortened. */
function eventSummary(attributes: unknown): string {
  const list = Array.isArray(attributes) ? attributes : [];
  const parts: string[] = [];
  for (const entry of list) {
    const rec = asRecord(entry);
    const key = typeof rec.key === 'string' ? rec.key : undefined;
    let value = typeof rec.value === 'string' ? rec.value : undefined;
    if (!key || value === undefined || key === 'msg_index') continue;
    if (value.startsWith('twilight1') && value.length > 20) value = shortenMiddle(value);
    parts.push(`${key}=${value}`);
  }
  return parts.join(' · ') || '—';
}

function PartyRow({ label, address }: { label: string; address: string }) {
  return (
    <>
      <span className="text-text-muted">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 font-mono text-[13px]">
        <Link
          href={`/accounts/${encodeURIComponent(address)}`}
          className="break-all text-text hover:text-primary"
        >
          {address}
        </Link>
        <CopyButton value={address} label={label} />
      </span>
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[3px] border-b border-card-hover py-2.5">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="break-all font-mono text-[13px]">{children}</span>
    </div>
  );
}

function MessageCard({ m }: { m: Message }) {
  const [jsonOpen, setJsonOpen] = useState(false);
  const decoded = asRecord(m.decodedJson);
  const fields = Object.entries(decoded).filter(([k]) => k !== '@type');
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="font-mono text-xs text-text-muted">#{m.msgIndex}</span>
        <span className="font-semibold">
          {m.module ? `${m.module} · ` : ''}
          {m.typeName ?? m.typeUrl}
        </span>
        <span className="hidden font-mono text-xs text-text-muted sm:inline">{m.typeUrl}</span>
        {m.decodeError ? <span className="text-xs text-accent-red">decode error</span> : null}
      </div>
      {m.decodeError ? (
        <p className="text-xs text-accent-red">{m.decodeError}</p>
      ) : (
        <>
          <div className="border-t border-card-border">
            {fields.map(([key, value]) => (
              <div
                key={key}
                className="grid grid-cols-[110px_1fr] gap-3.5 border-b border-card-hover py-2.5 text-[13px]"
              >
                <span className="text-text-muted">{key}</span>
                <span className="break-all font-mono">
                  {typeof value === 'string' ? value : JSON.stringify(value)}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setJsonOpen((v) => !v)}
            className="self-start font-mono text-[12.5px] text-text-muted hover:text-text"
          >
            {jsonOpen ? '− hide decoded json' : '+ decoded json'}
          </button>
          {jsonOpen ? <JsonView value={m.decodedJson} /> : null}
        </>
      )}
    </div>
  );
}

// Control-room transaction page: caption (status · block · age), the summary-string h1,
// full from/to addresses, tabs (Messages · Events · Raw — zero-item tabs hidden), and a
// facts rail on the right. Only the active tab renders; raw fetches lazily on its tab.
export function TxDetail({ hash, tab: rawTab }: { hash: string; tab?: string | string[] | undefined }) {
  const query = useTx(hash);

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-7">
        <BackLink />
        <LoadingState rows={6} />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="flex flex-col gap-7">
        <BackLink />
        <h1 className="font-serif text-5xl leading-[1.05] tracking-[-0.01em]">Transaction</h1>
        <ErrorState error={query.error} context="Transaction" />
      </div>
    );
  }

  const t = query.data.data;
  const failed = t.status !== 'success' && t.code !== 0;
  const parties = txParties(t.messages, t.signerAddresses);
  const fee = feeDisplay(t.fee);

  const tabs: TabDef[] = [
    ...(t.messages.length > 0
      ? [{ id: 'messages', label: `Messages (${t.messages.length})` }]
      : []),
    ...(t.events.length > 0 ? [{ id: 'events', label: `Events (${t.events.length})` }] : []),
    { id: 'raw', label: 'Raw' },
  ];
  const tab = activeTab(tabs, rawTab);

  return (
    <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-7">
        <BackLink />

        <div className="flex flex-col gap-3">
          <div
            className={clsx(
              'font-mono text-xs uppercase tracking-[.1em]',
              failed ? 'text-accent-red' : 'text-primary',
            )}
          >
            {failed ? '✕ failed' : '✓ succeeded'} · block {formatHeight(t.height)} ·{' '}
            {formatRelativeTime(t.time)}
          </div>
          <h1 className="font-serif text-5xl leading-[1.05] tracking-[-0.01em]">
            {summarizeTxDetail(t.messages)}
            {failed && t.code != null ? (
              <>
                <br />
                <span className="font-medium text-text-muted">failed with code {t.code}.</span>
              </>
            ) : null}
          </h1>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3.5 gap-y-2 pt-1 text-[13px]">
            {parties.from && parties.to ? (
              <>
                <PartyRow label="from" address={parties.from} />
                <PartyRow label="to" address={parties.to} />
              </>
            ) : parties.signer ? (
              <PartyRow label="signer" address={parties.signer} />
            ) : null}
          </div>
        </div>

        <div className="flex gap-0.5 border-b border-card-border" role="tablist" aria-label="Transaction views">
          {tabs.map((tb) => (
            <Link
              key={tb.id}
              href={
                tb.id === tabs[0]?.id
                  ? `/txs/${encodeURIComponent(hash)}`
                  : `/txs/${encodeURIComponent(hash)}?tab=${tb.id}`
              }
              scroll={false}
              aria-current={tab === tb.id ? 'page' : undefined}
              className={clsx(
                '-mb-px border-b-2 px-3 py-[9px] text-[13px] font-medium',
                tab === tb.id
                  ? 'border-primary text-text'
                  : 'border-transparent text-text-muted hover:text-text',
              )}
            >
              {tb.label}
            </Link>
          ))}
        </div>

        {tab === 'messages' ? (
          <div className="flex flex-col gap-6">
            {t.messages.map((m) => (
              <MessageCard key={m.msgIndex} m={m} />
            ))}
          </div>
        ) : null}

        {tab === 'events' ? (
          t.events.length === 0 ? (
            <EmptyState message="No events." />
          ) : (
            <div className="border-t border-card-border">
              {t.events.map((e: TxEvent, i) => (
                <div
                  key={`${e.phase}-${e.type}-${i}`}
                  className="grid grid-cols-[150px_1fr] gap-3.5 border-b border-card-hover py-2.5 text-[13px]"
                >
                  <span className="break-all font-mono text-primary">{e.type}</span>
                  <span className="break-words text-text-secondary">{eventSummary(e.attributes)}</span>
                </div>
              ))}
            </div>
          )
        ) : null}

        {tab === 'raw' ? <RawTab hash={hash} /> : null}
      </div>

      {/* Facts rail */}
      <div className="border-l border-card-border pl-6 text-[13px] lg:mt-10">
        <Fact label="hash">
          <span className="inline-flex items-start gap-1.5">
            <span className="break-all">{t.hash}</span>
            <CopyButton value={t.hash} label="tx hash" />
          </span>
        </Fact>
        <Fact label="fee">{fee ?? '—'}</Fact>
        <Fact label="gas used / wanted">{`${t.gasUsed ?? '—'} / ${t.gasWanted ?? '—'}`}</Fact>
        <Fact label="index in block">{t.index}</Fact>
        <Fact label="time">{formatAbsoluteTime(t.time)}</Fact>
        <Fact label="memo">{t.memo ? t.memo : '—'}</Fact>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/txs" className="font-mono text-xs text-text-muted hover:text-text">
      ← transactions
    </Link>
  );
}

// Mounted only while the Raw tab is active, so the raw payload is fetched on demand.
function RawTab({ hash }: { hash: string }) {
  const raw = useTxRaw(hash, true);
  return <RawSection expanded onToggle={() => {}} query={raw} />;
}
