'use client';

import { clsx } from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SearchBar } from './SearchBar';

// IA reshaped for Twilight (CoreSlot PoA + rewards), NOT the reference bridge/ZkOS nav.
const NAV: { label: string; href: string }[] = [
  { label: 'Overview', href: '/' },
  { label: 'Blocks', href: '/blocks' },
  { label: 'Transactions', href: '/txs' },
  { label: 'Accounts', href: '/accounts' },
  { label: 'CoreSlots', href: '/coreslots' },
  { label: 'Liveness', href: '/liveness' },
  { label: 'Rewards', href: '/rewards' },
  { label: 'Supply', href: '/supply' },
  { label: 'API', href: '/api' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Header() {
  const pathname = usePathname();
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-card-border bg-background/90 backdrop-blur">
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
            {NAV.map((item) => (
              <Link
                key={item.href}
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
            ))}
          </nav>
        </div>
        {/* Compact nav + search for narrower viewports */}
        <div className="flex flex-col gap-2 pb-3 lg:hidden">
          <SearchBar />
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
