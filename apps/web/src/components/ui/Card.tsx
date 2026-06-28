import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={clsx('rounded-2xl border border-card-border bg-card shadow-card', className)}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  href,
  linkLabel,
  action,
}: {
  title: string;
  href?: string;
  // Precise, unique link text (J-006). Defaults to "View all", which only fits a list destination.
  linkLabel?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-card-border px-5 py-3.5">
      <h2 className="font-serif text-lg text-text">{title}</h2>
      <div className="flex items-center gap-3 text-sm text-text-muted">
        {action}
        {href ? (
          <a href={href} className="text-primary hover:text-primary-light">
            {linkLabel ?? 'View all'} →
          </a>
        ) : null}
      </div>
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('px-5 py-4', className)}>{children}</div>;
}
