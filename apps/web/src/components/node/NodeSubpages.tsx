'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SettlementsStatusSection } from '@/components/economy/SettlementsStatusSection';
import { EntitlementsSection } from '@/components/rewards/sections/EntitlementsSection';
import { getLinkedSlot } from '@/lib/linked-slot';

// /node/rewards and /node/settlements: the slot-scoped views of the existing reward and
// settlement sections. Both need the linked slot; without one they point back to /node.

function useLinked(): string | null | 'loading' {
  const [slotId, setSlotId] = useState<string | null | 'loading'>('loading');
  useEffect(() => {
    setSlotId(getLinkedSlot()?.slotId ?? null);
  }, []);
  return slotId;
}

function LinkPointer() {
  return (
    <p className="py-16 text-center text-[15px] text-text-secondary">
      No slot linked —{' '}
      <Link href="/node" className="text-primary hover:text-primary-light">
        open your node view
      </Link>{' '}
      to link one.
    </p>
  );
}

export function NodeRewardsPage() {
  const slotId = useLinked();
  if (slotId === 'loading') return null;
  if (slotId === null) return <LinkPointer />;
  return (
    <div className="flex flex-col gap-7">
      <h1 className="font-serif text-5xl leading-[1.05] tracking-[-0.01em]">Rewards</h1>
      <EntitlementsSection filter={{ slotId }} />
    </div>
  );
}

export function NodeSettlementsPage() {
  const slotId = useLinked();
  if (slotId === 'loading') return null;
  if (slotId === null) return <LinkPointer />;
  return (
    <div className="flex flex-col gap-7">
      <h1 className="font-serif text-5xl leading-[1.05] tracking-[-0.01em]">Settlements</h1>
      <SettlementsStatusSection slotId={slotId} />
    </div>
  );
}
