import { AccountsList } from '@/components/accounts/AccountsList';

export const metadata = { title: "Accounts" };

export default function AccountsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl text-text">Accounts</h1>
        <p className="mt-1 text-sm text-text-muted">Indexed accounts and their sampled balances.</p>
      </div>
      <AccountsList />
    </div>
  );
}
