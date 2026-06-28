import { BlockDetail } from '@/components/blocks/BlockDetail';

export const metadata = { title: "Block" };

export default function BlockDetailPage({ params }: { params: { height: string } }) {
  return <BlockDetail height={params.height} />;
}
