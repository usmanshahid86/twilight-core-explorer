'use client';

import { Card, CardBody } from '@/components/ui/Card';

// Root error boundary for unexpected render/runtime errors (API errors are handled inline per panel).
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Card>
      <CardBody className="space-y-3 py-12 text-center">
        <h1 className="font-serif text-3xl text-text">Something went wrong</h1>
        <p className="text-sm text-text-muted">An unexpected error occurred while rendering this page.</p>
        <button
          type="button"
          onClick={reset}
          className="inline-block rounded-lg border border-card-border bg-card px-4 py-2 text-sm text-primary hover:bg-card-hover"
        >
          Try again
        </button>
      </CardBody>
    </Card>
  );
}
