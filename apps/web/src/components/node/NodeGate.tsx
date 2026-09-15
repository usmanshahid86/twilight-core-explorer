'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { NodeView } from './NodeView';
import { apiGet } from '@/lib/api/client';
import { getLinkedSlot, setLinkedSlot } from '@/lib/linked-slot';

// /node requires a linked slot; without one, a single centered prompt. Linking accepts a
// slot id, `slot N`, or an operator address (resolved through /api/v1/search — the page
// invents no lookup semantics). The link is per-browser (localStorage), never an auth.
export function NodeGate() {
  const [slotId, setSlotId] = useState<string | null | 'loading'>('loading');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSlotId(getLinkedSlot()?.slotId ?? null);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = value.trim();
    if (!q || busy) return;
    setError(null);

    const slotMatch = q.match(/^(?:slot\s+)?(\d+)$/i);
    if (slotMatch) {
      link({ slotId: slotMatch[1] as string });
      return;
    }
    if (/^twilight1[0-9a-z]+$/.test(q)) {
      setBusy(true);
      try {
        const res = (await apiGet('/api/v1/search', { q })) as {
          data: ({ type: string } & Record<string, unknown>)[];
        };
        const slot = res.data.find(
          (r) => r.type === 'coreslot' && typeof r.slotId === 'string',
        ) as { slotId: string } | undefined;
        if (slot) link({ slotId: slot.slotId, operatorAddress: q });
        else setError('No CoreSlot is registered to that address.');
      } catch {
        setError('Lookup failed — try again.');
      } finally {
        setBusy(false);
      }
      return;
    }
    setError('Enter a slot id (e.g. 3), `slot 3`, or a twilight1… operator address.');
  }

  function link(slot: { slotId: string; operatorAddress?: string }) {
    setLinkedSlot(slot);
    window.dispatchEvent(new Event('tw-linked-slot-changed'));
    setSlotId(slot.slotId);
  }

  if (slotId === 'loading') return null;

  if (slotId === null) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-5 text-center">
        <h1 className="font-serif text-5xl leading-[1.05] tracking-[-0.01em]">My node</h1>
        <p className="max-w-md text-[15px] text-text-secondary">
          Enter your operator address or slot to open your node view.
        </p>
        <form onSubmit={onSubmit} className="flex w-full max-w-md items-center gap-2.5 rounded-xl border border-card-border bg-background-secondary px-3 py-2 font-mono text-[13px]">
          <span aria-hidden="true" className="text-primary">
            ›
          </span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="slot 3 · or twilight1…"
            aria-label="Operator address or slot id"
            className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-text-muted"
          />
          <button
            type="submit"
            disabled={busy}
            className="shrink-0 rounded-md bg-background-tertiary px-3 py-1 text-[13px] text-text hover:text-primary"
          >
            {busy ? '…' : 'Open'}
          </button>
        </form>
        {error ? <p className="text-[13px] text-accent-red">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <NodeView slotId={slotId} />
      <button
        type="button"
        onClick={() => {
          setLinkedSlot(null);
          window.dispatchEvent(new Event('tw-linked-slot-changed'));
          setSlotId(null);
        }}
        className="self-start font-mono text-xs text-text-muted hover:text-text"
      >
        unlink slot {slotId}
      </button>
    </div>
  );
}
