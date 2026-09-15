import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { ICON_TONE, type IconTone } from './icon-tone';

// Airy/premium page header used across the redesign: an optional category icon tile, a small brand-
// accent eyebrow, a serif h1, an optional muted sub-paragraph, and a right-aligned actions slot
// (status pill, "updated Ns ago", etc.). Purely presentational + token-driven, so it rebrands with the
// active theme. `icon`/`iconTone` anchor the page to its domain using the same legend as the KPI cards
// (the icon is decorative — aria-hidden — the h1 stays the accessible name).
export function PageHeader({
  eyebrow,
  title,
  sub,
  actions,
  icon,
  iconTone,
}: {
  eyebrow: string;
  title: string;
  sub?: ReactNode;
  actions?: ReactNode;
  icon?: LucideIcon;
  iconTone?: IconTone;
}) {
  const Icon = icon;
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-start gap-3.5">
        {Icon ? (
          // Larger tile than the card chips (this anchors the whole page), rounded-xl to follow theme.
          <span
            className={clsx(
              'mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
              iconTone ? ICON_TONE[iconTone] : 'bg-white/5 text-text-muted',
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
          </span>
        ) : null}
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            {eyebrow}
          </div>
          <h1 className="font-serif text-4xl leading-tight tracking-[-0.01em] text-text">{title}</h1>
          {sub ? <p className="max-w-xl text-sm leading-relaxed text-text-muted">{sub}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
