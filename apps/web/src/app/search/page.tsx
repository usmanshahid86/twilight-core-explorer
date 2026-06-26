import { Suspense } from 'react';
import { SearchResults } from '@/components/SearchResults';
import { LoadingState } from '@/components/states/States';

// useSearchParams must sit under a Suspense boundary in the app-router.
export default function SearchPage() {
  return (
    <Suspense fallback={<LoadingState rows={4} />}>
      <SearchResults />
    </Suspense>
  );
}
