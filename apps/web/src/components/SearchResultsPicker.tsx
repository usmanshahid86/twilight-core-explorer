import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import {
  searchResultHref,
  searchResultKindLabel,
  searchResultPrimary,
  type SearchResult,
} from '@/lib/search';

// Shown when /api/v1/search returns more than one typed reference (ambiguity such as q=2 resolving
// both a block and a CoreSlot, or an operator address resolving both an account and a CoreSlot).
// Never auto-navigates — the user chooses.
export function SearchResultsPicker({ results }: { results: SearchResult[] }) {
  return (
    <ul className="divide-y divide-card-border rounded-2xl border border-card-border bg-card" role="list">
      {results.map((result, i) => (
        <li key={`${result.type}-${searchResultPrimary(result)}-${i}`}>
          <Link
            href={searchResultHref(result)}
            className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-card-hover"
          >
            <span className="flex items-center gap-3">
              <Badge tone="info">{searchResultKindLabel(result)}</Badge>
              <span className="font-mono text-sm text-text-secondary">
                {searchResultPrimary(result)}
              </span>
            </span>
            <span className="text-primary">→</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
