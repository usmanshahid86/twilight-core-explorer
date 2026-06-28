'use client';

import { usePathname, useRouter } from 'next/navigation';
import type { StatusOption } from '@/lib/status-filters';

// Reusable URL-synced list filter (13b-filters / J-002). One pattern for coreslots?status= and
// txs?status=. The current value comes from the server page's searchParams (a controlled select), and
// a change rewrites the URL via router.replace — so the server re-renders with the new searchParam and
// the list hook re-keys (resetting keyset pagination to page one). `''` means "all" (no `?status=`).
//
// `usePathname` (not `useSearchParams`) keeps this out of a Suspense boundary; `status` is the only
// list-filter param on these pages, so building the URL from pathname + the single param is sufficient.
export function StatusFilter({
  label,
  paramName,
  value,
  options,
}: {
  label: string;
  paramName: string;
  value: string;
  options: StatusOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const id = `filter-${paramName}`;
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-text-muted">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          router.replace(next ? `${pathname}?${paramName}=${encodeURIComponent(next)}` : pathname);
        }}
        className="rounded-lg border border-card-border bg-background-secondary px-2 py-1.5 text-sm text-text focus:border-primary"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
