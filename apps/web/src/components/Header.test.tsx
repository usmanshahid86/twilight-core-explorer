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
});
