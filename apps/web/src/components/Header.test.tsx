import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAV, type NavGroup } from './Header';

const GROUPS: NavGroup[] = ['explore', 'validators', 'economics', 'diagnostics'];

// J-007: nav items are grouped by concern for discoverability. Every item must carry a known group,
// and groups must be contiguous (so the desktop separators land on real concern boundaries).
describe('Header nav grouping', () => {
  it('every nav item carries a known group', () => {
    for (const item of NAV) {
      expect(GROUPS).toContain(item.group);
    }
  });

  it('groups are contiguous (no group is split across the nav)', () => {
    const order = NAV.map((i) => i.group);
    const firstSeen = new Set<NavGroup>();
    let prev: NavGroup | null = null;
    for (const g of order) {
      if (g !== prev) {
        // entering a new run of `g` — it must not have appeared before
        expect(firstSeen.has(g)).toBe(false);
        firstSeen.add(g);
        prev = g;
      }
    }
  });

  // Regression guard (Codex 13b-ux review): the inline desktop nav appears at `xl`, so the compact nav
  // block must stay visible until `xl` (NOT hide at `lg`) — otherwise the 1024..1279px band has no
  // primary nav at all. Class-level guard so the breakpoint can't silently regress.
  it('has no responsive nav gap: compact nav hides at xl (where the desktop nav appears), not lg', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/Header.tsx'), 'utf8');
    expect(src).toContain('xl:flex'); // inline desktop nav appears at xl
    expect(src).toContain('pb-3 xl:hidden'); // compact nav block stays until xl
    expect(src).not.toContain('pb-3 lg:hidden'); // the old gappy compact-block class is gone
  });
});
