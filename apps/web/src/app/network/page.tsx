import { ValidatorSetSection } from '@/components/network/ValidatorSetSection';
import { ProposerLeaderboard } from '@/components/network/ProposerLeaderboard';

export const metadata = { title: "Network" };

export default function NetworkPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl text-text">Network</h1>
        <p className="mt-1 text-sm text-text-muted">
          The active validator set (at the latest indexed height) and the proposer leaderboard.
        </p>
      </div>
      <ValidatorSetSection />
      <ProposerLeaderboard />
    </div>
  );
}
