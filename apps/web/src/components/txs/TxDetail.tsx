'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { MonoCopy } from '@/components/ui/MonoCopy';
import { DataList } from '@/components/detail/DataList';
import { DetailShell } from '@/components/detail/DetailShell';
import { JsonView } from '@/components/detail/JsonView';
import { RawSection } from '@/components/detail/RawSection';
import { EmptyState, ErrorState, LoadingState } from '@/components/states/States';
import { useTx, useTxRaw, type TxDetailResponse } from '@/lib/api/queries';
import { formatHeight } from '@/lib/format/height';
import { formatAbsoluteTime } from '@/lib/format/time';
import { statusTone } from '@/lib/format/status';

type Message = TxDetailResponse['data']['messages'][number];
type TxEvent = TxDetailResponse['data']['events'][number];

export function TxDetail({ hash }: { hash: string }) {
  const query = useTx(hash);
  const [rawOpen, setRawOpen] = useState(false);
  const raw = useTxRaw(hash, rawOpen);

  if (query.isPending) {
    return (
      <DetailShell title="Transaction">
        <LoadingState rows={6} />
      </DetailShell>
    );
  }
  if (query.isError) {
    return (
      <DetailShell title="Transaction">
        <ErrorState error={query.error} context="Transaction" />
      </DetailShell>
    );
  }

  const t = query.data.data;
  return (
    <DetailShell title="Transaction">
      <Card>
        <CardBody>
          <DataList
            items={[
              { label: 'Hash', value: <MonoCopy value={t.hash} head={20} tail={12} label="tx hash" /> },
              {
                label: 'Height',
                value: (
                  <Link
                    href={`/blocks/${encodeURIComponent(t.height)}`}
                    className="font-mono text-primary hover:text-primary-light"
                  >
                    {formatHeight(t.height)}
                  </Link>
                ),
              },
              { label: 'Index', value: <span className="font-mono">{t.index}</span> },
              { label: 'Status', value: <Badge tone={statusTone(t.status)}>{t.status}</Badge> },
              { label: 'Code', value: <span className="font-mono">{t.code ?? '—'}</span> },
              { label: 'Time', value: formatAbsoluteTime(t.time) },
              {
                label: 'Gas (used / wanted)',
                value: <span className="font-mono">{`${t.gasUsed ?? '—'} / ${t.gasWanted ?? '—'}`}</span>,
              },
              { label: 'Memo', value: t.memo ? t.memo : '—' },
              {
                label: 'Signers',
                value: t.signerAddresses.length ? (
                  <div className="space-y-1">
                    {t.signerAddresses.map((a, i) => (
                      <MonoCopy key={`${a}-${i}`} value={a} label="signer" />
                    ))}
                  </div>
                ) : (
                  '—'
                ),
              },
              { label: 'Fee', value: <JsonView value={t.fee} /> },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`Messages (${t.messages.length})`} />
        <CardBody>
          {t.messages.length === 0 ? (
            <EmptyState message="No messages." />
          ) : (
            <div className="space-y-4">
              {t.messages.map((m: Message) => (
                <div key={m.msgIndex} className="rounded-xl border border-card-border bg-background-secondary p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="info">#{m.msgIndex}</Badge>
                    <span className="font-mono text-sm text-text">{m.typeName ?? m.typeUrl}</span>
                    {m.module ? <Badge tone="neutral">{m.module}</Badge> : null}
                    {m.decodeError ? <Badge tone="danger">decode error</Badge> : null}
                  </div>
                  {m.decodeError ? (
                    <p className="mt-2 text-xs text-accent-red">{m.decodeError}</p>
                  ) : (
                    <div className="mt-2">
                      <JsonView value={m.decodedJson} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`Events (${t.events.length})`} />
        <CardBody>
          {t.events.length === 0 ? (
            <EmptyState message="No events." />
          ) : (
            <div className="space-y-3">
              {t.events.map((e: TxEvent, i) => (
                <div
                  key={`${e.phase}-${e.type}-${i}`}
                  className="rounded-xl border border-card-border bg-background-secondary p-3"
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone="neutral">{e.phase}</Badge>
                    <span className="font-mono text-text">{e.type}</span>
                  </div>
                  <div className="mt-2">
                    <JsonView value={e.attributes} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <RawSection expanded={rawOpen} onToggle={() => setRawOpen((o) => !o)} query={raw} />
    </DetailShell>
  );
}
