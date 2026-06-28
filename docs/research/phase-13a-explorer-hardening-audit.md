# Phase 13a — Explorer Hardening Audit

Date: 2026-06-28
Branch: `audit/13a-explorer-hardening`
Plan: `phase-13-explorer-hardening-plan.md` (this is the §4 / 13a deliverable)

## Status

**AUDIT COMPLETE — NO FIXES APPLIED.** This pass is read-only. It catalogues defects and assigns each
a fix-home + a concrete pass/fail acceptance condition. No runtime file, test, guard, schema, route, or
config was changed. The only file written is this document.

## Executive summary

The explorer is in **strong shape**. **0 blockers, 0 hard-invariant violations.** Every Phase-13
invariant we set out to protect **held**: string-safety (no `Number()`/parse on int64-scale chain
data), the DB-only/web-transport boundary (no `fetch`/RPC/Prisma in `apps/web`), opaque keyset cursors,
`error.code` (never message-text) branching, the read-only rewards posture (no claim/wallet/tokenomics),
caveat-as-data (contract caveat fields rendered verbatim), and no fabricated-zero for sampled data.

**25 findings: 3 major, 15 minor, 7 nit.** The majors are all **accessibility / responsive-layout**
(a fixed-header mobile overlap, missing focus-visible indicators, and a sub-AA text-muted contrast) —
real pre-RC issues but none block correctness. The remaining items are UX consistency, two coverage
gaps (an unconsumed diagnostic endpoint, unused filter params), one freshness-label overstatement, and
the known `lint`-is-vacuous gap. Heaviest fix-home is **13b-ux**.

## Scope confirmation

No runtime fixes were applied. `git status --short` after the audit shows only this new file
(`docs/research/phase-13a-explorer-hardening-audit.md`). Confirmed by all four sub-audits independently
("zero backend/OpenAPI diff"). No new page, endpoint, schema, route, guard, or test was added.

## Decisions (resolved with user, 2026-06-28)

The two product calls this audit surfaced (J-001, J-002) are now resolved; the findings, routing, and
recommended scopes below reflect these.

- **J-001 → surface it.** `/api/v1/decode-failures` will be surfaced on the `/api` diagnostics page in
  **13b-code** (a new `useDecodeFailures` hook + a "Decode failures" card beside the existing projections
  card). Not allowlisted/deferred.
- **J-002 → tiered (not all-or-nothing).** The two high-value, operator-facing **list `status` filters —
  `coreslots?status=` and `txs?status=`** — will be built now as a small, **separately-reviewed
  `13b-filters` slice** (URL-param synced like the existing `?slotId=`, cursor-reset on change, an
  empty-filtered state, accessible controls). This is a deliberate, scoped **feature** carve-out inside
  the hardening phase — explicitly *not* "hardening" — kept tight to those two so it does not balloon and
  so it establishes one reusable filter pattern. The remaining unused filters — claims
  `txHash`/`fromHeight`/`toHeight`, balances `sampleKind`/`denom`/`height`, params `changeType` — are
  **deferred + documented** as a later "rewards filters" follow-up that will adopt the same pattern. The
  existing `?slotId=` cross-link (12c) stays as-is.

## Validation commands

All run on `audit/13a-explorer-hardening` before/while auditing (evidence, not fixes).

| command | result | notes |
|---|---|---|
| `git branch --show-current` | `audit/13a-explorer-hardening` | branched from clean `main` |
| `npm run typecheck` | **EXIT 0** | clean |
| `npm run lint` (root) | **EXIT 0** | ⚠ green but **vacuous** — `--workspaces --if-present` only runs `apps/web`'s `next lint`; api/indexer/packages have no lint script (finding M-016) |
| `npm test` (root) | **EXIT 0** | passes |
| `npm --prefix apps/api test` | **EXIT 0** | 114 pass / 0 fail |
| `npm --prefix apps/indexer test` | **EXIT 0** | 274 pass / 0 fail |
| `npm --prefix packages/chain-client test` | **EXIT 0** | pass |
| `npm --prefix apps/web test` | **EXIT 0** | 32 files pass (113 tests) |
| `npm --prefix apps/web run lint` | **EXIT 0** | `next lint` clean |
| `npm --prefix apps/api run openapi:check` | **EXIT 0** | OpenAPI spec up to date |
| `npm --prefix apps/web run openapi:check` | **EXIT 0** | generated types up to date |
| `npm --prefix apps/web run build` | **EXIT 0** | compiled; all routes built |
| `git diff --check` | **EXIT 0** | no whitespace/conflict errors |

## Findings summary

