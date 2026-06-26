'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ErrorState, LoadingState } from '@/components/states/States';

// Standard loading/error gate for a single query. `children` only runs once data is present,
// so panels never read undefined data. Error rendering branches on error.code inside ErrorState.
export function QueryBoundary<T>({
  query,
  context,
  loadingRows,
  children,
}: {
  query: UseQueryResult<T>;
  context?: string;
  loadingRows?: number;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <LoadingState rows={loadingRows ?? 4} />;
  if (query.isError) return <ErrorState error={query.error} context={context} />;
  return <>{children(query.data)}</>;
}
