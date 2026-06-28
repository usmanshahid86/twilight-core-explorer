import { OperatorView } from '@/components/operator/OperatorView';

export const metadata = { title: "Operator" };

export default function OperatorPage({ params }: { params: { address: string } }) {
  return <OperatorView address={params.address} />;
}