| | blocker | major | minor | nit | total |
|---|---|---|---|---|---|
| **M** (mechanical/guard-able) | 0 | 3 | 7 | 6 | 16 |
| **J** (judgment) | 0 | 0 | 8 | 1 | 9 |
| **total** | **0** | **3** | **15** | **7** | **25** |

By fix-home: **13b-code** 4 · **13b-ux** 17 · **13b-filters** 1 (J-002 — scoped feature carve-out) · **13c-1** 1 · (13c-2/3/4, 13d, 14 are routed as
release-readiness items, not numbered findings — see "Release-Readiness Routing"). By category:
accessibility 7 · UX-consistency 9 · correctness 3 · coverage 2 · caveat-consistency 3 · build-hygiene 1.

## Findings

Each finding lists: severity · M/J · category · location · why it matters · recommended fix (NOT
applied) · fix-home · acceptance condition. M findings also name the durable guard (see Convert-to-Guard).

### Major

**M-004 · major · M · responsive-layout · `apps/web/src/app/layout.tsx:44` + `components/Header.tsx:30,58-76`**
Fixed header (`position:fixed`) is compensated by `<main class="pt-20 lg:pt-[57px]">`, but below `lg`
the header is the 64px row **plus** the search input + a `flex-wrap` of 10 nav chips (~150-210px), so
`pt-20` (80px) does not clear it and the page `h1`/first content renders *under* the blurred header; on
`lg`, 57px vs a 64px header leaves ~7px overlap. *Why:* a real layout break on the most space-constrained
viewport. *Fix:* drive `main` padding off actual header height (CSS var / sticky), bound the mobile nav
height, set `lg:pt-16`. *Fix-home:* 13b-ux. *Accept:* at 375px & 768px the header bounding height ≤
`main` computed `padding-top` (layout/RTL or Playwright check that page `h1` top ≥ header bottom).

**M-007 · major · M · accessibility (WCAG 2.4.7) · `apps/web/src/components/SearchBar.tsx:32` + app-wide**
No interactive element (nav links, the `Card` "View all" anchor, table `<Link>`s, `CopyButton`,
"Load more", `RawSection` toggle, search-result links) defines a `focus-visible` style; they rely on the
UA default ring, inconsistent on the near-black theme. The search input goes further: `focus:outline-none`
with only a 1px border-color shift. *Why:* keyboard-only operators lose focus tracking; the removed
outline is a clear WCAG 2.4.7 violation. *Fix:* a global `:focus-visible` ring (≥3:1 vs background) on
`a,button,input`; pair the input's `outline-none` with a visible ring. *Fix-home:* 13b-ux (base rule may
sit in 13d-rc). *Accept:* no interactive element sets `outline-none` without a replacement ring; a base
`:focus-visible` rule applies; manual tab pass shows a visible indicator on every control.

