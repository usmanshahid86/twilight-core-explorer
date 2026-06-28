import { CoreSlotsList } from '@/components/coreslots/CoreSlotsList';

export const metadata = { title: "CoreSlots" };

export default function CoreSlotsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl text-text">CoreSlots</h1>
        <p className="mt-1 text-sm text-text-muted">
          The CoreSlot PoA validator set — lifecycle, authority, liveness, and per-slot detail.
        </p>
      </div>
      <CoreSlotsList />
    </div>
  );
}
