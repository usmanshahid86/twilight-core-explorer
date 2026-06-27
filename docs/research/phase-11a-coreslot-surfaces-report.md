# Phase 11a — CoreSlot Surfaces — Implementation Report

**Status: PASS** (implemented, typechecked, linted, tested, built). Date: 2026-06-27.
Branch: `feat/11a-coreslot-surfaces` (off merged `main`). Plan:
`docs/research/phase-11-twilight-surfaces-plan.md`. **Not merged.**

## 1. Status: PASS

## 2. Executive summary

CoreSlot list (`/coreslots`) and detail (`/coreslots/[slotId]`), with the detail composed of **reusable,
`slotId`-parameterized section components** (Health, Liveness, ProposedBlocks, AuthorityHistory,
Rewards-caveated, Raw) so Phase 11c's Operator page can reuse them after resolving operator→slotId. No
new client capability was needed — `apiGetPath` (10b) covers every `/coreslots/{slotId}/*` path. Scope
held strictly to 11a (no liveness/network/operator pages, no search changes, no filters, no charts).

## 3. Files changed

**Modified:** `lib/api/queries.ts` (+10 CoreSlot hooks + response types), `app/coreslots/page.tsx`
(placeholder → real list).
**New routes:** `app/coreslots/[slotId]/page.tsx`.
**New components:** `coreslots/CoreSlotsList.tsx`, `coreslots/CoreSlotDetail.tsx`, and
`coreslots/sections/{CoreSlotHealthSection, CoreSlotLivenessSection, CoreSlotProposedBlocksSection,
CoreSlotAuthorityHistorySection, CoreSlotRewardsSection, CoreSlotRawSection}.tsx`.
**New tests:** `coreslots/CoreSlotsList.test.tsx`, `coreslots/CoreSlotDetail.test.tsx`.

## 4. Endpoints used

`GET /coreslots`, `/coreslots/{slotId}`, `/coreslots/{slotId}/events`, `/windows`, `/key-rotations`,
`/liveness`, `/health`, `/proposed-blocks`, `/rewards`. (Reads via existing `apiGet`/`apiGetPath`.)

## 5. Fields rendered (contract-exposed only; typecheck-enforced)

- **List:** slotId(link), status, operatorAddress, consensusPower, rewardWeight, createdHeight,
  removedHeight.
- **Detail identity:** slotId, status, operator/payout/consensus addresses, consensusPower, rewardWeight,
  created/updated/removed heights, consensusPubkey (`JsonView`), metadata (`JsonView`); embedded `health`
  summary (healthStatus, isActiveAtLatest, uptimeBps, summaryStatus).
- **Health:** healthStatus, healthReason, isActiveAtLatest, uptime/lifetime/recent500/recent1000 bps,
  signed/expected/missed (+absent/nil), signed/missed streaks, primaryWindowKind, lastCommittedHeight,
  policyVersion.
- **Liveness (array):** windowKind, windowSize, uptimeBps, signed/expected, missed, streaks, summaryStatus.
- **Proposed blocks:** height(link), time, attributionStatus.
- **Authority — events:** kind, height, txHash(link), detail (`JsonView`). **key-rotations:** status,
  old→new consensus, requested/applied heights, txHash(link). **windows:** status, effectiveFrom→To,
  opened/closedByKind, consensusPower.
- **Rewards (caveated):** epochNumber, amount(→TWLT), claimed+claimedAtHeight (observed), sampledAtHeight,
  with `productionClaimReadiness` + `claimSemantics` shown verbatim in a banner.

## 6. Fields intentionally omitted

- Health: `firstCommittedHeight`, `latestMissedHeight`, `invalidHeightCount` (kept the summary compact;
  available if needed later).
- Liveness: `evidenceHeightCount`, `spanHeightCount`, `latestMissedHeight`, `invalidHeightCount`,
  per-window operator/consensus addresses (redundant with the slot identity).
- Key-rotations: `reason`, `effectiveHeight`, `cancelledHeight`, `cancelledTxHash` (shown the primary
  request/applied lifecycle; the rest can be added in a detail expander later).
- Rewards: `claimTxHash`, `denom` shown only via the formatted amount.
- All omissions are presentational trims of *exposed* fields — **no field was invented or derived.**