**M-008 · major · M · accessibility (WCAG 1.4.3) · `apps/web/src/app/globals.css:47` (`--text-muted` #6B6B7A)**
`text-text-muted` (#6B6B7A) on `--background` #050505 computes to ≈**3.9:1**, below the 4.5:1 AA
threshold for normal text, and is used pervasively at body/small sizes (page descriptions, table
headers, hints, "View all" link, footer, MonoCopy placeholders, the "sampled at" notes). `text-secondary`
(≈8:1) and `primary` gold (≈9:1) pass; the failure is isolated to `text-muted`. *Why:* a large share of
secondary copy in an operator tool is hard to read. *Fix:* lighten `--text-muted` to ≥4.5:1 on #050505
(~#8A8A99), and/or reserve the current value for ≥18.66px text. *Fix-home:* 13b-ux (token; 13d-rc theme
pass acceptable). *Accept:* contrast(`--text-muted`,`--background`) ≥ 4.5:1, asserted by a token-contrast
unit test (extend the existing `app/theme-tokens.test.ts`).

### Minor

**M-003 · minor · M · correctness/trust (freshness) · `apps/web/src/lib/freshness.ts:42-44`**
When `sampledAtHeight` is present but `latestIndexedHeight` is null/non-numeric (status pending/errored),
`deriveSampleAge` returns `{kind:'fresh', deltaBlocks:'0'}`, rendered as a green "sample current" badge
(consumers: `SupplyPanel.tsx:22`, `SupplyView.tsx:29`, `accounts/BalancesSection.tsx:30`). *Why:* it
asserts freshness it cannot verify — overstates currency on observed-sample surfaces (not a
fabricated-zero; the sampled height is still shown truthfully). *Fix:* add an `{kind:'unknown'}` branch
rendered as a neutral "age unknown", not "current". *Fix-home:* 13b-code. *Accept:* unit test
`deriveSampleAge('100', null)` returns a non-`fresh` kind AND `SampleAgeLabel` renders non-success tone.

**M-005 · minor · M · metadata/UX · only `apps/web/src/app/layout.tsx:22-26` sets `metadata.title`**
No route exports `metadata`/`generateMetadata`; every tab/bookmark/history entry reads
"Twilight Core Explorer". *Why:* operators keep multiple explorer tabs (liveness vs a block vs an
operator) — identical titles make them indistinguishable. *Fix:* root `title.template` +
per-route `metadata.title`/`generateMetadata` (add `app/api/layout.tsx` for the one client route).
*Fix-home:* 13b-ux. *Accept:* a test imports each `app/**/page.tsx` (or segment layout) and asserts a
resolvable title; root defines `title.template`.

**M-006 · minor · M · navigation · `apps/web/src/components/detail/DetailShell.tsx:4-11` + all 6 detail callers**
`DetailShell` renders only an `<h1>` + children; none of the six detail surfaces (block, tx, coreslot,
account, operator, reward-epoch) link back to their list. `not-found.tsx` *does* have a back link, so the
absence on detail pages is also internally inconsistent. *Why:* arriving via search/deep-link, the user
has no in-context way back to the surrounding list. *Fix:* optional `backHref`/`backLabel` (breadcrumb)
on `DetailShell`. *Fix-home:* 13b-ux. *Accept:* a test renders each detail component and asserts a link
to its parent list route exists (`/blocks/123` contains `<a href="/blocks">`).

**M-009 · minor · M · accessibility (WCAG 1.3.1/4.1.2) · `apps/web/src/components/ui/Table.tsx:17-19,4-15`**
`Th` has no `scope="col"`; `Table` has no `<caption>`/`aria-label`. Every data table (liveness, health,
validator-set, proposers, txs, blocks, accounts, rewards) flows through these primitives. *Why:* screen
readers benefit from explicit column scope + a table name on the wide 5-6 column tables. *Fix:* add
`scope="col"` to `Th`; optional `caption` rendered `sr-only`. *Fix-home:* 13b-ux. *Accept:* `Th` outputs
`scope="col"`; `Table` exposes an accessible name; axe table-rules pass (RTL test).

**M-010 · minor · M · accessibility/heading · `operator/OperatorView.tsx:59` nests `coreslots/CoreSlotDetail.tsx:55`**
A loaded operator page renders **two `<h1>`** (operator name + "CoreSlot N") because `OperatorView`
embeds the whole `CoreSlotDetail` (its own `DetailShell`). *Why:* one-h1-per-page best practice; duplicate
top-level headings confuse SR navigation. *Fix:* an embedded/"headless" `CoreSlotDetail` mode (sections
without its own `DetailShell`/h1) reused by `OperatorView`. *Fix-home:* 13b-ux. *Accept:* the rendered
operator page has exactly one `h1` (`getAllByRole('heading',{level:1})` length 1).

**M-011 · minor · M · accessibility/heading · `apps/web/src/components/SearchResults.tsx:24-36` vs `:41`**
The only `<h1>` ("Search results") is in the multi-match branch; the empty-query/pending/error/no-results/
"Redirecting…" branches render with no page heading. *Why:* those states present a page with zero
headings — inconsistent with every other route always having an h1. *Fix:* a constant `<h1>Search</h1>`
(or `DetailShell`) around all states. *Fix-home:* 13b-ux. *Accept:* every render path of `SearchResults`
includes exactly one `h1` (RTL test per state).

**M-012 · minor · M · accessibility (WCAG 2.4.1) · `apps/web/src/app/layout.tsx:40-49`**
No "skip to main content" link; `<main>` has no `id`. Landmarks exist (so SR users can bypass), but
keyboard-only users tab past the search box + 10 nav links on every page. *Why:* Bypass Blocks (Level A),
only partially mitigated by landmarks. *Fix:* a visually-hidden, focus-visible skip link as the first
focusable element targeting `#main`. *Fix-home:* 13b-ux. *Accept:* first Tab focuses a "Skip to main
content" link that moves focus to `#main`.

**M-016 · minor · M · build-hygiene · root `package.json` `lint` = `npm run lint --workspaces --if-present`**
`npm run lint` returns EXIT 0 but only `apps/web` has a `lint` script (`next lint`); `apps/api`,
`apps/indexer`, and every `packages/*` have none, so `--if-present` silently skips them. *Why:* "lint is
green" is misleading — most of the codebase is unlinted; this is the headline 13c-1 debt, confirmed live.
*Fix:* wire a TS-aware ESLint config + `lint` script per workspace (warn-only baseline; invariant guards
hard-fail). *Fix-home:* 13c-1. *Accept:* `npm run lint` exercises every workspace (each prints a real
lint run); a CI/static check asserts no workspace lacks a `lint` script.

**J-001 · minor · J · coverage · `docs/reference/openapi.json` (`/api/v1/decode-failures`) — no consumer**
The decode-failures diagnostic endpoint is specified + indexed but no `useDecodeFailures` hook exists and
`app/api/page.tsx` surfaces `/projections` only. The natural host (`/api` diagnostics) shows nothing about
decode failures, and no doc records it as deferred. *Why:* a monitor cannot see unresolved decode failures
from the UI even though the data + a diagnostics page exist. *Fix:* add a hook + "Decode failures" card on
`/api`, OR explicitly allowlist the path as internal + record the deferral. *Fix-home:* **13b-code —
RESOLVED: surface it** (see Decisions; new `useDecodeFailures` hook + a "Decode failures" card on `/api`).
*Accept:* see Convert-to-Guard (openapi-path→consumer coverage test): every path is consumed-or-allowlisted;
currently must FAIL on `/api/v1/decode-failures`, and after 13b-code it passes via the new consumer.

**J-002 · minor · J · UX/scope · `apps/web/src/lib/api/queries.ts:168-175,242-249,456-490`**
Several consumed endpoints expose filter params the UI never sends: claims `txHash/fromHeight/toHeight`,
balances `sampleKind/denom/height`, params `changeType`, txs list `status`, coreslots list `status`. Not
coverage gaps — unused query capacity. *Why:* operator workflows ("claims in height range", "failed txs",
"removed CoreSlots") need these; silent divergence is easy to forget. *Fix-home:* **RESOLVED (tiered — see
Decisions):** `coreslots?status=` + `txs?status=` → a dedicated **`13b-filters`** slice now (the two
high-value, operator-facing filters); claims `txHash`/`fromHeight`/`toHeight`, balances
`sampleKind`/`denom`/`height`, params `changeType` → **deferred + documented** (later "rewards filters"
follow-up); existing `?slotId=` cross-link unchanged. *Accept:* `coreslots?status=` and `txs?status=` are
each driven by a control whose param reaches `apiGet` (asserted by a test) with cursor-reset on change;
the deferred filters are listed in the 13b report's "deferred filters" note.

**J-003 · minor · J · caveat-consistency · `overview/SupplyPanel.tsx:39` & `accounts/BalancesSection.tsx:33` vs `supply/SupplyView.tsx:34` & `rewards/sections/BalancesSection.tsx:34`**
Four sampled surfaces, two conventions: `/supply` and the rewards module-balances section echo the
contract's `source:<value>` verbatim; the Overview SupplyPanel and account balances convey sampled-ness
only via `SampledAtNote`. SupplyPanel is weakest — its header is just "Supply" (no "sampled"), never
echoes `source`. *Why:* "is this live or sampled?" reads differently per page, softening the deliberate
observed/read-only posture. *Fix:* one convention (echo `source` everywhere, or rely on `SampledAtNote`
everywhere; at minimum retitle the panel "Supply (sampled)"). *Fix-home:* 13b-ux. *Accept:* a test asserts
all four sampled surfaces present the sampled qualifier identically.

**J-004 · minor · J · caveat-consistency · `apps/web/src/components/coreslots/sections/CoreSlotRewardsSection.tsx:39`**
The CoreSlot rewards subsection renders `sampledAtHeight` as a per-row column but never computes
`deriveSampleAge`/`SampledAtNote`, so a reader can't tell whether a per-slot reward sample is current or
stale — unlike SupplyView/SupplyPanel/balances. *Why:* the plan requires those sampled surfaces to present
freshness consistently; here a stale sample looks identical to a current one. *Fix:* derive sample age vs
`status.lastIndexedHeight` and surface a freshness indicator, OR document in-code why per-row heights
preclude a single note. *Fix-home:* 13b-ux. *Accept:* the subsection renders a freshness indicator
(current/old/no-sample) asserted by a test, OR the per-row-only choice is documented in-code.

**J-006 · minor · J · UX/a11y link-clarity · `apps/web/src/components/ui/Card.tsx:26-30` + Overview panels**
`CardHeader` renders the literal "View all →" whenever `href` is set. Correct for list targets
(`/blocks`, `/txs`, `/coreslots`) but **wrong** for `SupplyPanel→/supply` (a single sampled table) and
`NetworkPanels LivenessRiskPanel→/liveness` (a risk summary). Also: the five overview links share the
accessible name "View all →" (WCAG 2.4.4 — indistinguishable out of context). *Why:* "View all" promises
a longer list that doesn't exist for those targets; duplicate link names hurt SR navigation. *Fix:* an
`actionLabel?` prop, defaulting to "View all" only for genuine lists; explicit labels ("Open liveness →",
"Supply detail →"). *Fix-home:* 13b-ux. *Accept:* the two non-list panels render a label other than "View
all"; no two links on `/` share an accessible name.

**J-007 · minor · J · nav/IA · `apps/web/src/components/Header.tsx:9-20,40-76`**
`NAV` is a flat 10-item list spanning four concerns (explore / validators / economics / diagnostics); the
compact (`lg:hidden`) variant renders all 10 as an always-visible `flex-wrap` (no disclosure). *Why:*
discoverability is already strained at 10 flat items and the wrap inflates mobile header height (feeds
M-004); it degrades as routes grow. *Fix:* labeled groups (Explore/Validators/Economics/Diagnostics);
collapse the compact variant behind a disclosure. *Fix-home:* 13b-ux. *Accept:* `NAV` is expressed as
labeled groups (each item carries a `group`), asserted by a test; the compact nav renders behind a toggle.

**J-008 · minor · J · state-consistency · `liveness/LivenessOverview.tsx:18-28` vs `overview/NetworkPanels.tsx:71-104`**
The dedicated `/liveness` page treats a liveness-risk 404 as a soft "No liveness snapshot yet." card; the
overview's `LivenessRiskPanel` runs the same query through `QueryBoundary`, so a 404 renders a red
"Liveness risk: Not found." error. *Why:* the same benign "no snapshot yet" reads as a failure on the home
page. *Fix:* share one liveness-risk renderer (or one 404→soft branch). *Fix-home:* 13b-ux. *Accept:*
mounting `LivenessRiskPanel` with a mocked 404 renders the soft "no snapshot" copy, not `ErrorState`.

### Nit

**M-001 · nit · M · dead-code · `apps/web/src/components/PlaceholderPage.tsx`** — defined but imported by
zero routes/components (all 18 routes are real). *Why:* invites accidental reuse of stale "arrives in
Phase X" messaging; clutters the surface. *Fix:* delete. *Fix-home:* 13b-code. *Accept:*
`grep -rn PlaceholderPage apps/web/src` returns nothing; typecheck + build still pass.

**M-002 · nit · M · React-hygiene · `apps/web/src/components/txs/TxDetail.tsx:74,124`** — signers + events
keyed by bare array index, unlike the content-keyed rest of the codebase. No live bug (lists don't
reorder) but it's the anti-pattern a guard should forbid. *Fix:* key by `${a}-${i}` / `${e.type}-${i}`.
*Fix-home:* 13b-code. *Accept:* ESLint `react/no-array-index-key` reports 0 in `apps/web/src`.

**M-013 · nit · M · state-consistency · `apps/web/src/components/liveness/LivenessOverview.tsx:17`** — the
loading branch returns a bare `<LoadingState>` while success/404 render inside `<Card><CardHeader>`, so the
card frame appears/disappears on load. *Fix:* wrap the skeleton in the same Card shell. *Fix-home:* 13b-ux.
*Accept:* the card title is present while pending.

**M-014 · nit · M · consistency · `apps/web/src/components/accounts/AccountsList.tsx:19-23`** —
reimplements address truncation (16/6) inline + a separate copy button instead of `MonoCopy`/`shortenMiddle`
(10/6), so truncation length is inconsistent across lists vs detail. *Fix:* use `<MonoCopy>`. *Fix-home:*
13b-ux. *Accept:* `AccountsList` uses `MonoCopy`; a test asserts truncation matches `shortenMiddle`.

**M-015 · nit · M · consistency · `overview/ActivityPanels.tsx:86-88`, `txs/TxsList.tsx:17-21`** — tx-hash
list cells are a truncated `<Link>` with no copy affordance, while addresses/proposers elsewhere use
`MonoCopy` (link + copy). *Fix:* standardize identifier cells on "link + copy" (or document the rule).
*Fix-home:* 13b-ux. *Accept:* a documented rule + a test/lint flagging raw `.slice(...)+'…'` identifier
rendering outside `MonoCopy`.

**J-005 · nit · J · caveat-label · `rewards/sections/ClaimsSection.tsx:68` vs `coreslots/sections/CoreSlotRewardsSection.tsx:59`**
Both render the contract VALUE `read_only_no_claim_action` verbatim (good), but the human LABEL differs:
`productionClaimReadiness:` (camelCase) vs `production claim readiness:` (spaced). *Fix:* one label form.
*Fix-home:* 13b-ux. *Accept:* both surfaces use an identical label string for the field.

**J-009 · nit · J · consistency · `apps/web/src/components/detail/DetailShell.tsx:4-11`** — list/overview
pages render a one-line description subtitle; detail pages can't (no `description` slot). *Fix:* optional
`description` prop (low priority). *Fix-home:* 13b-ux. *Accept:* `DetailShell` accepts an optional
`description` (not required everywhere).

## Convert-to-Guard list (every M finding → durable guard, to be ADDED in 13b/13c, not now)

| finding | guard type | proposed test/lint/script | fail condition |
|---|---|---|---|
| M-001 | static / knip | unused-export check (or grep) under `components/` | a component export with zero importers |
| M-002 | lint rule | enable `react/no-array-index-key` | any `key={i}` bare index in `apps/web/src` |
| M-003 | unit test | `freshness.test`: `deriveSampleAge('100', null)` | returns `kind:'fresh'` |
| M-004 | layout test | RTL/Playwright at 375px & 768px | header bounding height > `main` padding-top |
| M-005 | metadata test | import each route, assert resolvable `metadata.title` | any route without a title |
| M-006 | RTL test | render each detail, assert parent-list back-link | any detail with no back link |
| M-007 | grep + manual | grep `outline-none` without a ring class + keyboard checklist | any control with no focus-visible |
| M-008 | token-contrast test | extend `app/theme-tokens.test.ts` | contrast(text-muted, background) < 4.5 |
| M-009 | RTL test | assert `<th scope="col">` + table accessible name | missing scope / name |
| M-010 | RTL test | operator page `getAllByRole('heading',{level:1})` | length ≠ 1 |
| M-011 | RTL test | each `SearchResults` state has one `h1` | any state with 0 h1 |
| M-012 | RTL test | first focusable element is the skip link | first focus ≠ skip link |
| M-013 | RTL test | loading branch renders inside the Card | card title absent while pending |
| M-014 | test/lint | `AccountsList` uses `MonoCopy` | inline `.slice` truncation in a list row |
| M-015 | lint/static | flag raw identifier truncation outside `MonoCopy` | raw `.slice(...)+'…'` on a hash/address |
| M-016 | CI/static guard | assert every workspace has a real `lint` script | any workspace missing `lint` |
| J-001 (guard) | coverage test | `coverage.test.ts`: every `openapi.json` path is consumed-or-allowlisted | a path with no consumer + not allowlisted |

(All boundary/string-safety/read-only invariants are already guarded by `lib/boundary.test.ts`,
`app/theme-tokens.test.ts`, `ClaimingCard.test.tsx`, `SupplyView.test.tsx`, `AccountDetail.test.tsx`,
`RewardsView.test.tsx`, and `openapi:check` — see "Checked, no finding".)

## OpenAPI endpoint coverage (32 paths)

29 reachable · 2 internal probes · **1 gap (`/api/v1/decode-failures` → J-001)**.

| status | paths |
|---|---|
| internal/diagnostic (by design) | `/health/live`, `/health/ready` |
| reachable (consumed by the UI) | `/api/v1/status`, `/blocks`, `/blocks/{height}`, `/txs`, `/txs/{hash}`, `/accounts`, `/accounts/{address}`, `/accounts/{address}/balances`, `/search`, `/projections`, `/coreslots`, `/coreslots/{slotId}`, `/coreslots/{slotId}/{events,windows,key-rotations,proposed-blocks,liveness,health,rewards}`, `/network/{proposers,validator-set,liveness-risk}`, `/rewards/{epochs,epochs/{epoch},claims,balances,params,treasury-payments}`, `/supply` |
| **gap** | `/api/v1/decode-failures` — specified + indexed, no UI consumer, not documented as deferred (J-001) |

Contract hygiene (CHECKED, NO FINDING): templated paths all use `apiGetPath` with URL-encoded params
(no string-concat); paginated endpoints use opaque keyset cursors (`page.nextCursor` passed back, never
`Number`/offset); detail endpoints distinguish 400 vs 404 via `error.code` (paths declaring only 200/404
collapse malformed input to 404, contract-consistent); response shapes ({data}/{data,page}/{error}) match
each consumer via `JsonOf<P>` (drift = type error).

## Web route coverage (18 routes)

All real or dynamic — **no placeholders, no dead/orphan routes, no empty-content route.** The only orphan
is the unused `PlaceholderPage` *component* (M-001), not a route.

| status | routes |
|---|---|
| real page | `/`, `/api`, `/accounts`, `/blocks`, `/txs`, `/coreslots`, `/liveness`, `/network`, `/rewards`, `/rewards/claims`, `/search`, `/supply` |
| dynamic route | `/accounts/[address]`, `/blocks/[height]`, `/txs/[hash]`, `/coreslots/[slotId]`, `/operator/[address]`, `/rewards/epochs/[epoch]` |

## Caveat and sampled-state audit

Every caveat literal that is a contract field renders **verbatim from the API row** (class (a)) — none are
hardcoded into rendered output. No stale `gated_by_phase_7_2` in active web code/tests (the only repo
references are a code comment in `apps/api/src/dto/rewards.ts:7`, the gitignored `apps/api/dist`, and
historical `docs/` reports — all acceptable).

| literal | active render location | source | class |
|---|---|---|---|
| `read_only_no_claim_action` | `ClaimsSection.tsx:69`, `CoreSlotRewardsSection.tsx:60` | row field | (a) verbatim |
| `aggregate_projection` | `EpochsSection.tsx:55`, `RewardEpochDetail.tsx:65` | row field | (a) |
| `event_history_only` | `ClaimsSection.tsx:69` | row field | (a) |
| `projection_observed_not_live_claimable` | `CoreSlotRewardsSection.tsx:59` | row field | (a) |
| `source:"sampled"` | `rewards/.../BalancesSection.tsx:34`, `SupplyView.tsx:34` (echoed); `SupplyPanel`, `accounts/BalancesSection` (NOT echoed) | row field | (a)/(e) → **J-003** |
| `sampledAtHeight` | `Freshness.tsx:54`, `SupplyView:55`, `SupplyPanel:39`, `accounts/BalancesSection:33`, `CoreSlotRewardsSection:39` (no freshness age) | row field | (a) / (e) → **J-004** |
| `productionClaimReadiness` (label) | `ClaimsSection:68` "productionClaimReadiness:" vs `CoreSlotRewardsSection:59` "production claim readiness:" | local label | (d) → **J-005** |

CHECKED, NO FINDING (read-only posture intact): no claim button / disabled claim button / wallet prompt /
"claim now" / connect-wallet anywhere (`ClaimingCard` non-actionable, guarded); no invented tokenomics
(no circulating/bonded/cap/halving/emission labels; no frontend emission math — `cumulativeEmitted` is the
contract field, not computed); no account→`?claimant=` relation invented (account links only to `/supply`,
guarded); no fabricated 0 for missing sampled data (sampled:false→"no sample", null height→em-dash, no
supply sample→404→NotFound, guarded); `rewardPool`/`carryOut` never rendered as first-class fields (only
negative-assertion tests reference them).

## Accessibility / UX audit (summary)

A11y findings: M-007 (focus-visible, major), M-008 (text-muted contrast, major), M-009 (table scope/
caption), M-010 (duplicate h1 operator), M-011 (search h1), M-012 (skip link), J-006 (duplicate link
names). Recommended 13b-ux test mix: **token-contrast unit test** (M-008, extend theme-tokens.test);
**RTL tests** (M-009/010/011/012/013, B-style heading/role assertions); **axe-style automated test** on a
representative page (M-007/008/009); **a manual keyboard checklist** (M-007/012 focus + skip).
CHECKED, NO FINDING: icon-only control names (`CopyButton` aria-label, search input `aria-label`, decorative
magnifier `pointer-events-none`); search picker is a correct list-of-links; wide tables scroll via
`overflow-x-auto min-w-[36rem]` (no layout break); `text-secondary`/`primary` pass AA.

## Release-readiness routing (confirmed current state → later phases; NOT 13a findings)

**13c-1 (linter/guards):** M-016 (root lint vacuous) + the invariant guards from Convert-to-Guard that
must be wired hard-fail into the standard test/lint path.

**13c-2 (HTTP hardening):** security headers (helmet) **ABSENT**; `Cache-Control`/`ETag` **ABSENT**; CORS
**present** (`@fastify/cors`, `config.corsOrigins`; non-prod default reflects any origin — **needs a prod
lockdown review**, `plugins/cors.ts:1`).

**13c-3 (rate limiting):** **ABSENT** — `plugins/cors.ts:1` literally notes "rate-limiting is deferred to
hardening". Needs in-process limiter + standard `{error}` 429 + disable-able-for-test.

**13c-4 (version/observability):** no `/version`/git-SHA/buildInfo endpoint (**ABSENT**); pino logger runs
in prod (`index.ts:8` `logger:true`) but error-observability depth (structured error fields) unaudited;
`ProjectionFailure` visible via `/api/v1/projections` (surfaced on `/api`); decode-failures **not** surfaced
(J-001); indexer lag visible via `/status` freshness. Version truthfulness must be build/env metadata only
(no chain access).

**13d (RC):** no executable RC checklist; no route-render smoke test or API-endpoint smoke test (the suite
covers unit tests + build, not live route/endpoint smoke); no a11y verification harness; env-var contract
is scattered (not consolidated); soak plan = devnet + extended localnet (height window TBD). `docs/operations/`
does not exist yet (13d creates `explorer-release-readiness.md`).

**14 (deployment-ops):** Docker app containers + prod compose; migration/deploy workflow; DB backups;
nginx/TLS; CI/CD; shared-store (Redis) rate limiting; indexer gap/missing-height repair; multi-RPC fallback.

## Backlog reclassification (verified — routing still holds)

| item | plan routing | verified? |
|---|---|---|
| FU-1 temporal-map genesis `ProjectionFailure` durability | 13b-code | ✅ still correct (known correctness bug; fits trust theme) |
| FU-2 genesis-identity `0n` sentinel on empty `Block` table | 13b-code if cheap, else tracked | ✅ still correct |
| FU-3 duplicate malformed-genesis slot failureKey discriminator | 13b-code if cheap, else tracked | ✅ still correct |
| `RewardAmount` → neutral `CoinAmount` | 13b-ux optional / defer | ✅ still correct (cleanliness; relates to no new finding) |
| `/supply?height=` historical lookup | deferred | ✅ confirmed absent, intentionally deferred |
| claims/balances/params filter UI | deferred | **RESOLVED (J-002):** `coreslots?status=`+`txs?status=` → `13b-filters` slice now; claims/balances/params filters **deferred + documented** (later "rewards filters" follow-up) |
| dedicated rewards reconcile command | deferred | ✅ still deferred |

## Recommended 13b-code scope

M-001 (delete dead `PlaceholderPage`), M-002 (fix array-index keys), M-003 (freshness `unknown` branch),
**J-001 (surface decode-failures on `/api` — resolved)** — each with its durable guard from
Convert-to-Guard. Pull in **FU-1** (genesis `ProjectionFailure` durability) here per the plan; FU-2/FU-3
if cheap. Also document the J-002 **deferred filters** note here (so the report records the deferral).

## Recommended 13b-filters scope (scoped feature carve-out — J-002 resolution)

A small, separately-reviewed slice: surface **`coreslots?status=`** and **`txs?status=`** as URL-synced
list filters (match the existing `?slotId=` searchParams pattern), with **cursor reset on filter change**,
an empty-filtered state, and accessible controls. Explicitly a feature, not hardening — kept to these two
so it establishes one reusable filter pattern. The `?slotId=` cross-link stays as-is; the
claims/balances/params filters are deferred (documented).

## Recommended 13b-ux scope

Majors first: **M-004** (mobile header overlap), **M-007** (focus-visible), **M-008** (text-muted
contrast). Then: M-005 (page titles), M-006 (breadcrumbs), M-009 (table semantics), M-010 (operator dup
h1), M-011 (search h1), M-012 (skip link), M-013/M-014/M-015 (state/consistency nits), J-003/J-004
(sampled-qualifier + per-slot freshness consistency), J-005 (claim-readiness label), J-006 (View-all
labels + link names), J-007 (nav grouping), J-008 (liveness 404 consistency), J-009 (detail descriptions).
Not a redesign — every item is a clarity/consistency/a11y correction with a testable acceptance condition.
(J-002 moved to the `13b-filters` slice above.)

## Recommended 13c scope (from this audit)

13c-1: M-016 + wire the Convert-to-Guard invariant guards hard-fail. 13c-2: helmet headers + cache/ETag +
CORS prod-lockdown review. 13c-3: in-process rate limiter. 13c-4: `/version` (build/env metadata only) +
error-observability assessment + (with J-001) decode-failures visibility.

## Deferred / not Phase 13

`/supply?height=` historical lookup; dedicated rewards reconcile command; `RewardAmount`→`CoinAmount`
(optional cleanup); all Phase-14 deployment-ops infra. **The J-002 rewards-side filters** (claims
`txHash`/`fromHeight`/`toHeight`, balances `sampleKind`/`denom`/`height`, params `changeType`) are
**deferred + documented** (later "rewards filters" follow-up). (J-001 decode-failures and the J-002
`status` filters are NOT deferred — they ship in 13b-code / `13b-filters` respectively; see Decisions.)

## Final recommendation

**Proceed to 13b.** No blocker, no hard-invariant violation — the core correctness, string-safety,
read-only, DB-only, and caveat-as-data invariants all held, and most are already test-guarded. The three
**major** items are all accessibility/responsive (M-004 mobile overlap, M-007 focus-visible, M-008
contrast) and should lead the **13b-ux** queue; **13b-code** is small (M-001/002/003, J-001, + FU-1). The
audit found nothing requiring immediate out-of-band attention. **Both product decisions are now resolved**
(see Decisions): J-001 → surface decode-failures in 13b-code; J-002 → `coreslots?status=` + `txs?status=`
ship as a `13b-filters` slice, the rewards-side filters deferred + documented. 13b is unblocked: planned
slices are **13b-code**, **13b-ux**, and **13b-filters** (each its own review-gated, separately-committed
sub-slice).
