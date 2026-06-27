import { CoreSlotDetail } from '@/components/coreslots/CoreSlotDetail';

export default function CoreSlotDetailPage({ params }: { params: { slotId: string } }) {
  return <CoreSlotDetail slotId={params.slotId} />;
}
