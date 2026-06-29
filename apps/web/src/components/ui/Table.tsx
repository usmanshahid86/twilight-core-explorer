import type { ReactNode } from 'react';

// Minimal table primitive. Horizontally scrollable so it never breaks at narrow widths. `caption`
// gives the table a screen-reader-only accessible name (WCAG 1.3.1).
export function Table({
  head,
  children,
  caption,
}: {
  head: ReactNode;
  children: ReactNode;
  // Required: every data table must carry an sr-only accessible name. Making this mandatory enforces
  // table naming at COMPILE time — axe can't (an unnamed <table> isn't a WCAG A/AA violation), so the
  // type system is the only thing that prevents a future unnamed table from slipping through.
  caption: string;
}) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="text-left text-xs uppercase tracking-tighter-1 text-text-muted">{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ children }: { children: ReactNode }) {
  return (
    <th scope="col" className="px-2 py-2 font-medium">
      {children}
    </th>
  );
}

export function Tr({ children }: { children: ReactNode }) {
  return <tr className="border-t border-card-border hover:bg-card-hover">{children}</tr>;
}

export function Td({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return <td className={mono ? 'px-2 py-2 font-mono text-text-secondary' : 'px-2 py-2 text-text-secondary'}>{children}</td>;
}
