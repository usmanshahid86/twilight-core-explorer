import { ChainStatusPanel, IndexerFreshnessPanel } from '@/components/overview/StatusPanels';
import { LatestBlocksPanel, RecentTxPanel } from '@/components/overview/ActivityPanels';
import { CoreSlotHealthPanel, LivenessRiskPanel } from '@/components/overview/NetworkPanels';
import { SupplyPanel } from '@/components/overview/SupplyPanel';

// Overview — the operational summary answering "is Twilight healthy, current, and producing blocks?"
// Each panel is an independent client query; the page is a static server shell.
export default function OverviewPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl text-text">Network overview</h1>
        <p className="mt-1 text-sm text-text-muted">
          Operational summary of Twilight Core — chain status, indexer freshness, activity, CoreSlot
          health, liveness risk, and sampled supply.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChainStatusPanel />
        <IndexerFreshnessPanel />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LatestBlocksPanel />
        <RecentTxPanel />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CoreSlotHealthPanel />
        <LivenessRiskPanel />
      </div>

      <SupplyPanel />
    </div>
  );
}
