import { BlocksList } from '@/components/blocks/BlocksList';

export const metadata = { title: "Blocks" };

export default function BlocksPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl text-text">Blocks</h1>
        <p className="mt-1 text-sm text-text-muted">Indexed blocks, newest first.</p>
      </div>
      <BlocksList />
    </div>
  );
}
