'use client';

import Link from 'next/link';
import { useState } from 'react';
import { clsx } from 'clsx';
import { MarksLegend, SourceChip } from '@/components/provenance/SourceChip';
import { MetadataFields, hasMetadataFields } from '@/components/detail/MetadataFields';
import { CopyButton } from '@/components/ui/CopyButton';
import { ErrorState, LoadingState } from '@/components/states/States';
import { CoreSlotDetail } from '@/components/coreslots/CoreSlotDetail';
import { OperatorTrackRecord } from './OperatorTrackRecord';
import { OperatorClockPanel } from './OperatorClockPanel';
import { Panel, MetricTriple } from './Panel';
import {
  useFeedEpochFanout,
  useOperatorProfile,
  useSettlementStatus,
  useSlotSettlements,
  type OperatorProfileResponse,
} from '@/lib/api/queries';
import { asRecord, feedNumber, feedString } from '@/lib/operator-feed';
import { formatAmount } from '@/lib/format/amount';
import { formatHeight } from '@/lib/format/height';
import { formatRewardWeight, formatSlotStatus } from '@/lib/format/slot';
import { curatedOperator } from '@/lib/operator-directory';

// Operator Profile v2: verdict as four metric triples → sticky join card → track record →
// epoch timeline → rules + transparency → identity. Same three questions as v1 (who is this,
// do they pay, what am I signing up for), ordered by what a newcomer decides on, with the CTA
// always visible. No trust score — the figures are the whole of the explorer's opinion.

type Profile = OperatorProfileResponse['data'];

function keptRatioPercent(kept: string, entitlement: string): number | null {
  try {
    const e = BigInt(entitlement);
    if (e === 0n) return 0;
    return Number((BigInt(kept) * 1000n) / e) / 10;
  } catch {
    return null;
  }
}

function AboutRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-card-hover py-2">
      <span className="shrink-0 text-text-muted">{label}</span>
      <span className="min-w-0 text-right text-text-secondary">{children}</span>
    </div>
  );
}

function CodeLine({ text }: { text: string }) {
  return (
    <span className="flex items-center justify-between gap-2 rounded-lg border border-card-border bg-background-secondary px-3 py-2 font-mono text-xs">
      <span>{text}</span>
      <CopyButton value={text} label={text} />
    </span>
  );
}

function verdictSentence(v: NonNullable<Profile['verdict']>, mismatches: number): string {
  if (mismatches > 0) {
    return `${mismatches} epoch${mismatches === 1 ? '' : 's'} where published figures disagreed with the chain.`;
  }
  if (v.settledAll === v.owedAll && v.owedAll > 0) {
    return 'Pays every epoch it owes, on time, and its published figures match the chain.';
  }
  const open = v.owedAll - v.settledAll;
  return `Has settled ${v.settledAll} of ${v.owedAll} epochs; ${open} epoch${open === 1 ? '' : 's'} open past the expected window.`;
}

