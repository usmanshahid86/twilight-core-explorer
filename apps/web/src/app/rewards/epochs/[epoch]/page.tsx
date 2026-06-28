import { RewardEpochDetail } from '@/components/rewards/RewardEpochDetail';

export const metadata = { title: "Epoch" };

export default function RewardEpochPage({ params }: { params: { epoch: string } }) {
  return <RewardEpochDetail epoch={params.epoch} />;
}
