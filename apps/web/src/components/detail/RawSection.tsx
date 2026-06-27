'use client';

import { Card } from '@/components/ui/Card';
import { ErrorState, LoadingState } from '@/components/states/States';
import { JsonView } from './JsonView';

// Collapsible "Raw" panel. The parent owns `expanded` and passes a raw query whose `enabled` flips on
// expand, so the include=raw request is fired ONLY after the user opens this section (lazy).
export function RawSection({
  expanded,
  onToggle,
  query,
}: {
  expanded: boolean;
  onToggle: () => void;
  query: {
    isFetching: boolean;
    isError: boolean;
    error: unknown;
    data?: { data: { raw?: unknown } } | undefined;
  };
}) {
  return (
    <Card>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-5 py-3.5"
      >
        <span className="font-serif text-lg text-text">Raw</span>
        <span className="text-sm text-text-muted">{expanded ? 'Hide' : 'Show'}</span>
      </button>
      {expanded ? (
        <div className="border-t border-card-border px-5 py-4">
          {query.isFetching && query.data === undefined ? (
            <LoadingState rows={3} />
          ) : query.isError ? (
            <ErrorState error={query.error} context="Raw" />
          ) : (
            <JsonView value={query.data?.data.raw} />
          )}
        </div>
      ) : null}
    </Card>
  );
}
