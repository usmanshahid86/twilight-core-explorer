import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import type { BadgeTone } from '@/lib/format/status';

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: 'bg-background-tertiary text-text-secondary border-border',
  success: 'bg-accent-green/10 text-accent-green border-accent-green/30',
  warning: 'bg-accent-yellow/10 text-accent-yellow border-accent-yellow/30',
  danger: 'bg-accent-red/10 text-accent-red border-accent-red/30',
  info: 'bg-primary/10 text-primary border-primary/30',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
