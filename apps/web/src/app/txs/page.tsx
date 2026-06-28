import { TxsList } from '@/components/txs/TxsList';
import { oneParam } from '@/lib/search-params';
import { coerceStatus, TX_STATUS_OPTIONS } from '@/lib/status-filters';

export const metadata = { title: "Transactions" };

export default function TxsPage({
  searchParams,
}: {
  searchParams: { status?: string | string[] };
}) {
  // Validate the raw URL param at the trust boundary — only success/failed reach the API filter.
  const status = coerceStatus(oneParam(searchParams.status), TX_STATUS_OPTIONS);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl text-text">Transactions</h1>
        <p className="mt-1 text-sm text-text-muted">Indexed transactions, newest first.</p>
      </div>
      <TxsList status={status} />
    </div>
  );
}
