import type { ReactNode } from 'react';

// Minimal table primitive. Horizontally scrollable so it never breaks at narrow widths.
export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-tighter-1 text-text-muted">{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ children }: { children: ReactNode }) {
  return <th className="px-2 py-2 font-medium">{children}</th>;
}

export function Tr({ children }: { children: ReactNode }) {
  return <tr className="border-t border-card-border hover:bg-card-hover">{children}</tr>;
}

export function Td({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return <td className={mono ? 'px-2 py-2 font-mono text-text-secondary' : 'px-2 py-2 text-text-secondary'}>{children}</td>;
}
