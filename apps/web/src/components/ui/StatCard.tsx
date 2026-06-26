import type { ReactNode } from 'react';

export function StatCard({
  label,
  value,
  hint,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-background-secondary px-4 py-3">
      <div className="text-xs uppercase tracking-tighter-1 text-text-muted">{label}</div>
      <div className={mono ? 'mt-1 font-mono text-lg text-text' : 'mt-1 text-lg text-text'}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-text-muted">{hint}</div> : null}
    </div>
  );
}
