import { TxDetail } from '@/components/txs/TxDetail';

export default function TxDetailPage({ params }: { params: { hash: string } }) {
  return <TxDetail hash={params.hash} />;
}
