import { TxDetail } from '@/components/txs/TxDetail';

export const metadata = { title: "Transaction" };

export default function TxDetailPage({ params }: { params: { hash: string } }) {
  return <TxDetail hash={params.hash} />;
}
