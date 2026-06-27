import { RewardsView } from '@/components/rewards/RewardsView';

export default function RewardsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl text-text">Rewards</h1>
        <p className="mt-1 text-sm text-text-muted">
          Epochs, claim history, module balances, treasury payments, and params changes — read-only
          observed projections and historical events. Claiming is not available here.
        </p>
      </div>
      <RewardsView />
    </div>
  );
}
