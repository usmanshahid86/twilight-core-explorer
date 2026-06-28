import Link from 'next/link';
import type { ReactNode } from 'react';

// Shared heading + spacing wrapper for detail pages (and their loading/error branches). Optional
// `backHref`/`backLabel` render a breadcrumb back to the parent list (M-006); `description` a one-line
// subtitle (J-009).
export function DetailShell({
  title,
  children,
  backHref,
  backLabel,
  description,
}: {
  title: ReactNode;
  children: ReactNode;
  backHref?: string;
  backLabel?: string;
  description?: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        {backHref ? (
          <Link href={backHref} className="text-sm text-text-secondary hover:text-text">
            ← {backLabel ?? 'Back'}
          </Link>
        ) : null}
        <h1 className="font-serif text-3xl text-text">{title}</h1>
        {description ? <p className="mt-1 text-sm text-text-muted">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}
