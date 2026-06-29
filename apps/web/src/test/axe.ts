import axe from 'axe-core';

// Structural a11y net for component tests. jsdom has no layout engine, so rules that need computed
// geometry (`color-contrast`) or page-level structure (`region`/landmarks) can't run meaningfully at
// the component level — they're disabled here. Color contrast is owned by the 13b-ux manual review;
// this catches the rules that regress silently in refactors: accessible names, roles, labels, aria
// wiring, duplicate ids. Returns a compact violation summary so a failing test names the offenders.
export async function axeViolations(
  container: Element,
): Promise<Array<{ id: string; impact: axe.ImpactValue | null | undefined; nodes: number }>> {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return results.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
}
