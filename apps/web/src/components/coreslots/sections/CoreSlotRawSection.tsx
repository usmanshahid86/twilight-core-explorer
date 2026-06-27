'use client';

import { useState } from 'react';
import { RawSection } from '@/components/detail/RawSection';
import { useCoreSlotRaw } from '@/lib/api/queries';

// Lazy raw: the include=raw request fires only after expansion (useCoreSlotRaw enabled on open).
export function CoreSlotRawSection({ slotId }: { slotId: string }) {
  const [open, setOpen] = useState(false);
  const raw = useCoreSlotRaw(slotId, open);
  return <RawSection expanded={open} onToggle={() => setOpen((o) => !o)} query={raw} />;
}
