# Phase 12c — Supply + Cross-links — Implementation Report

**Status: PASS** (implemented, typechecked, linted, tested, built; 3-lens adversarial review PASS).
Date: 2026-06-28. Plan: `phase-12-rewards-supply-plan.md` (§7/§8/§13/§17). **Web-only — no API contract
change.** Not committed/merged.

## 1. Executive summary

Built the read-only `/supply` page (sampled total supply) and wired the rewards cross-links: the
CoreSlot/operator rewards section → filtered claim history (`/rewards/claims?slotId=`), the operator page
→ `/rewards`, and a contract-safe account → `/supply` link. Added the new `/rewards/claims` route that
reads `searchParams` and drives `ClaimsSection`'s existing filter. No `/supply` data/economics beyond the
sampled denom→amount; no `/supply?height=`, no filter UI, no claim actions.

## 2. Files

**New:** `components/supply/SupplyView.tsx` (+ `.test.tsx`); `app/rewards/claims/page.tsx` (+ `page.test.tsx`).
**Modified:** `app/supply/page.tsx` (placeholder → page + SupplyView); `coreslots/sections/
CoreSlotRewardsSection.tsx` (CardHeader `action` → "View claim history →"); `operator/OperatorView.tsx`
(always-rendered identity card → "View rewards →" `/rewards`); `accounts/AccountDetail.tsx`
("Sampled balances" CardHeader `action` → "Network supply →" `/supply`); cross-link href assertions added
to `CoreSlotDetail.test.tsx` + `OperatorView.test.tsx` + `AccountDetail.test.tsx`.

## 3. `/supply` page

`SupplyView` = `useSupply()` + `useStatus()` → a single `QueryBoundary` → a plain `Table` of denom→amount
(via `RewardAmount`/`formatAmount`, raw base-denom preserved in `title`) + the `source:"sampled"` caveat
(echoed from `res.data.source`) + `SampledAtNote` freshness (`deriveSampleAge` over the indexer's
`lastIndexedHeight`). **Renders ONLY the sampled sample** — no circulating/bonded/total-vs-available,
cap/halving/emission-schedule, tokenomics, or frontend emission math. The no-sample case is the contract's
**404** → `ErrorState`/NotFound (the API types `sampledAtHeight` non-nullable + 404s when absent), never a
fabricated 0.

## 4. Cross-links

- **Claim history** (`CoreSlotRewardsSection`): `action={<Link href={`/rewards/claims?slotId=${encodeURIComponent(slotId)}`}>View claim history →</Link>}` — a query param, defined once, and (because `CoreSlotDetail` is reused by the operator page) it rides along on **both** `/coreslots/[id]` and `/operator/[address]` with no duplication.
- **Operator → `/rewards`**: on `OperatorView`'s always-rendered identity card (NOT `OperatorProfile`, which returns null without metadata).
- **Account → `/supply`** (the only contract-safe account cross-link): both are sampled observations. **No** account → `/rewards/claims?claimant=<address>` link — an account is not provably a claimant, so that would invent a relation the contract does not expose (documented in code + test-guarded).
- **`/rewards/claims` route**: reads `searchParams`, coerces `string | string[] | undefined` → a single string, passes `{ slotId, claimant }` to `ClaimsSection`'s filter (no second Card wrap). First `searchParams` consumer in the repo (forces dynamic rendering — fine).

## 5. Invariants honored

String-safe (`formatAmount` BigInt-only, raw preserved, no `Number()` on amounts/heights); freshness via
BigInt `deriveSampleAge` with nullable-guarded `indexer.lastIndexedHeight`; `error.code` branching via
`ErrorState`/`QueryBoundary`; honest link labels via the CardHeader `action` slot (not the generic
"View all →"); boundary + theme guards pass; no API contract change (both `openapi:check` green).

## 6. Validation (all green)

root `typecheck` · `lint` · `apps/web test` **113** (+6) · `apps/api test` **114** (unchanged) · web
`build` ✓ (`/supply` static; `/rewards/claims` dynamic) · `openapi:check` api + web up to date.

## 7. Adversarial review (3 lenses, PASS)

`/supply` faithfulness, cross-link correctness/contract-safety, and boundary/scope/test-quality — each
re-ran the suite. **All 3 PASS** (0 blocker/major). Folded in: (a) the no-sample handling modeled a
contract-forbidden 200-with-null shape → realigned to the real **404 → NotFound** path and dropped the
dead empty-supply branch; (b) added a **multi-denom** supply render test; (c) added the **account →
`/supply` href guard** (the one cross-link without coverage) + an assertion that **no `?claimant=`
relation** is invented.

## 8. Known limitations / accepted nits

- `SupplyView` reuses `RewardAmount` (a `rewards/`-namespaced but denom-generic component). Functionally
  correct + string-safe; promoting it to a neutral `CoinAmount` primitive is a tidy follow-up, deferred to
  avoid churning 12b-introduced files in this PR.
- `/supply?height=` historical lookup remains deferred (per §17.3) unless separately approved.

## 9. Final recommendation

Ready for review/merge. Phase 12c is read-only, contract-faithful, makes no API change, and reuses proven
primitives + the 12b claims filter. **Phase 12 (rewards/supply economic surfaces) is complete** across
12a (plan/audit) + 12b (rewards hub) + 12c (supply + cross-links).
