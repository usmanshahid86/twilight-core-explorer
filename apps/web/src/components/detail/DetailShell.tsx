import type { ReactNode } from 'react';

// Shared heading + spacing wrapper for detail pages (and their loading/error branches).
export function DetailShell({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-6">
      <h1 className="font-serif text-3xl text-text">{title}</h1>
      {children}
    </div>
  );
}
