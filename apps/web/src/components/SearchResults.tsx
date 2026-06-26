'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { SearchResultsPicker } from './SearchResultsPicker';
import { EmptyState, ErrorState, InvalidInput, LoadingState } from '@/components/states/States';
import { useSearch } from '@/lib/api/queries';
import { searchResultHref } from '@/lib/search';

export function SearchResults() {
  const params = useSearchParams();
  const router = useRouter();
  const q = (params.get('q') ?? '').trim();
  const query = useSearch(q);

  const data = query.data?.data;
  // Exactly one strong result -> direct navigation is allowed. Otherwise the user always chooses.
  const onlyHref = data && data.length === 1 && data[0] ? searchResultHref(data[0]) : null;

  useEffect(() => {
    if (onlyHref) router.replace(onlyHref);
  }, [onlyHref, router]);

  if (q.length === 0) {
    return <InvalidInput message="Enter a height, hash, address, or CoreSlot id to search." />;
  }
  if (query.isPending) return <LoadingState rows={4} />;
  if (query.isError) return <ErrorState error={query.error} context="Search" />;

  const results = query.data.data;
  if (results.length === 0) {
    return <EmptyState message={`No results for “${q}”.`} />;
  }
  if (onlyHref) {
    return <div className="text-sm text-text-muted">Redirecting…</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl text-text">Search results</h1>
        <p className="mt-1 text-sm text-text-muted">
          {results.length} matches for “{q}”. Multiple types matched — choose one.
        </p>
      </div>
      <SearchResultsPicker results={results} />
    </div>
  );
}
