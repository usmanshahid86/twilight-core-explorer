# Phase 12b — Rewards Hub — Implementation Report

**Status: PASS** (implemented, typechecked, linted, tested, built; 6-lens adversarial review PASS).
Date: 2026-06-28. Plan: `phase-12-rewards-supply-plan.md` (§17/§18 locked). Read-only display of the
existing 9d/7.2 contract; **one** contract change (the caveat literal flip). Not committed/merged.

## 1. Executive summary

Built the read-only `/rewards` hub + `/rewards/epochs/[epoch]` detail, and made the single locked
contract change (`productionClaimReadiness: gated_by_phase_7_2 → read_only_no_claim_action`). The hub
surfaces epochs (incl. the post-7.2 `cumulativeEmitted`/`distributionMethod`), claim history, sampled
module/reward balances, treasury payments, and params changes — each a keyset `PaginatedTable` with a
contract-sourced caveat — plus a strictly **non-actionable** Claiming card. No `/supply`, no claim
actions, no wallet, no filter UI, no charts, no tokenomics, no frontend emission math (all 12c / out of
scope).

## 2. Contract change (the only one)

`apps/api/src/dto/rewards.ts`: `PRODUCTION_CLAIM_READINESS = 'read_only_no_claim_action'` (one constant,
feeds `SlotRewardItem` + `ClaimItem`). Regenerated `docs/reference/openapi.json` (api `openapi:generate`)
+ `apps/web/.../generated/schema.d.ts` (web `openapi:gen`). The web caveat banners render the contract
value verbatim, so the rename propagated through the typed client with **no component logic change** —
only test fixtures/assertions updated (`apps/api/test/rewards.test.js`, `CoreSlotDetail.test.tsx`).

## 3. Files

**New (`apps/web/src/components/rewards/`):** `RewardCaveat.tsx` (shared banner), `ClaimingCard.tsx`
(non-actionable), `RewardAmount.tsx` (BigInt amount + raw-in-title), `RewardsView.tsx` (hub),
`RewardEpochDetail.tsx` (+ lazy raw), `sections/{Epochs,Claims,Balances,Treasury,Params}Section.tsx`,
tests `{RewardsView,RewardEpochDetail,ClaimingCard}.test.tsx`. **New route:**
`app/rewards/epochs/[epoch]/page.tsx`. **Modified:** `app/rewards/page.tsx` (placeholder → hub),
`lib/api/queries.ts` (7 rewards hooks + types), `coreslots/sections/CoreSlotRewardsSection.tsx`
(refactored to `RewardCaveat`), `dto/rewards.ts`, regenerated contract/schema, the two rename test files.

## 4. Hooks (queries.ts)

`useRewardsEpochs`, `useRewardEpoch`, `useRewardEpochRaw` (lazy include=raw), `useRewardsClaims(filter?)`
(optional slotId/claimant for future cross-links; no filter UI), `useRewardsBalances`, `useRewardsParams`,
`useRewardsTreasury` — all standard keyset `useInfiniteQuery` with opaque `nextPageParam`, matching the
established list/detail/raw conventions.

## 5. Invariants honored

String-safe (no `Number()` on amounts/heights/epoch/ids/cursors; `formatAmount` BigInt-only with raw
preserved in the title; `formatHeight` for heights; epoch ordinals rendered verbatim — not the height
grouper); opaque cursors; `error.code` branching via `ErrorState`; only contract-exposed fields
(`cumulativeEmitted`/`distributionMethod` rendered; `rewardPool`/`carryOut` never rendered); caveats
echoed verbatim from contract fields (never hardcoded/invented); boundary + theme guards pass.

## 6. Validation (all green)

root `typecheck` · `lint` · `apps/web test` **104** (29 files; +10 over 94, incl. boundary + theme guards)
· `apps/api test` **114** · web `build` (✓ `/rewards` static, `/rewards/epochs/[epoch]` dynamic) ·
`openapi:check` api + web both up to date.

## 7. Adversarial review (6 lenses, PASS)

A 6-reviewer workflow (contract-faithfulness, string-safety, non-actionable claiming, scope/boundary,
integration/a11y, test-quality) each verified independently + re-ran the suite. **All 6 PASS** (0
blocker, 0 major). Folded in: (a) **epoch formatter** — Claims rendered the epoch range with the
block-height thousands grouper (`1,234`) inconsistent with the bare epoch elsewhere → render verbatim;
(b) **test gaps** — added the balances `source:"sampled"` caveat assertion + empty-state and
error-state (`error.code`) section coverage. Remaining items are nits (e.g. data-gated caveats hidden on
empty lists — confirmed correct, since the caveat is a per-row contract field and the always-present
Claiming card still states the read-only posture).

## 8. Known limitations / 12c follow-ups

`/supply` page + sampled-supply caveats; CoreSlot/operator rewards → `/rewards/claims?slotId=` cross-links
(the claims hook already accepts the filter); optional claims/balances filter UI (deferred). No new
backend work — 12c is read-only display + cross-link wiring over the existing contract.

## 9. Final recommendation

Ready for review/merge. The only contract change is the locked caveat flip; the rest is read-only,
contract-faithful display reusing proven primitives, validated and 6-lens-reviewed.