export function OperatorProfile({ slotId }: { slotId: string }) {
  const profile = useOperatorProfile(slotId);
  const settlements = useSettlementStatus({ slotId });
  const activity = useSlotSettlements(slotId);
  const [showSlotDetail, setShowSlotDetail] = useState(false);

  const statusRows = settlements.data?.pages.flatMap((p) => p.data) ?? [];
  const settledEpochs = statusRows.filter((r) => r.settled).map((r) => r.epochNumber);
  const feed = useFeedEpochFanout(slotId, settledEpochs);

  if (profile.isPending) return <LoadingState rows={10} />;
  if (profile.isError) return <ErrorState error={profile.error} context="Operator profile" />;

  const p = profile.data.data;
  const v = p.verdict;
  const curated = curatedOperator(p.identity.slotId);
  const meta = asRecord(p.identity.metadata);
  const moniker = feedString(meta['moniker']);
  const displayName = curated?.name ?? moniker ?? `CoreSlot ${p.identity.slotId} operator`;
  const declaredExtras = Object.fromEntries(Object.entries(meta).filter(([k]) => k !== 'moniker'));
  const discovery = p.discovery ? asRecord(p.discovery.payload) : null;
  const drawRecord = discovery ? feedString(discovery['draw_record']) : null;
  const allocHash = discovery
    ? asRecord(discovery['commitments'])['allocation_result_hash'] === true
    : false;

  const feedResults = (feed.data ?? []).flatMap((f) => (f.data && 'verification' in f.data ? [f.data] : []));
  const mismatches = feedResults.filter((f) => f.verification.result === 'mismatch').length;

  // Chain-side derived figures the API doesn't carry verbatim.
  const worstLatency = statusRows.reduce<bigint | null>((acc, r) => {
    if (r.latencyBlocks === null) return acc;
    const l = BigInt(r.latencyBlocks);
    return acc === null || l > acc ? l : acc;
  }, null);
  const keptPct = v ? keptRatioPercent(v.kept30, v.entitlement30) : null;

  // YOUR ESTIMATED SHARE: latest entitlement ÷ (admitted + 1).
  const latestEnt = statusRows[0] ?? null;
  const latestFeedSettled = feedResults[0] ?? null;
  const admitted =
    (latestFeedSettled
      ? feedNumber(asRecord(asRecord(latestFeedSettled.payload)['counts'])['admitted'])
      : null) ??
    (() => {
      const acts = activity.data?.pages.flatMap((pg) => pg.data) ?? [];
      const last = acts.find((a) => a.payoutCount > 0);
      return last ? last.payoutCount : null;
    })();
  let estShare: { value: string; note: string } | null = null;
  if (latestEnt && admitted !== null) {
    try {
      const budget = BigInt(latestEnt.entitlementAmount);
      const share = budget / BigInt(admitted + 1);
      const shareFmt = formatAmount(share.toString(), latestEnt.denom);
      const budgetFmt = formatAmount(latestEnt.entitlementAmount, latestEnt.denom);
      estShare = {
        value: `~${shareFmt.display}`,
        note: `${budgetFmt.display} ÷ ${admitted + 1} if you join and everyone else stays. Equal split; the chain sets the budget.`,
      };
    } catch {
      estShare = null;
    }
  }

  const paid30 = v ? formatAmount(v.paid30, v.denom) : null;
  const slotStatus = formatSlotStatus(p.identity.status);

  const transparencyChecks: {
    name: string;
    note: string;
    state: 'yes' | 'no' | 'not-published';
    src: 'chain' | 'attested' | null;
  }[] = [
    {
      name: 'Publishes operator status',
      note: p.discovery
        ? `twilight-operator-status-v1${p.discovery.ageSeconds !== null ? ` · ${p.discovery.ageSeconds}s old` : ''}${
            discovery && discovery['retention_epochs'] != null
              ? ` · ${String(discovery['retention_epochs'])} epochs of history`
              : ''
          }`
        : 'no feed discovered for this slot',
      state: p.discovery ? 'yes' : 'no',
      src: p.discovery ? 'attested' : null,
    },
    {
      name: 'Draw record published',
      note: drawRecord ?? 'no draw record advertised',
      state: drawRecord ? 'yes' : 'not-published',
      src: drawRecord ? 'attested' : null,
    },
    {
      name: 'Sealed allocation hash',
      note: allocHash
        ? 'recorded per epoch; verifiable once the chain carries it'
        : 'not advertised',
      state: allocHash ? 'yes' : 'not-published',
      src: allocHash ? 'attested' : null,
    },
    {
      name: 'Dedicated settlement account',
      note: p.settlementAccountCheck
        ? `${p.settlementAccountCheck.foreignTxCount} non-settlement txs from the settlement address (ADR-MINIS-0010)`
        : 'no settlement address on record',
      state: p.settlementAccountCheck
        ? p.settlementAccountCheck.foreignTxCount === 0
          ? 'yes'
          : 'no'
        : 'not-published',
      src: p.settlementAccountCheck ? 'chain' : null,
    },
    {
      name: 'Payout-change aggregates',
      note: 'the feed does not carry this today',
      state: 'not-published',
      src: null,
    },
  ];

  return (
    <div className="flex flex-col gap-7">
      <Link href="/slots?tab=operators" className="font-mono text-xs text-text-muted hover:text-text">
        ← operators
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-center gap-3.5">
          <h1 className="font-serif text-5xl leading-[1.05] tracking-[-0.01em]">
            {displayName}
          </h1>
          <span className="whitespace-nowrap rounded-full border border-primary/40 px-2.5 py-[3px] font-mono text-[11px] uppercase tracking-[.08em] text-primary">
            CoreSlot {p.identity.slotId}
            {slotStatus ? ` · ${slotStatus}` : ''}
          </span>
          <span className="whitespace-nowrap rounded-full border border-border-light px-2.5 py-[3px] font-mono text-[11px] uppercase tracking-[.08em] text-text-muted">
            {p.discovery
              ? `publishes status${p.discovery.ageSeconds !== null ? ` · ${p.discovery.ageSeconds}s old` : ''}`
              : 'no status published'}
          </span>
        </div>
        <p className="max-w-3xl text-[15px] leading-relaxed text-text-secondary">
          {v ? verdictSentence(v, mismatches) : 'No reward epochs owed yet — nothing to judge.'}{' '}
          Everything below is recomputable from indexed events; the operator&apos;s own claims
          are marked <SourceChip kind="attested" /> and checked against the chain.
        </p>
      </div>

      {/* About this operator — the public-facing, plain-language layer. Curated by the
          explorer until operators publish it on chain, and labelled so (configured). */}
      {curated ? (
        <Panel
          title="About this operator"
          meta={
            <>
              curated by the explorer · <SourceChip kind="configured" />
            </>
          }
        >
          <div className="flex flex-col gap-4">
            {curated.disclaimer ? (
              <p className="rounded-lg border border-accent-orange/40 bg-accent-orange/10 px-4 py-2.5 text-[13px] leading-relaxed text-accent-orange">
                {curated.disclaimer}
              </p>
            ) : null}
            <div className="grid grid-cols-1 gap-x-10 gap-y-2.5 text-sm md:grid-cols-2">
              <AboutRow label="Who runs it">{curated.ownedBy}</AboutRow>
              <AboutRow label="Website">
                {curated.website ? (
                  <a
                    href={curated.website}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary hover:text-primary-light"
                  >
                    {curated.website.replace(/^https?:\/\//, '')} ↗
                  </a>
                ) : (
                  '—'
                )}
              </AboutRow>
              <AboutRow label="What it does">{curated.service}</AboutRow>
              <AboutRow label="Rewards given till now">
                {v ? (
                  <span>
                    <span className="font-mono text-text">
                      {formatAmount(v.paidAll, v.denom).display}
                    </span>{' '}
                    {formatAmount(v.paidAll, v.denom).symbol} paid out to participants{' '}
                    <SourceChip kind="chain" title="Sum of every settlement payout, from indexed events" />
                  </span>
                ) : (
                  'none yet'
                )}
              </AboutRow>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[11px] uppercase tracking-[.08em] text-text-muted">
                How rewards are shared
              </span>
              <p className="max-w-3xl text-sm leading-relaxed text-text-secondary">
                {curated.distributionPolicy}
              </p>
            </div>
            {curated.about.map((para, i) => (
              <p key={i} className="max-w-3xl text-sm leading-relaxed text-text-secondary">
                {para}
              </p>
            ))}
          </div>
        </Panel>
      ) : null}

      {/* Do they pay? */}
      <Panel
        title="Do they pay?"
        meta={
          v ? (
            <>
              last 30 days · {v.settled30} epochs · <span className="text-primary">chain</span>
            </>
          ) : (
            <span className="text-primary">chain</span>
          )
        }
      >
        {v ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <MetricTriple
              label="Epochs settled"
              value={`${v.settledAll} / ${v.owedAll}`}
              tone={v.settledAll === v.owedAll ? 'mint' : 'text'}
              note={
                v.settledAll === v.owedAll
                  ? 'Every epoch with an entitlement has a settlement on chain. All time.'
                  : `${v.owedAll - v.settledAll} open.`
              }
            />
            <MetricTriple
              label="Paid out (30d)"
              value={paid30 ? paid30.display : '—'}
              unit={paid30?.symbol}
              note={`To ${v.recipients30} distinct participants across ${v.settled30} epochs.`}
            />
            <MetricTriple
              label="Kept as remainder"
              value={keptPct !== null ? keptPct.toFixed(1) : '—'}
              unit="%"
              tone={keptPct !== null && keptPct > 10 ? 'orange' : 'text'}
              note="Integer-division residue sent to the operator payout address. Equal split leaves ≤ admitted−1 units."
            />
            <MetricTriple
              label="Settlement latency"
              value={v.medianLatencyBlocks !== null ? `+${v.medianLatencyBlocks}` : '—'}
              unit="blocks"
              note={`Median blocks between epoch close and settlement tx.${worstLatency !== null ? ` Worst: +${worstLatency}.` : ''}`}
            />
          </div>
        ) : (
          <p className="text-sm text-text-muted">No reward epochs owed yet — nothing to judge.</p>
        )}
      </Panel>

      {/* Two-column block: join card first in DOM (right on wide, top when stacked) */}
      <div className="flex flex-row-reverse flex-wrap items-start gap-6">
        <div className="flex max-w-full flex-[1_1_300px] flex-col gap-4 min-[1100px]:sticky min-[1100px]:top-6">
          <Panel title="Mine with this operator" tinted bodyClassName="flex flex-col gap-4 px-5 py-[18px]">
            {estShare ? (
              <MetricTriple
                label="Your estimated share"
                value={estShare.value}
                unit={`${latestEnt ? formatAmount('0', latestEnt.denom).symbol : 'TWLT'} / epoch`}
                tone="mint"
                note={estShare.note}
              />
            ) : null}
            <div className="flex flex-col gap-2">
              {[
                'Install the client and run connect. It registers your agent and prints one claim link.',
                'Open the claim link once. Search works immediately; mining is opt-in at the terminal.',
                'Set the slot below. Payouts go to an address your client declares.',
              ].map((text, i) => (
                <div key={i} className="grid grid-cols-[20px_1fr] gap-2.5 text-[13px] leading-relaxed text-text-secondary">
                  <span className="font-mono text-text-muted">{i + 1}</span>
                  <span>{text}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[11px] uppercase tracking-[.08em] text-text-muted">
                Config
              </span>
              <CodeLine text={`[mining] slot_id = ${p.identity.slotId}`} />
              <CodeLine text="dropin-miner connect" />
            </div>
            <span className="font-mono text-[11.5px] leading-relaxed text-text-muted">
              Your own per-epoch status is served only to you via{' '}
              <span className="text-text-secondary">dropin-miner status</span>.
            </span>
          </Panel>
          <MarksLegend />
        </div>

        <div className="flex min-w-0 flex-[1000_1_460px] flex-col gap-6">
          <OperatorTrackRecord slotId={slotId} />
          <OperatorClockPanel slotId={slotId} />

          {/* Rules + Transparency */}
          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
            <Panel title="How the pot is split" meta={<span className="text-primary">chain</span>}>
              <div className="flex flex-col gap-4">
                <div className="rounded-lg border border-card-border bg-background-secondary px-3.5 py-3 font-mono text-[15px] leading-relaxed">
                  share = ⌊ budget ÷ admitted ⌋
                  <br />
                  <span className="text-text-muted">remainder → operator payout address</span>
                </div>
                {[
                  ['Budget', `Fixed by the chain per epoch: this slot's reward at weight ${formatRewardWeight(p.identity.rewardWeight)}. The operator cannot change it.`],
                  ['Who gets it', 'Anyone admitted for the epoch: enrolled in time, verified activity, valid payout address.'],
                  ['Enforcement', 'The chain does not check the split. The explorer does, for every settled epoch. Result is the mark on each Track record row.'],
                ].map(([label, text]) => (
                  <div key={label} className="grid grid-cols-[110px_1fr] gap-3 text-[13px] leading-relaxed">
                    <span className="pt-0.5 font-mono text-[11px] uppercase tracking-[.08em] text-text-muted">
                      {label}
                    </span>
                    <span className="text-text-secondary">{text}</span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Transparency" meta={`${transparencyChecks.length} checks`} bodyClassName="">
              {transparencyChecks.map((c) => (
                <div
                  key={c.name}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-card-hover px-5 py-2.5 text-[13px] last:border-b-0"
                >
                  <span className="flex flex-col gap-0.5">
                    <span>{c.name}</span>
                    <span className="break-all font-mono text-[11px] leading-relaxed text-text-muted">
                      {c.note}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <span
                      className={clsx(
                        'whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[11px]',
                        c.state === 'yes'
                          ? 'border-primary/50 text-primary'
                          : c.state === 'no'
                            ? 'border-accent-red/50 text-accent-red'
                            : 'border-border-light text-text-muted',
                      )}
                    >
                      {c.state === 'yes' ? '✓ yes' : c.state === 'no' ? '✕ no' : '— not published'}
                    </span>
                    {c.src ? <SourceChip kind={c.src} /> : null}
                  </span>
                </div>
              ))}
            </Panel>
          </div>

          {/* Identity */}
          <Panel
            title="Identity on chain"
            meta={
              <>
                admitted by the chain authority, not by fee ·{' '}
                <span className="text-primary">chain</span>
              </>
            }
            bodyClassName="px-5 pb-4 pt-1.5"
          >
            <div className="grid grid-cols-1 gap-x-10 md:grid-cols-2">
              {(
                [
                  ['Operator address', p.identity.operatorAddress, null],
                  ['Registered', p.identity.createdHeight ? `block ${formatHeight(p.identity.createdHeight)}` : null, null],
                  ['Payout address', p.identity.payoutAddress, 'remainder goes here'],
                  ['Settlement address', p.identity.settlementAddress, 'signs settlements'],
                  ['Consensus power', p.identity.consensusPower, null],
                  ['Reward weight', formatRewardWeight(p.identity.rewardWeight), null],
                ] as [string, string | null, string | null][]
              ).map(([label, value, hint]) => (
                <div key={label} className="flex flex-col gap-0.5 border-b border-card-hover py-2.5">
                  <span className="text-xs text-text-muted">{label}</span>
                  <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-2.5 font-mono text-[13px]">
                    <span className="min-w-0 flex-[1_1_200px] truncate" title={value ?? undefined}>
                      {value ?? '—'}
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
                      {hint}
                      {value && value.startsWith('twilight1') ? (
                        <CopyButton value={value} label={label} />
                      ) : null}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            {p.settlementAccountCheck && p.settlementAccountCheck.foreignTxCount > 0 ? (
              <p className="pt-3 text-xs leading-relaxed text-accent-red">
                {p.settlementAccountCheck.foreignTxCount} non-settlement transaction
                {p.settlementAccountCheck.foreignTxCount === 1 ? '' : 's'} from the settlement
                address:{' '}
                {p.settlementAccountCheck.foreignTxHashes.slice(0, 3).map((h, i) => (
                  <Link key={h} href={`/txs/${encodeURIComponent(h)}`} className="underline">
                    {i > 0 ? ', ' : ''}
                    {h.slice(0, 10)}…
                  </Link>
                ))}
              </p>
            ) : null}
            <div className="mt-3.5 flex flex-col gap-2 rounded-lg border border-dashed border-border-light px-4 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[11px] uppercase tracking-[.08em] text-text-muted">
                  Declared by the operator
                </span>
                <SourceChip kind="declared" title="Never verified" />
              </div>
              {moniker || hasMetadataFields(declaredExtras) ? (
                <div className="flex flex-col gap-1.5 text-[13px]">
                  {moniker ? (
                    <div className="flex gap-3.5">
                      <span className="text-text-muted">Name</span>
                      <span>{moniker}</span>
                    </div>
                  ) : null}
                  <MetadataFields value={declaredExtras} />
                </div>
              ) : (
                <span className="text-[13px] text-text-muted">declared: nothing</span>
              )}
              <span className="font-mono text-[11px] leading-relaxed text-text-muted">
                The operator&apos;s own words from on-chain metadata. Rendered, never verified.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowSlotDetail((x) => !x)}
              className="mt-3.5 self-start font-mono text-[12.5px] text-text-muted hover:text-text"
            >
              {showSlotDetail ? '− hide slot detail' : '+ full slot detail (signing, key history, raw)'}
            </button>
            {showSlotDetail ? (
              <div className="pt-3">
                <CoreSlotDetail slotId={slotId} embedded />
              </div>
            ) : null}
          </Panel>
        </div>
      </div>
    </div>
  );
}
