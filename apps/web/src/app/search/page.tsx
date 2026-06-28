import { Suspense } from 'react';
import { SearchResults } from '@/components/SearchResults';
import { LoadingState } from '@/components/states/States';

// useSearchParams must sit under a Suspense boundary in the app-router.
export const metadata = { title: "Search" };

export default function SearchPage() {
  // The h1 lives here (above Suspense) so the SSR/fallback render always has exactly one heading,
  // not only after SearchResults hydrates (multi-lens review, heading lens F-1).
  return (
    <div className="space-y-4">
      <h1 className="font-serif text-3xl text-text">Search</h1>
      <Suspense fallback={<LoadingState rows={4} />}>
        <SearchResults />
      </Suspense>
    </div>
  );
}
