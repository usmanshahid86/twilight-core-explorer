import { RewardEpochDetail } from '@/components/rewards/RewardEpochDetail';

export default function RewardEpochPage({ params }: { params: { epoch: string } }) {
  return <RewardEpochDetail epoch={params.epoch} />;
}
