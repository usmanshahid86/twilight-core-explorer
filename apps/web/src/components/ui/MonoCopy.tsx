import { shortenMiddle } from '@/lib/format/address';
import { CopyButton } from './CopyButton';

// Render a hash/address shortened for display but fully copyable. The full value is never lost.
export function MonoCopy({
  value,
  head = 10,
  tail = 6,
  label,
}: {
  value: string | null | undefined;
  head?: number;
  tail?: number;
  label?: string;
}) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-text-muted">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono" title={value}>
        {shortenMiddle(value, head, tail)}
      </span>
      <CopyButton value={value} label={label ?? 'value'} />
    </span>
  );
}
