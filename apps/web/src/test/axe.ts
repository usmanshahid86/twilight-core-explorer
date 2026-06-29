import axe from 'axe-core';

// Structural a11y net for component tests. jsdom has no layout engine, so rules that need computed
// geometry (`color-contrast`) or page-level structure (`region`/landmarks) can't run meaningfully at
// the component level — they're disabled here. Color contrast is owned by the 13b-ux manual review.
// This returns only axe `violations` — the rules that regress silently in refactors: accessible names
// (button/img/select), form labels, roles, and aria wiring. (Note: in jsdom `duplicate-id-aria` reports
// as an `incomplete`, not a `violation`, so it is NOT caught here.) Compact summary so a failing test
// names the offenders.
export async function axeViolations(
  container: Element,
): Promise<Array<{ id: string; impact: axe.ImpactValue | null | undefined; nodes: number }>> {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return results.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
}
