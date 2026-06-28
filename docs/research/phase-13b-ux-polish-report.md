# Phase 13b-ux — UX & Accessibility Polish — Report

Date: 2026-06-28
Branch: `feat/13b-ux-polish`
Plan: `phase-13-explorer-hardening-plan.md` §5.2 · Audit: `phase-13a-explorer-hardening-audit.md`
Status: **PASS** (implemented; multi-lens adversarial review = the per-slice gate, run + folded in).

## Scope

The UX/a11y half of Phase 13b — the judgment findings from the 13a audit. Web (`apps/web`) only; no API/
schema/contract change; polish, not redesign (plan guardrail #2). Closed out with a **multi-lens a11y/UX
review** (one reviewer per WCAG criterion + responsive + nav-IA/copy) as the adversarial gate.

## Fixes (by batch)

**Batch 1 — shell + a11y foundation:**
- **M-004** (major) mobile header overlap — `Header` `fixed`→**`sticky`** (in-flow, can't obscure content) +
  dropped the guessed `main` padding compensation.
- **M-007** (major, WCAG 2.4.7) — a global `:where(a,button,input,…):focus-visible` ring in `globals.css`
  (0-specificity so components can override) + removed SearchBar's `focus:outline-none`.
- **M-008** (major, WCAG 1.4.3) — `--text-muted` lifted ~3.9:1 → ~5.3:1 (auction) / ~5.7:1 (legacy).
  **Guard:** token-contrast unit test (`theme-tokens.test.ts`).
- **M-012** (WCAG 2.4.1) — "Skip to main content" link (first focusable) → `#main` (`tabIndex=-1`).
- **M-005** — root `title.template`.
- **J-007** — nav grouped by concern (explore/validators/economics/diagnostics) + desktop separators.
  **Guard:** nav-grouping test (`Header.test.tsx`).

**Batch 2 — structural a11y/navigation:**
- **M-006** breadcrumbs — `DetailShell` `backHref`/`backLabel`; wired on all 6 detail surfaces
  (block/tx/account/coreslot/reward-epoch/operator).
- **J-009** — `DetailShell` optional `description`.
- **M-009** (WCAG 1.3.1) — `Th` `scope="col"` + optional sr-only `caption` on `Table`.
- **M-010** — `CoreSlotDetail` `embedded` mode (headless, no second `DetailShell`/h1) reused by
  `OperatorView` → single h1 on the operator page.
- **M-011** — `SearchResults` single stable `<h1>` across all states.

**Batch 3 — consistency/copy:**
- **M-005** per-route `metadata.title` on all 16 server routes + an `app/api/layout.tsx` for the client route.
- **J-006** — `CardHeader` `linkLabel`; the 5 overview panel links given precise, unique names
  ("All blocks"/"All transactions"/"All CoreSlots"/"Open liveness"/"Supply detail") — no more 5× "View all".
- **J-003** — overview supply panel retitled "Supply (sampled)".
- **M-013** — LivenessOverview loading state wrapped in the same Card shell.
- **J-008** — the overview `LivenessRiskPanel` treats a 404 as the SAME soft "no snapshot yet" as the
  `/liveness` page (consistent across surfaces).
- **J-005** — claim-readiness label standardized to "production claim readiness:" in both surfaces.
- **M-014** / **M-015** — identifier cells use `shortenMiddle` + a copy control: AccountsList (M-014),
  and tx-hash list cells (TxsList + the overview) made copyable (M-015, folded from the review).

## Multi-lens adversarial review (the gate)

Five parallel read-only lenses — **focus/keyboard**, **contrast**, **headings/landmarks**, **tables/
responsive**, **nav-IA/copy**. Headline: the **default (auction) theme ships a11y-clean** and every core
fix was independently verified correct (focus ring covers 100% of the app's native controls; text-muted
5.25/5.69:1 with correct test math; single-h1 / M-010 / M-011 / breadcrumbs / nav-grouping / unique link
labels all PASS). **No blockers; no default-theme majors.**

**Folded in from the review:**
- **Heading lens F-1** — `/search`'s Suspense fallback rendered 0 h1 (the h1 lived inside `SearchResults`,
  below the boundary). Lifted `<h1>Search</h1>` into `search/page.tsx` above Suspense → a heading in every
  render incl. SSR/fallback.
- **Nav lens F1** — `OperatorView` had no breadcrumb (5/6 details did); added `→ /coreslots`.
- **Nav lens F2** — `/api` triple-named (nav "API" / title "Diagnostics" / h1 "…diagnostics"); title → "API".
- **Nav lens F4 / M-015** — tx-hash list cells were link-only while AccountsList (same slice) was copyable;
  made tx-hash cells copyable for parity.
- **Table lens F6** — added `scroll-padding-top` so anchors clear the new sticky header.

## Documented follow-ups (tracked, out of this slice's scope)

- **Legacy-theme contrast pass** (contrast lens) — the *opt-in* `legacy` theme (`NEXT_PUBLIC_UI_THEME=legacy`)
  has pre-existing sub-AA pairs the audited M-008 didn't cover: `--primary` link text (~2.9:1 on card), the
  `info` badge (~2.7:1), some `accent-red` status text (~4.0–4.5:1). The **default auction theme is clean**;
  fixing legacy `--primary`/badge tokens is a theme-design change beyond UX polish. Also broaden the
  contrast test to cover primary/badge/accent pairs (it currently asserts only text-muted).
- **Table accessible names** (table lens) — `Th scope="col"` satisfies WCAG 1.3.1 structurally (no axe
  "must-have-caption" rule), but the new `caption` prop is populated on 0/23 tables and isn't yet reachable
  through `PaginatedTable` (13 tables). A mechanical follow-up: thread `caption` through `PaginatedTable`
  and pass each section's Card title — a screen-reader discoverability win on multi-table pages (`/api`,
  `/rewards`, coreslot detail).
- **Mobile nav disclosure** (J-007 mobile part / table + nav lenses) — the compact nav is a flat 10-chip
  wrap in the now-sticky header (~190px tall at 375px). Not a regression (the old fixed header pinned the
  same block) and not an SC violation; a hamburger/disclosure is a deferred enhancement.
- **J-004** — CoreSlot rewards per-row `sampledAtHeight` with no single freshness note: the review judged
  this **genuinely correct to leave** (a multi-row table where each epoch row has its own sample height; a
  single aggregate note would be less honest).

## New tests / guards

`theme-tokens.test.ts` (contrast, M-008) · `Header.test.tsx` (nav grouping, J-007). Existing detail/
operator/search tests still green (the `embedded` + breadcrumb refactors are covered).

## Validation (all green)

`apps/web` typecheck · **158 tests** (+4) · build ✓. No API/schema/contract change.

## Recommendation

Ready to commit/merge. The default theme is a11y-clean, every audited finding is fixed or consciously
documented, and the multi-lens gate passed with its should-fixes folded in. The tracked follow-ups
(legacy-theme contrast, table captions) are honest, scoped, and non-blocking.
