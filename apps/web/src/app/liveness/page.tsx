import { LivenessOverview } from '@/components/liveness/LivenessOverview';
import { PerSlotHealthTable } from '@/components/liveness/PerSlotHealthTable';

export default function LivenessPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl text-text">Liveness</h1>
        <p className="mt-1 text-sm text-text-muted">Network halt-risk and per-CoreSlot signing health.</p>
      </div>
      <LivenessOverview />
      <PerSlotHealthTable />
    </div>
  );
}
