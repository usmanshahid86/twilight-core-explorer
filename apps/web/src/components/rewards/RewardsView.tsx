import { EpochsSection } from './sections/EpochsSection';
import { ClaimsSection } from './sections/ClaimsSection';
import { BalancesSection } from './sections/BalancesSection';
import { TreasurySection } from './sections/TreasurySection';
import { ParamsSection } from './sections/ParamsSection';
import { ClaimingCard } from './ClaimingCard';

/**
 * The read-only /rewards hub (Phase 12b). Each section is an independent keyset table over a 9d/7.2
 * rewards endpoint; the Claiming card is non-actionable (CLI-documented only). No /supply, no
 * cross-links, no filter UI, no claim actions — those are 12c / out of scope.
 */
export function RewardsView() {
  return (
    <div className="space-y-6">
      <EpochsSection />
      <ClaimsSection />
      <BalancesSection />
      <TreasurySection />
      <ParamsSection />
      <ClaimingCard />
    </div>
  );
}
