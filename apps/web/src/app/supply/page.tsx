import { SupplyView } from '@/components/supply/SupplyView';

export const metadata = { title: "Supply" };

export default function SupplyPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl text-text">Supply</h1>
        <p className="mt-1 text-sm text-text-muted">
          Observed total supply by denom at a sampled height — read-only, not a computed economic
          breakdown.
        </p>
      </div>
      <SupplyView />
    </div>
  );
}
