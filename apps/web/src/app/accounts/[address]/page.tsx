import { AccountDetail } from '@/components/accounts/AccountDetail';

export default function AccountDetailPage({ params }: { params: { address: string } }) {
  return <AccountDetail address={params.address} />;
}
