# Phase 13d-4 — Bundle / perf + a11y verification — Report

Date: 2026-06-29
Branch: `feat/13d-rc-checklist` (13d-4 sub-slice)
Plan: `phase-13-explorer-hardening-plan.md` §7 (13d-4)
Status: **complete.** Perf audited (already healthy — no fixes); a11y gained an automated structural net
+ one real fix (list-table accessible names); keyboard operability audited clean. Ritual green.

## Scope

The last 13d sub-slice: a **perf sanity audit** (web bundle, the bounded `/liveness` fan-out, API N+1) and
**a11y verification** (automated axe + a keyboard pass). The 13b-ux multi-lens review already covered the
default theme manually; 13d-4 adds the *automated* regression net and closes the deferred table-caption gap.

## Perf audit — healthy, no fixes needed

- **Web bundle — lean.** Shared First Load JS **87.3 kB** (framework 53.6 kB + vendor 31.7 kB); per-route
  First Load **104–125 kB**; the biggest *route-specific* chunk is **5.36 kB** (`/`). Nothing approaches a
  concerning threshold; no code-splitting work warranted.
- **`/liveness` fan-out — bounded.** `mapWithConcurrency` worker pool with `FANOUT_CONCURRENCY=12`,
  `FANOUT_CAP=100`; two fan-outs (`useCoreSlotHealthFanout`, `useOperatorDirectory`). A per-slot failure
  degrades to `health: null`/omitted — never fails the page. So the network page never fires 100 concurrent
  requests, and partial chain failures don't blank it.
- **API N+1 — none.** Routes hold **0 direct prisma calls** (data access is in `repositories/*`), and the
  list repos **batch**: e.g. blocks list = `block.findMany(page)` + a single
  `blockProposerAttribution.findMany({ where: { height: { in: heights } } })` (one IN-clause, not per-row).
  No find-in-a-loop anywhere in the data layer.

## a11y verification — net added + a real fix

- **Automated axe net (new).** `axe-core@4.12` + `src/test/axe.ts` (`axeViolations`) + 5 tests in
  `src/components/a11y.test.tsx` over the reusable surface (ui primitives, named Table, empty/invalid
  states, Header nav, Footer, OperatorLink, StatusFilter, PaginatedTable). The helper returns axe
  **`violations`** only and catches the rules that regress silently: accessible names
  (`button-name`/`image-alt`/`select-name`), form labels, roles, aria wiring. **jsdom caveats:**
  `color-contrast` (needs layout) and `region` (page-level) are disabled — contrast stays the 13b-ux
  manual review's domain (+ the tracked legacy-theme follow-up); and `duplicate-id-aria` reports as an
  axe `incomplete` (not a `violation`) in jsdom, so the net does **not** assert on it. A live-browser axe
  (Playwright), which would cover both, is a possible future add.
- **Fix — every data table now has an accessible name, enforced at compile time.** `Table` supported an
  sr-only `<caption>` but nothing required it: `PaginatedTable` passed none (every *list* table unnamed),
  and ~10 non-list tables (network/liveness/supply/accounts/overview/`/api`) were unnamed too — and the
  axe net **cannot** catch that (an unnamed `<table>` isn't a WCAG A/AA violation). Fix: **`Table.caption`
  is now a *required* prop**, so an unnamed `<table>` is a **type error** — a guarantee stronger than any
  axe rule. `PaginatedTable` supplies `caption ?? context ?? 'Results'` (all 15 list sites already pass a
  human `context=`); the ~10 direct `<Table>` sites got descriptive captions ("Validator set", "Token
  supply by denomination", "Decode failures", …). Closes the 13b-ux "table accessible-name" item for
  **all** tables, not just list tables. *(Surfaced by the post-13d-4 adversarial + Codex reviews.)*
- **Keyboard operability — clean (code audit).** Every interactive element is native (`<button>` ×4,
  `<select>` ×1, `<Link>`/`<a>` ×28) — **zero `div`/`span` `onClick`**, so everything is tabbable +
  Enter/Space-operable by default. A single global `:where(a,button,input,select,textarea,summary,
  [tabindex]):focus-visible` rule gives every focusable element a visible focus ring. The search picker is a
  `role="list"` of `<Link>`s (natively operable — no hand-rolled ARIA combobox to mis-wire).

## Validation
`npm run typecheck` · `npm test` · `npm run lint` — all **PASS**. 5 new a11y tests; web suite green; the
`PaginatedTable` caption change broke nothing (178→ green). No API/contract change; one additive web prop.

## Acceptance
- [x] Bundle/perf sanity — audited, healthy (no fixes).
- [x] Automated a11y (axe) — structural net added; all pass.
- [x] Manual keyboard pass — code-level audit clean (native elements, global focus-visible, operable picker).
- [x] Real a11y fix — list-table accessible names (closes the 13b-ux deferred item).

## Closes Phase 13d
13d-1 (RC checklist) + 13d-2 (readiness doc) + 13d-3 (soak, GREEN at 2,500 blocks) + 13d-4 (perf/a11y) are
all done. Remaining for the RC: independent review (adversarial + Codex) of the 13d work, then the
`explorer-phase-13` tag per the readiness doc gate.
