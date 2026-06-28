import { CoreSlotDetail } from '@/components/coreslots/CoreSlotDetail';

export const metadata = { title: "CoreSlot" };

export default function CoreSlotDetailPage({ params }: { params: { slotId: string } }) {
  return <CoreSlotDetail slotId={params.slotId} />;
}
