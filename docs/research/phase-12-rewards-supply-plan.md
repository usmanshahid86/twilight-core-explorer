# Phase 12 — Rewards, Supply, and Economic Surfaces — Plan

**Status: READY** (read-only core fully specified; two decisions to lock — §17). Date: 2026-06-27.
Planning only (no code). Depends on Phase 9d (rewards/supply/balances API) + Phase 10/11 web.
Contract-grounded against `docs/reference/openapi.json` + the generated schema.

## 1. Framing (the posture)

**Make economic state understandable without implying live financial action.** Phase 12 is **read-only
projection display**. It surfaces the existing 9d rewards/supply/balance data, preserving the contract's
own caveat language verbatim. **No claim actions, no wallet, no mutations, no invented economics.**

## 2. Contract audit — answers to the key questions

- **What rewards endpoints exist?** Six: `/rewards/epochs`, `/rewards/epochs/{epoch}`, `/rewards/claims`,
  `/rewards/balances`, `/rewards/params`, `/rewards/treasury-payments` — plus the per-slot
  `/coreslots/{slotId}/rewards` (already shown, caveated, in 11a).
- **What supply endpoints exist?** One: `/supply` (sampled total by denom; `?height=`/`?denom=`).
- **Are rewards global / per-account / per-CoreSlot / per-epoch / sampled?** Mixed: epochs are
  **per-epoch aggregate** (network emission); claims are **per-claim-event** (carry `slotId`/`claimant`);
  balances are **sampled** module/reward balances (per `address`/`moduleName`); per-slot rewards are
  **per-CoreSlot × epoch**; treasury are **per-payment**. There is **no per-account reward total** — only
  claim-event history (filterable by `claimant`) + sampled balances.
- **Are amounts live / projected / observed / claimed / claimable / historical?** **None are live or
  claimable.** Epochs = `aggregate_projection`; claims = `event_history_only` (historical events);
  per-slot rewards = `projection_observed_not_live_claimable` (the `claimed` flag is observed, not live);
  balances + supply = `source:"sampled"` observations. So every amount is aggregate-projection,
  observed-sample, or historical-event — **never live, never claimable**.
- **What caveats must be shown?** `rewardSemantics:"aggregate_projection"` (epochs);
  `productionClaimReadiness:"gated_by_phase_7_2"` + `claimSemantics` (claims, per-slot rewards);
  `source:"sampled"` + `sampledAtHeight` (balances, supply, account balances).
- **What is unsupported and must be omitted?** circulating / bonded / total-vs-available supply breakdown
  (only a flat sampled denom→amount exists); **cap / halving / emission-schedule / tokenomics** fields
  (NOT exposed anywhere); per-account reward totals; any live/claimable amount; claim/treasury actions;
  emission math computed in the frontend.

## 3. Endpoint inventory

| Endpoint | Params | Codes | Pagination | Semantics |
|---|---|---|---|---|
| `/rewards/epochs` | limit, cursor | 200,400 | keyset | `aggregate_projection` |
| `/rewards/epochs/{epoch}` | include | 200,400,404 | — | `aggregate_projection` (+raw) |
| `/rewards/claims` | limit, cursor, slotId, claimant, txHash, fromHeight, toHeight | 200,400 | keyset | `event_history_only` + gated |
| `/rewards/balances` | limit, cursor, sampleKind, denom, height | 200,400 | keyset | `source:"sampled"` |
| `/rewards/params` | limit, cursor, changeType | 200,400 | keyset | authority change history |
| `/rewards/treasury-payments` | limit, cursor | 200,400 | keyset | payment history |
| `/supply` | height, denom | 200,400,404 | — | `source:"sampled"` |
| `/coreslots/{slotId}/rewards` | limit, cursor | 200,400,404 | keyset | gated (11a) |
| `/accounts/{address}/balances` | — | 200 | — | sampled (10b) |

## 4. Read-only boundary + claiming (locked posture)

The explorer never claims, signs, connects a wallet, or mutates. For "how do I claim?", add a small,
clearly-**external** **Claiming info card** that states the honest status (observed projection; **not
live-claimable until Phase 7.2**) and links to a canonical external claim tool **only if one exists**
(decision §17.1). No embedded claim flow. This keeps the explorer honest about the
`gated_by_phase_7_2` status rather than overclaiming.

## 5. Route / page plan

| Route | Source | Notes |
|---|---|---|
| `/rewards` | epochs + claims + balances + treasury + params | hub with sections (replaces placeholder) |
| `/rewards/epochs/[epoch]` | `/rewards/epochs/{epoch}` | epoch detail (+ lazy `include=raw`) |
| `/supply` | `/supply` | sampled supply (replaces placeholder) |
| cross-links | operator/CoreSlot rewards → `/rewards/claims?slotId=`; account balances (10b) | no new routes |

## 6. `/rewards` plan (the bulk — 12b)

A read-only hub. Each section is a keyset `PaginatedTable` (reuse 10b/11a primitives), every reward
amount via the BigInt `formatAmount` (utwlt→TWLT, raw preserved):
- **Epochs** — epochNumber(link to detail), height, blockTime, totalReward, activeSlotCount, with a
  section banner **`rewardSemantics: aggregate_projection`** ("aggregate context, not claim truth").
- **Claims (history)** — id/slotId(link)/claimant/amount/startEpoch→endEpoch/height/txHash(link), with a
  **gated caveat banner** (`gated_by_phase_7_2`, `event_history_only`). Filters (slotId/claimant) power
  the cross-links; a filter *UI* is optional/deferred.
