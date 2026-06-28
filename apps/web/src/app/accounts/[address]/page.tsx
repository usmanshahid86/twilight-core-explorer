import { AccountDetail } from '@/components/accounts/AccountDetail';

export const metadata = { title: "Account" };

export default function AccountDetailPage({ params }: { params: { address: string } }) {
  return <AccountDetail address={params.address} />;
}
