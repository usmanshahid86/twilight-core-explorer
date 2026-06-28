# Phase 13b-filters — List `status` Filters (J-002 carve-out) — Report

Date: 2026-06-28
Branch: `feat/13b-filters`
Plan: `phase-13-explorer-hardening-plan.md` §5.3 · Audit: `phase-13a-explorer-hardening-audit.md` (J-002)
Status: implemented; pending adversarial + Codex review.

## Scope

The one **acknowledged feature** in Phase 13 (the single exception to guardrail #1 "hardening, not
features"), kept deliberately small + separately reviewed. Surface the two high-value, operator-facing
list `status` filters the API **already serves**:
- **`coreslots?status=`** — active / inactive / suspended / removed
- **`txs?status=`** — success / failed

…as URL-synced, accessible controls matching the existing `?slotId=` searchParams pattern, with cursor
reset on change and an empty-filtered state. Kept to exactly these two so it establishes **one reusable
filter pattern**.

## Guardrails honored

- **No API / contract change.** Both params already exist (`CoreSlotsQuery`/`TxsQuery` → exact-match
  `where: { status }`), the generated client already types `status?: string`, and **`openapi:check` is
  up to date**. No new routes; no DTO/schema edits.
- **Cursor/pagination preserved.** Keyset cursors stay opaque; `status` joins the React Query `queryKey`
  so a filter change re-keys to an unfetched cache entry → fresh page-one fetch (no stale cursor). No
  manual cursor handling added.
- `apiGet` drops `undefined`, so the unfiltered call is byte-for-byte unchanged (`status` omitted).

## What was built

- **`components/list/StatusFilter.tsx`** (new, reusable) — a labelled, keyboard-operable `<select>`
  (`<label htmlFor>` + native select) that syncs `?status=` via `usePathname` + `router.replace`
  (`replace`, not `push` — no history spam; `usePathname` keeps it out of a Suspense boundary). Exports
  `CORESLOT_STATUS_OPTIONS` + `TX_STATUS_OPTIONS`. `''` ⇒ "All" ⇒ bare path (param dropped).
- **`lib/api/queries.ts`** — `useCoreSlotsList(status?)` / `useTxsList(status?)`: `status` added to both
  the `queryKey` (cursor reset) and `apiGet`.
- **`components/{coreslots/CoreSlotsList,txs/TxsList}.tsx`** — accept a `status` prop, render the filter
  above the table, and pass a **status-aware empty message** ("No removed CoreSlots." / "No failed
  transactions.") distinct from the unfiltered empty state.
- **`lib/status-filters.ts`** (new, server-safe) — the `StatusOption` type, the two option-value enums,
  and **`coerceStatus`** (the trust-boundary normalizer). Kept out of the `'use client'` component so the
  server route pages can import it without pulling in a client component.
- **`app/{coreslots,txs}/page.tsx`** (server) — read `searchParams.status` via `oneParam` then
  **`coerceStatus`**: the raw URL value is normalized case-insensitively to the canonical stored enum
  (`?status=active` → `ACTIVE`) or dropped to "All" if unknown — so only valid values ever reach the
  case-sensitive API filter (Codex review fix). Per-route titles unchanged.

## Tests (14 new; 173 web total)

- `status-filters.test.ts` (3) — enum-casing guard (option values = stored enum); **`coerceStatus` URL
  ingress**: lowercase/mixed-case URL → canonical (`active`→`ACTIVE`), cross-list/unknown/empty → `undefined`.
- `StatusFilter.test.tsx` (4) — renders "All" + options; selection → `router.replace('…?status=failed')`;
  "All" → bare path; reflects the current value.
- `CoreSlotsList.test.tsx` (+4) — status reaches `apiGet`; status-aware empty message; control rewrites
  the URL; **cursor reset** (rerender with a new status → fresh `apiGet` with `cursor: undefined`).
- `TxsList.test.tsx` (new, 2) — status reaches `apiGet`; status-aware empty message.

## Deferred (documented, not built) — future "rewards filters" follow-up

The J-002 rewards-side filters adopt this same pattern later, out of this slice:
- **claims**: `txHash` / `fromHeight` / `toHeight`
- **balances**: `sampleKind` / `denom` / `height`
- **params**: `changeType`

The existing `?slotId=` cross-link (12c) is unchanged.

**CoreSlot status casing (adversarial-review fix).** The API status filter is a **case-sensitive exact
match** (`WHERE status = $1`), and the indexer writes CoreSlot status **UPPERCASE**
(`statusFromEventType` / genesis `normalizeStatus`: `ACTIVE`/`PENDING`/`INACTIVE`/`SUSPENDED`/`REMOVED`).
The first cut used lowercase option values, which would have silently returned zero rows for every
CoreSlot filter — caught by the adversarial review. Option values are now the exact UPPERCASE enum,
**locked by a test** tied to the indexer enum. The slice offers all **5** real states (the contract named
4; `PENDING` added so newly-registered slots are reachable). Tx status is lowercase (`success`/`failed`)
and was already correct.

**URL ingress validation (Codex review fix).** The option-value fix only governs what the dropdown
*emits* — the `?status=` URL is the real source of truth and can carry anything (bookmarks, stale links,
hand-edited URLs). The server pages now run the raw value through **`coerceStatus`** at the trust
boundary: a known value is normalized case-insensitively to its canonical stored form
(`?status=active` → `ACTIVE`, so old/lowercase links still work), and an unknown / cross-list value drops
to "All". Only canonical values ever reach the case-sensitive API filter. Proven by `status-filters.test.ts`.

## Validation (all green)

`apps/web` typecheck · **173 tests** (+14) · build ✓ · lint (0 warnings) · `openapi:check` up to date
(no API drift). No API/indexer/schema change.