## 7. Unsupported relations/features not implemented

- **No CoreSlot → transaction list** (no such endpoint). Event/rotation `txHash` values link to
  `/txs/{hash}` individually instead.
- **No list filters** (`/coreslots` supports status/operator/consensus/payout; deferred — out of 11a).
- **No liveness/network/operator pages, no search routing changes** (Phase 11b/11c).

## 8. Pagination model per endpoint

Keyset `useInfiniteQuery` + `PaginatedTable` (opaque cursors, `nextCursor:null` stops): `/coreslots`,
`/events`, `/windows`, `/key-rotations`, `/proposed-blocks`, `/rewards`. **Single `useQuery`** (non-
paginated): `/liveness` (plain array) and `/health` (single object).

## 9. Error-code handling

Detail gates on `/coreslots/{slotId}`: non-numeric slotId → client-side `InvalidInput` (string-safe
`^\d+$`, neutral "numeric slot id" message — no message/regex mismatch); API `invalid_slot_id`(400) /
`not_found`(404) branch via the shared `ErrorState`. Section queries surface their own loading/error via
`QueryBoundary`/`PaginatedTable`. `network_unavailable` → API-down state.

## 10. Reusable section architecture

Every detail section is a standalone `'use client'` component taking `slotId: string` and owning its own
query — **not baked into the detail page**. `CoreSlotDetail` composes them; Phase 11c's Operator page
will compose the same components after resolving operator address → slotId via `/coreslots?operatorAddress=`.

## 11. Rewards caveat handling

The rewards subsection renders a banner sourced from the contract fields on the rows
(`claimSemantics:"projection_observed_not_live_claimable"`, `productionClaimReadiness:"gated_by_phase_7_2"`)
and labels claimed rows "observed @ height" — **never implying live claimability**. No claims UX. Full
rewards economics remains Phase 12.

## 12. Raw include handling

`CoreSlotRawSection` wraps the shared `RawSection`; `useCoreSlotRaw(slotId, enabled)` is disabled until
the panel is expanded, so the `include=raw` request fires **only on expand** (verified by test).

## 13. Tests added

`CoreSlotsList` (rows + slot link + status); `CoreSlotDetail` success (identity + health 90.00% lifetime
+ authority `lifecycle` event + proposed block + **rewards caveat strings visible**), non-numeric slotId
→ InvalidInput (no API call), `not_found` → NotFound, and **lazy raw** (no `include=raw` until expand).
Liveness array renders as a non-paginated table (no Load-more) within the success test.

## 14. Validation commands and results (all green)

- `npm run typecheck` (root) — exit 0
- `npm --prefix apps/web run build` — ✓ (`/coreslots` static, `/coreslots/[slotId]` dynamic-on-demand)
- `npm test` (root) — exit 0: `apps/api` 114, `apps/web` **67** (19 files)
- `npm --prefix apps/web run openapi:check` — up to date (no API change)
- `npm --prefix apps/web run lint` — clean
- `git diff --check` — clean; no `.next`/`dist` tracked

## 15. Known issues / follow-ups for 11b / 11c

- **11c (Operator):** reuse the `coreslots/sections/*` components; resolve address → slotId via
  `/coreslots?operatorAddress=` (then consensus/payout fallback), handling cardinality 0/1/N.
- **11b (Liveness/Network):** `/liveness` page can reuse `useCoreSlotHealth` for the bounded per-slot
  fan-out; `/network` reuses `useValidatorSet(height)` + `useProposers`.
- Authority `events.detail` renders as `JsonView` inside a table cell — adequate but could move to an
  expander if details get large.
- Several exposed-but-omitted fields (§6) can be surfaced in expanders if operators want them.

## 16. Final recommendation

**Ready for Codex review.** Scope held to 11a; sections are reusable for 11c; all locked invariants
honored (string-safe ids/heights/amounts, opaque cursors, `error.code` branching, contract-only fields,
visible rewards caveat, lazy raw, `/liveness` + `/health` correctly non-paginated). Do not merge yet.

**Phase 11a CoreSlot Surfaces: COMPLETE — ready for Codex review.**
