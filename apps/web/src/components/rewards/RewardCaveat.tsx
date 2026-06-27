import type { ReactNode } from 'react';

/**
 * Shared read-only caveat banner for the rewards/supply surfaces (Phase 12b).
 *
 * Phase 12 renders the contract's OWN caveat fields verbatim — `aggregate_projection`,
 * `read_only_no_claim_action`, `event_history_only`, `projection_observed_not_live_claimable`,
 * `source:"sampled"` — never invented economics. Callers pass the exact caveat text/values as
 * children; this component only owns the consistent banner styling.
 */
export function RewardCaveat({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 rounded-xl border border-accent-yellow/30 bg-accent-yellow/10 px-4 py-2 text-xs text-accent-yellow">
      {children}
    </div>
  );
}
