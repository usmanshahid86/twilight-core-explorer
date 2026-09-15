import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ICON_TONE, type IconTone } from './icon-tone';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={clsx(
        // Border WIDTH is theme-owned (border-led vs elevation-led): 1px for bordered themes, 0 for
        // ones that float on their shadow ring. Color/style/radius/shadow still flow through tokens.
        'rounded-2xl border-card-border bg-card shadow-card [border-width:var(--card-border-width,1px)]',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  href,
  linkLabel,
  action,
  icon,
  iconTone,
}: {
  title: string;
  href?: string;
  // Precise, unique link text (J-006). Defaults to "View all", which only fits a list destination.
  linkLabel?: string;
  action?: ReactNode;
  icon?: LucideIcon;
  iconTone?: IconTone;
}) {
  const Icon = icon;
  return (
    <div className="flex items-center justify-between border-b border-card-border px-5 py-3.5">
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon ? (
          // Same category-tinted chip as the KPI cards — a section header reads the same color as its
          // domain's metrics. Decorative (aria-hidden); the h2 stays the section's accessible name.
          <span
            className={clsx(
              'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
              iconTone ? ICON_TONE[iconTone] : 'bg-white/5 text-text-muted',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        ) : null}
        <h2 className="truncate font-serif text-xl text-text">{title}</h2>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-sm text-text-muted">
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
