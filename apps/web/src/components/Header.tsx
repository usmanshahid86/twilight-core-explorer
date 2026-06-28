'use client';

import { Fragment } from 'react';
import { clsx } from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SearchBar } from './SearchBar';

// IA reshaped for Twilight (CoreSlot PoA + rewards), NOT the reference bridge/ZkOS nav. Items are
// grouped by concern (explore / validators / economics / diagnostics) for discoverability; the desktop
// nav renders a subtle separator at each group boundary.
export type NavGroup = 'explore' | 'validators' | 'economics' | 'diagnostics';
export const NAV: { label: string; href: string; group: NavGroup }[] = [
  { label: 'Overview', href: '/', group: 'explore' },
  { label: 'Blocks', href: '/blocks', group: 'explore' },
  { label: 'Transactions', href: '/txs', group: 'explore' },
  { label: 'Accounts', href: '/accounts', group: 'explore' },
  { label: 'CoreSlots', href: '/coreslots', group: 'validators' },
  { label: 'Liveness', href: '/liveness', group: 'validators' },
  { label: 'Network', href: '/network', group: 'validators' },
  { label: 'Rewards', href: '/rewards', group: 'economics' },
  { label: 'Supply', href: '/supply', group: 'economics' },
  { label: 'API', href: '/api', group: 'diagnostics' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Header() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-card-border bg-background/90 backdrop-blur">
      <div className="mx-auto w-full lg:w-[1432px] px-4 sm:px-6 lg:px-[156px]">
        <div className="flex h-16 items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="font-serif text-xl text-primary">Twilight</span>
            <span className="hidden text-sm text-text-muted sm:inline">Core Explorer</span>
          </Link>
          <div className="hidden flex-1 justify-center lg:flex">
            <SearchBar />
          </div>
          <nav className="hidden items-center gap-1 xl:flex" aria-label="Primary">
            {NAV.map((item, i) => (
              <Fragment key={item.href}>
                {i > 0 && NAV[i - 1]?.group !== item.group ? (
                  <span aria-hidden="true" className="mx-1 h-4 w-px bg-card-border" />
                ) : null}
                <Link
                  href={item.href}
                  className={clsx(
                    'rounded-lg px-2.5 py-1.5 text-sm',
                    isActive(pathname, item.href)
                      ? 'bg-card text-primary'
                      : 'text-text-secondary hover:text-text',
                  )}
                >
                  {item.label}
                </Link>
              </Fragment>
            ))}
          </nav>
        </div>
        {/* Compact nav for narrower viewports. Visible until `xl` — where the inline desktop nav takes
            over — so there is NO nav gap in the lg..xl band (Codex 13b-ux review). The compact search
            hides at `lg`+, where the centered desktop search appears, to avoid a duplicate search. */}
        <div className="flex flex-col gap-2 pb-3 xl:hidden">
          <div className="lg:hidden">
            <SearchBar />
          </div>
          <nav className="flex flex-wrap gap-1" aria-label="Primary (compact)">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  'rounded-lg px-2 py-1 text-xs',
                  isActive(pathname, item.href)
                    ? 'bg-card text-primary'
                    : 'text-text-secondary hover:text-text',
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}
