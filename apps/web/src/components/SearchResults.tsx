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

  // A single, stable h1 across every state (M-011) — the per-state body renders beneath it.
  const body = (() => {
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
      // Self-contained spacing between the summary and the picker (PR #40) — don't rely on the page's
      // space-y reaching through this fragment.
      <div className="space-y-4">
        <p className="text-sm text-text-muted">
          {results.length} matches for “{q}”. Multiple types matched — choose one.
        </p>
        <SearchResultsPicker results={results} />
      </div>
    );
  })();

  // The h1 + wrapper live in search/page.tsx (above Suspense) so the heading is present in every
  // render including the SSR/fallback; this component renders only the per-state body.
  return body;
}
