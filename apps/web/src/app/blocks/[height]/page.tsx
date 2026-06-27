import { BlockDetail } from '@/components/blocks/BlockDetail';

export default function BlockDetailPage({ params }: { params: { height: string } }) {
  return <BlockDetail height={params.height} />;
}
