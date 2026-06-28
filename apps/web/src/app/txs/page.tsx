import { TxsList } from '@/components/txs/TxsList';

export const metadata = { title: "Transactions" };

export default function TxsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl text-text">Transactions</h1>
        <p className="mt-1 text-sm text-text-muted">Indexed transactions, newest first.</p>
      </div>
      <TxsList />
    </div>
  );
}
