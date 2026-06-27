'use client';

import type { ReactNode } from 'react';
import { Table, Td, Th, Tr } from '@/components/ui/Table';
import { EmptyState, ErrorState, LoadingState, PaginationLoader } from '@/components/states/States';
import type { ListEnvelope } from '@/lib/api/pagination';

export type Column<T> = { header: string; cell: (row: T) => ReactNode; mono?: boolean };

// Minimal structural view of a useInfiniteQuery result — just what the table needs.
type InfiniteListQuery<T> = {
  data?: { pages: ListEnvelope<T>[] } | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
};

// Minimal keyset-paginated table: flattens infinite-query pages and offers a Load-more button.
// Cursors stay opaque (handled by the hook's getNextPageParam); this component never touches them.
// Intentionally no sorting/filtering framework — just rows + load-more.
export function PaginatedTable<T>({
  query,
  columns,
  rowKey,
  context,
  emptyMessage = 'Nothing to show yet.',
}: {
  query: InfiniteListQuery<T>;
  columns: Column<T>[];
  rowKey: (row: T, index: number) => string;
  context?: string | undefined;
  emptyMessage?: string;
}) {
  if (query.isPending) return <LoadingState rows={6} />;
  if (query.isError) return <ErrorState error={query.error} context={context} />;

  const rows = query.data?.pages.flatMap((p) => p.data) ?? [];
  if (rows.length === 0) return <EmptyState message={emptyMessage} />;

  return (
    <div className="space-y-3">
      <Table head={columns.map((c) => <Th key={c.header}>{c.header}</Th>)}>
        {rows.map((row, i) => (
          <Tr key={rowKey(row, i)}>
            {columns.map((c) => (
              <Td key={c.header} mono={c.mono ?? false}>
                {c.cell(row)}
              </Td>
            ))}
          </Tr>
        ))}
      </Table>
      {query.hasNextPage ? (
        query.isFetchingNextPage ? (
          <PaginationLoader />
        ) : (
          <button
            type="button"
            onClick={() => query.fetchNextPage()}
            className="w-full rounded-xl border border-card-border bg-card py-2 text-sm text-primary hover:bg-card-hover"
          >
            Load more
          </button>
        )
      ) : null}
    </div>
  );
}
