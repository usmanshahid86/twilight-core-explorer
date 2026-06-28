import { CoreSlotsList } from '@/components/coreslots/CoreSlotsList';
import { oneParam } from '@/lib/search-params';
import { coerceStatus, CORESLOT_STATUS_OPTIONS } from '@/lib/status-filters';

export const metadata = { title: "CoreSlots" };

export default function CoreSlotsPage({
  searchParams,
}: {
  searchParams: { status?: string | string[] };
}) {
  // Validate the raw URL param at the trust boundary: only canonical UPPERCASE enum values reach the
  // case-sensitive API filter; unknown/lowercase values normalize or drop to "All".
  const status = coerceStatus(oneParam(searchParams.status), CORESLOT_STATUS_OPTIONS);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl text-text">CoreSlots</h1>
        <p className="mt-1 text-sm text-text-muted">
          The CoreSlot PoA validator set — lifecycle, authority, liveness, and per-slot detail.
        </p>
      </div>
      <CoreSlotsList status={status} />
    </div>
  );
}
