import type { ReactNode } from 'react';

// The /api page is a client component, so its title is set here (server layout) — M-005.
export const metadata = { title: 'API' };

export default function ApiLayout({ children }: { children: ReactNode }) {
  return children;
}
