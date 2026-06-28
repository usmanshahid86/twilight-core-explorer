import { ClaimsSection } from '@/components/rewards/sections/ClaimsSection';

/** A searchParam is `string | string[] | undefined`; coerce to a single string for the filter. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export const metadata = { title: "Claim history" };

export default function RewardsClaimsPage({
  searchParams,
}: {
  searchParams: { slotId?: string | string[]; claimant?: string | string[] };
}) {
  const slotId = one(searchParams.slotId);
  const claimant = one(searchParams.claimant);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl text-text">Claim history</h1>
        <p className="mt-1 text-sm text-text-muted">
          Historical reward claim events{slotId ? ` for CoreSlot ${slotId}` : ''}. Read-only — the
          explorer performs no claim action.
        </p>
      </div>
      <ClaimsSection filter={{ slotId, claimant }} />
    </div>
  );
}