- **Rewards balances (sampled)** — sampleKind/moduleName/address/denom/amount + `source:"sampled"` +
  height; banner notes these are observed samples (excludes `supply` kind by default, per 9d).
- **Treasury payments** — recipient/denom/amount/purpose/height.
- **Params changes** — changeType/authority/height/txHash + `params` via `JsonView` (open-ended).
- **`/rewards/epochs/[epoch]`** — epoch detail DataList + lazy `include=raw` (`RawSection`).

## 7. `/supply` plan (12c)

Sampled total supply: a table of denom→amount (`formatAmount`), with **`sampledAtHeight` + `source`
freshness** (reuse the `SampledAtNote`/freshness model). `?height=` historical lookup is a possible
control (deferred). **Explicitly render ONLY the denom→amount sample** — no circulating/bonded/total
labels, no cap/halving/emission (not exposed). A short note frames it as "observed total supply at a
sampled height," not a computed economic breakdown.

## 8. Cross-links (operator as the hub — 12c)

- The 11a per-slot **rewards subsection** (CoreSlot detail + operator page) gets a "view claim history"
  link → `/rewards/claims?slotId={slotId}` (the claims `slotId` filter is contract-supported).
- The operator page stays the hub; we **add a link to `/rewards`**, we do **not** turn it into a full
  rewards dashboard.
- Account balances already render on `/accounts/[address]` (10b) — optionally cross-link account ↔
  supply/rewards-balances where contract-safe; no new account-reward endpoint exists.

## 9. Shared components / hooks

Reuse `PaginatedTable`, `DataList`, `JsonView`, `RawSection`, `Badge`, `MonoCopy`, `SampledAtNote`,
formatters (`amount`/`height`/`time`). **New hooks** (all via existing `apiGet`/`apiGetPath`):
`useRewardsEpochs`/`useRewardEpoch`/`useRewardEpochRaw`, `useRewardsClaims`, `useRewardsBalances`,
`useRewardsParams`, `useRewardsTreasury`, `useSupply` (a detail variant of the Overview's). A small
reusable **`RewardCaveat` banner** component (sources caveat text from the contract fields). No new
client capability needed.

## 10. Data correctness invariants

Amounts/heights/epoch/ids/cursors stay **strings — no `Number()`**; `utwlt→TWLT` via BigInt, raw
preserved; opaque cursors; `error.code` branching; only contract-exposed fields; **caveats verbatim**
(`aggregate_projection`, `gated_by_phase_7_2`, `event_history_only`,
`projection_observed_not_live_claimable`, `source:"sampled"`); `sampled`/`sampledAtHeight` shown; no
fabricated zero, no invented economics.

## 11. Unsupported / intentionally omitted

- Supply: circulating / bonded / total-vs-available breakdown (not exposed — only flat sampled denom→
  amount).
- **Tokenomics / cap / halving / emission schedule / projections** — not in the contract → **omitted**
  (a prior roadmap "tokenomics/halving view" is dropped unless the API later exposes it).
- Per-account reward totals (only claim-event history + sampled balances).
- Live/claimable amounts; claim/treasury/governance actions; wallet; charts.

## 12. Testing plan

Each rewards section renders + its caveat banner is **visible** (aggregate_projection / gated /
event_history_only / sampled); epoch detail success + invalid + not_found + lazy raw; claims filters
(slotId) power the cross-link; balances sampled rendering; supply sampled (denom→amount + sampledAtHeight)
with **no invented circulating/total labels**; cross-link from CoreSlot/operator rewards →
`/rewards/claims?slotId=`; `utwlt→TWLT` preserves raw; no `Number()`; boundary + theme guards;
`openapi:check`. Vitest + RTL + jsdom.

## 13. Implementation split (recommended)

- **12a — this plan** (contract audit + plan). ✅
- **12b — `/rewards`** (hub: epochs + epoch detail + claims + balances + treasury + params; the bulk).
- **12c — `/supply` + cross-links** (sampled supply page; CoreSlot/operator → `/rewards/claims?slotId=`;
  the Claiming info card per §17.1).

Rationale: rewards is the largest, terminology-sensitive surface (do it focused); supply + cross-links
are light and depend on the rewards routes existing.

## 14. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Overclaiming live/claimable rewards | Caveat banners verbatim from contract; read-only; no claim flow |
| Inventing supply economics (circulating/cap/halving) | Render only the sampled denom→amount; omit the rest; explicit note |
| `/rewards` hub bloat (6 endpoints) | Sections, each a keyset table; filter UIs deferred |
| Claim-link overclaim | External, gated info card only; link only if a canonical tool exists (§17.1) |

## 15. Final recommendation

Proceed to **12b** after locking §17. Phase 12 is read-only, contract-faithful, and reuses proven
primitives — the only genuinely new work is the rewards hub's section wiring + the caveat banner. The
discipline that matters most is **terminology**: every amount is labeled exactly as the contract labels
it (aggregate-projection / observed-sample / historical-event), and supply shows only what's sampled.

## 16. Open questions / decisions to lock

1. **Claiming link (§4):** is there a canonical external claim tool/CLI/dApp URL to link to? If yes, the
   Claiming card links to it (gated, external, labeled). If no, the card shows the gated-status text only
   until Phase 7.2. **Recommendation:** info card only; link iff a canonical tool exists. *(Needs your
   input.)*
2. **Filter UIs:** add claims/balances filter controls in 12b, or defer (cross-links use query params
   directly)? **Recommendation:** defer the filter UI; ship the cross-link query params.
3. **`/supply?height=` control:** a historical-height lookup on `/supply`, or latest-only in 12c?
   **Recommendation:** latest-only first; height control optional later.
