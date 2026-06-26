import type { ReactNode } from 'react';
import { ApiError, ERROR_CODES } from '@/lib/api/client';
import { SkeletonRows } from '@/components/ui/Skeleton';

export function LoadingState({ rows = 4 }: { rows?: number }) {
  return <SkeletonRows rows={rows} />;
}

export function EmptyState({ message = 'Nothing to show yet.' }: { message?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-card-border px-4 py-6 text-center text-sm text-text-muted">
      {message}
    </div>
  );
}

export function PaginationLoader() {
  return (
    <div className="py-3 text-center text-xs text-text-muted" role="status">
      Loading more…
    </div>
  );
}

export function InvalidInput({ message = 'That input is not valid.' }: { message?: string }) {
  return (
    <div className="rounded-xl border border-accent-yellow/30 bg-accent-yellow/10 px-4 py-3 text-sm text-accent-yellow">
      {message}
    </div>
  );
}

export function NotFoundState({ message = 'Not found.' }: { message?: string }) {
  return (
    <div className="rounded-xl border border-card-border bg-background-secondary px-4 py-6 text-center text-sm text-text-secondary">
      {message}
    </div>
  );
}

// Renders the right message for a failed query. Branches on error.code (never message text):
// transport-down vs not-found vs invalid input vs generic API error.
export function ErrorState({
  error,
  context,
}: {
  error: unknown;
  context?: string | undefined;
}): ReactNode {
  const prefix = context ? `${context}: ` : '';

  if (error instanceof ApiError) {
    if (error.code === ERROR_CODES.networkUnavailable) {
      return (
        <div className="rounded-xl border border-accent-red/30 bg-accent-red/10 px-4 py-3 text-sm text-accent-red">
          {prefix}API unavailable — the Twilight API could not be reached.
        </div>
      );
    }
    if (error.code === ERROR_CODES.notFound) {
      return <NotFoundState message={`${prefix}Not found.`} />;
    }
    if (
      error.code === ERROR_CODES.invalidQuery ||
      error.code === ERROR_CODES.invalidHeight ||
      error.code === ERROR_CODES.invalidSlotId ||
      error.code === ERROR_CODES.invalidEpoch ||
      error.code === ERROR_CODES.invalidCursor
    ) {
      return <InvalidInput message={`${prefix}${error.message}`} />;
    }
    return (
      <div className="rounded-xl border border-accent-red/30 bg-accent-red/10 px-4 py-3 text-sm text-accent-red">
        {prefix}API error ({error.code}).
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-accent-red/30 bg-accent-red/10 px-4 py-3 text-sm text-accent-red">
      {prefix}Something went wrong.
    </div>
  );
}
