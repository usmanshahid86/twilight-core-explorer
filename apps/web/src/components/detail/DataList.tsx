import type { ReactNode } from 'react';

export type DataItem = { label: string; value: ReactNode };

// Label/value definition list for detail pages. Values wrap/break so long hashes don't overflow.
export function DataList({ items }: { items: DataItem[] }) {
  return (
    <dl className="divide-y divide-card-border">
      {items.map((item) => (
        <div key={item.label} className="grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-3 sm:gap-3">
          <dt className="text-sm text-text-muted">{item.label}</dt>
          <dd className="break-all text-sm text-text sm:col-span-2">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
