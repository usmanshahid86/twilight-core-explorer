# Phase 12 — Rewards, Supply, and Economic Surfaces — Plan

**Status: READY — decisions locked.** Date: 2026-06-27 (caveat audit + claiming decision locked
2026-06-28, §17). Planning only (no code). Depends on **Phase 7.2 (merged, live-validated)** + Phase 9d
(rewards/supply/balances API) + Phase 10/11 web. Contract-grounded against `docs/reference/openapi.json` +
the generated schema. The post-7.2 caveat audit (§17) is the only contract change Phase 12 introduces.

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
  `productionClaimReadiness:"read_only_no_claim_action"` + `claimSemantics` (claims, per-slot rewards) —
  the readiness literal flips from the historical `gated_by_phase_7_2` as the one 12b contract change
  (§17/§18); `source:"sampled"` + `sampledAtHeight` (balances, supply, account balances).
- **What is unsupported and must be omitted?** circulating / bonded / total-vs-available supply breakdown
  (only a flat sampled denom→amount exists); **cap / halving / emission-schedule / tokenomics** fields
  (NOT exposed anywhere); per-account reward totals; any live/claimable amount; claim/treasury actions;
  emission math computed in the frontend.

## 3. Endpoint inventory

| Endpoint | Params | Codes | Pagination | Semantics |
|---|---|---|---|---|
| `/rewards/epochs` | limit, cursor | 200,400 | keyset | `aggregate_projection` |
| `/rewards/epochs/{epoch}` | include | 200,400,404 | — | `aggregate_projection` (+raw) |
| `/rewards/claims` | limit, cursor, slotId, claimant, txHash, fromHeight, toHeight | 200,400 | keyset | `event_history_only` + read-only (§17) |
| `/rewards/balances` | limit, cursor, sampleKind, denom, height | 200,400 | keyset | `source:"sampled"` |
| `/rewards/params` | limit, cursor, changeType | 200,400 | keyset | authority change history |
| `/rewards/treasury-payments` | limit, cursor | 200,400 | keyset | payment history |
| `/supply` | height, denom | 200,400,404 | — | `source:"sampled"` |
| `/coreslots/{slotId}/rewards` | limit, cursor | 200,400,404 | keyset | read-only (11a; readiness literal updates in 12b) |
| `/accounts/{address}/balances` | — | 200 | — | sampled (10b) |

## 4. Read-only boundary + claiming (locked posture)

The explorer never claims, signs, connects a wallet, or mutates. For "how do I claim?", add a small
**Claiming info card** — strictly **non-actionable**. It may document the canonical CLI command, but the
card MUST NOT contain: a claim button, a *disabled* claim button, a wallet prompt, a dApp/web link, or any
"claim now" language. Post-7.2 the caveat is the durable read-only posture
(`read_only_no_claim_action`), not a phase gate (§17/§18).

**Locked card copy (use verbatim):**
> Claiming is not available from this explorer. This page displays observed rewards and historical claim
> events only. Operators claim externally using the Twilight CLI.

It may additionally show the canonical command as **documentation only** (monospace, copyable, not a
control): `twilightd rewards claim <slotId> <startEpoch> <endEpoch> --from <operator>`.

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
- **Epochs** — render the full first-class epoch contract: **epochNumber**(link to detail), **height**,
  **blockTime** (where exposed), **totalReward**, **denom**, **activeSlotCount**, **cumulativeEmitted**,
  **distributionMethod** (the last two are first-class post-7.2 — §18), with a section banner
  **`rewardSemantics: aggregate_projection`** ("aggregate context, not claim truth"). Do **NOT** render
  `rewardPool`/`carryOut` (raw-only, not first-class — §18).
- **Claims (history)** — id/slotId(link)/claimant/amount/startEpoch→endEpoch/height/txHash(link), with a
  **read-only caveat banner** (`read_only_no_claim_action`, `event_history_only`). Filters (slotId/
  claimant) power the cross-links; a filter *UI* is optional/deferred.
- **Rewards balances (sampled)** — sampleKind/moduleName/address/denom/amount + `source:"sampled"` +
  height; banner notes these are observed samples (excludes `supply` kind by default, per 9d).
- **Treasury payments** — recipient/denom/amount/purpose/height.
- **Params changes** — changeType/authority/height/txHash + `params` via `JsonView` (open-ended).
- **`/rewards/epochs/[epoch]`** — epoch detail DataList rendering **all contract-exposed epoch fields**
  (incl. `cumulativeEmitted`/`distributionMethod`) + **lazy `include=raw`** (`RawSection`) **only where
  `include=raw` is contract-supported** (it is, on `/rewards/epochs/{epoch}`).

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
(`aggregate_projection`, `read_only_no_claim_action`, `event_history_only`,
`projection_observed_not_live_claimable`, `source:"sampled"`); `sampled`/`sampledAtHeight` shown; no
fabricated zero, no invented economics. **Render only first-class contract fields** — `rewardPool`/
`carryOut` stay raw-only (not displayed as columns); no frontend emission math.

## 11. Unsupported / intentionally omitted

- Supply: circulating / bonded / total-vs-available breakdown (not exposed — only flat sampled denom→
  amount).
- **Tokenomics / cap / halving / emission schedule / projections** — not in the contract → **omitted**
  (a prior roadmap "tokenomics/halving view" is dropped unless the API later exposes it).
- Per-account reward totals (only claim-event history + sampled balances).
- Live/claimable amounts; claim/treasury/governance actions; wallet; charts.

## 12. Testing plan

Each rewards section renders + its caveat banner is **visible** (`aggregate_projection` /
`read_only_no_claim_action` / `event_history_only` / `source:"sampled"`); **epoch rows render
`cumulativeEmitted` + `distributionMethod`** and do **not** render `rewardPool`/`carryOut`; epoch detail
success + invalid + not_found + lazy raw; claims filters (slotId) power the cross-link; balances sampled
rendering; supply sampled (denom→amount + sampledAtHeight) with **no invented circulating/total labels**;
cross-link from CoreSlot/operator rewards → `/rewards/claims?slotId=`; `utwlt→TWLT` preserves raw; no
`Number()`; boundary + theme guards; `openapi:check`. **Caveat-readiness test:** the rendered readiness
literal is `read_only_no_claim_action` (the updated `CoreSlotDetail.test.tsx` + `apps/api` rewards tests
assert the new value, not `gated_by_phase_7_2`). **Claiming-card test:** the card is **non-actionable** —
asserts the locked copy is present and that there is **no button / disabled button / link / wallet prompt
/ "claim now"** in it. Vitest + RTL + jsdom.

## 13. Implementation split (recommended)

- **12a — this plan** (contract audit + post-7.2 contract-delta audit). ✅

**12b — `/rewards` hub (final scope).** Includes:
- `/rewards` (epochs + epoch detail + claims + balances + treasury + params sections)
- `/rewards/epochs/[epoch]`
- the **one API constant change**: `PRODUCTION_CLAIM_READINESS → read_only_no_claim_action` (§17/§18)
- OpenAPI regeneration (`apps/api openapi:generate`) + generated web schema update (`apps/web openapi:gen`)
- `RewardCaveat` banner component
- the non-actionable **Claiming info card** (§4)
- update the existing **CoreSlot rewards caveat display + tests** to the new readiness value
- render `cumulativeEmitted` + `distributionMethod` on epochs

12b **excludes:** `/supply`; supply cross-links; historical supply lookup; filter UI; claim actions;
wallet integration; tokenomics / cap / halving UI; charts; frontend emission math.

**12c — `/supply` + cross-links (final scope).** Includes:
- `/supply` (sampled total supply page)
- CoreSlot/operator rewards → `/rewards/claims?slotId=…` cross-links
- sampled supply caveats (`source:"sampled"` + `sampledAtHeight`)

12c **excludes:** historical `/supply?height=` lookup (deferred unless separately approved).

Rationale: rewards is the largest, terminology-sensitive surface (do it focused, and it carries the sole
contract change); supply + cross-links are light and depend on the rewards routes existing.

## 14. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Overclaiming live/claimable rewards | Caveat banners verbatim from contract; read-only; no claim flow |
| Inventing supply economics (circulating/cap/halving) | Render only the sampled denom→amount; omit the rest; explicit note |
| `/rewards` hub bloat (6 endpoints) | Sections, each a keyset table; filter UIs deferred |
| Claiming-card overclaim | Non-actionable card only (no button/disabled button/link/wallet/"claim now"); CLI documented as text; locked copy (§4) |
| Stale `gated_by_phase_7_2` literal lingering in UI/tests | 12b flips the one constant + regenerates schemas + updates the CoreSlot caveat display/tests; `read_only_no_claim_action` asserted (§12) |

## 15. Final recommendation

Proceed to **12b** (§17/§18 locked). Phase 12 is read-only, contract-faithful, and reuses proven
primitives — the only genuinely new work is the rewards hub's section wiring + the caveat banner. The
discipline that matters most is **terminology**: every amount is labeled exactly as the contract labels
it (aggregate-projection / observed-sample / historical-event), and supply shows only what's sampled.

## 16. Open questions / decisions to lock

1. **Claiming link (§4): RESOLVED (2026-06-28).** Claiming is **CLI-only** (`twilightd rewards claim …`) —
   no canonical dApp/URL exists. The Claiming card is non-actionable, documents the CLI command as text,
   and has **no** web link (§4, §17).
2. **Filter UIs:** add claims/balances filter controls in 12b, or defer (cross-links use query params
   directly)? **Recommendation:** defer the filter UI; ship the cross-link query params.
3. **`/supply?height=` control:** a historical-height lookup on `/supply`, or latest-only in 12c?
   **Recommendation:** latest-only first; height control optional later.

> **§16.1 RESOLVED (2026-06-28):** claiming is **CLI-only** (`twilightd rewards claim …`) — no canonical
> dApp/URL. The Claiming card documents the CLI command, no web link. See §17.

## 17. Caveat audit (post-7.2) — LOCKED (2026-06-28)

Phase 7.2 is merged + live-validated, so the `gated_by_phase_7_2` caveat was re-evaluated. Test applied to
each in-data caveat: does 7.2 change the truth it asserts (was it ever 7.2-gated), or is it the data's
nature (durable)?

| Caveat (literal) | On | Verdict |
|---|---|---|
| `rewardSemantics: aggregate_projection` | epochs | **KEEP** — aggregate network-emission context; never 7.2-gated |
| `claimSemantics: event_history_only` | claims | **KEEP** — claims are historical events |
| `claimSemantics: projection_observed_not_live_claimable` | per-slot rewards | **KEEP** — observed sample at `sampledAtHeight`; read-only |
| `productionClaimReadiness: gated_by_phase_7_2` | claims + per-slot rewards | **CHANGE** — the gate is lifted |

Only `gated_by_phase_7_2` was ever tied to 7.2. 7.2 validated the claim pipeline end-to-end (real
`MsgClaimRewards`, finalized epochs, reconciled claimed-state with `claimedAtHeight`/`claimTxHash`), so the
gate is satisfied. The durable replacement is the **read-only posture** (the explorer performs no claim
action; claiming is CLI-only). The other three caveats describe the data's nature, which 7.2 validated but
did **not** change — they stay verbatim (notably `projection_observed_not_live_claimable` still holds: the
claimed-state is an observed sample you cannot claim against from the explorer).

**LOCKED:**
- `productionClaimReadiness: gated_by_phase_7_2` → **`read_only_no_claim_action`** (on both
  `SlotRewardItem` + `ClaimItem`). The other three caveats remain unchanged.
- **Claiming = CLI-only.** The Claiming info card documents the canonical command
  `twilightd rewards claim <slotId> <startEpoch> <endEpoch> --from <operator>` — **no** dApp/web link, no
  embedded flow.

**Contract-change spec (NOT yet implemented — for 12b):** this is the *only* contract change Phase 12
introduces; everything else is read-only display of the existing 9d/7.2 contract.
1. `apps/api/src/dto/rewards.ts`: set `PRODUCTION_CLAIM_READINESS = 'read_only_no_claim_action'` (constant
   value only; the field stays on `SlotRewardItem` + `ClaimItem`).
2. Regenerate: `apps/api` `openapi:generate` + `apps/web` `openapi:gen`; both `openapi:check` green.
3. Web: update the caveat display (`CoreSlotRewardsSection` + the 12b `/rewards` hub banners) to render the
   new value, and add the **CLI Claiming card** (documents the `twilightd` command).
4. Update tests asserting the old literal (`apps/web` `CoreSlotDetail.test.tsx`; `apps/api` rewards tests).

## 18. Post-7.2 contract-delta audit (2026-06-28)

Narrow contract-delta check after Phase 7.2 merged — verified against `docs/reference/openapi.json`,
`apps/api/src/dto/rewards.ts`, and `apps/web/src/lib/api/generated/schema.d.ts`. **Status: READY.**

**Fields verified (epoch contract):**
| Field | First-class on epochs? | Evidence |
|---|---|---|
| `cumulativeEmitted` | **yes** (new, post-7.2) | in `RewardEpochListItem` + `RewardEpochDetail`; 4 refs in `openapi.json` |
| `distributionMethod` | **yes** (new, post-7.2) | same |
| `rewardPool` | **no** (raw-only) | 0 refs in `openapi.json` |
| `carryOut` | **no** (raw-only) | 0 refs in `openapi.json` |

**Caveat values — after 7.2:**
| Caveat | Value now in contract | Decision |
|---|---|---|
| `rewardSemantics` | `aggregate_projection` | unchanged |
| `claimSemantics` (claims) | `event_history_only` | unchanged |
| `claimSemantics` (per-slot) | `projection_observed_not_live_claimable` | unchanged |
| `productionClaimReadiness` | **still `gated_by_phase_7_2`** in the live contract | **→ `read_only_no_claim_action`** (the one 12b change) |
| balances / supply | `source:"sampled"` + `sampledAtHeight` | unchanged |

**What changed:** epochs gained `cumulativeEmitted` + `distributionMethod` as first-class fields (already
shipped in 7.2 — contract + generated schemas in sync, both `openapi:check` green). The **decision** to
flip `productionClaimReadiness` to `read_only_no_claim_action` is locked but **not yet in the contract** —
the live DTO/OpenAPI/web-schema still carry `gated_by_phase_7_2`; the flip is a 12b code step.

**What intentionally did NOT change:** `rewardPool`/`carryOut` stay raw-only (deferred until a fixture
exercises `carry_out ≠ 0`); the three data-nature caveats (`aggregate_projection`, `event_history_only`,
`projection_observed_not_live_claimable`) stay verbatim; balances/supply stay `source:"sampled"`. No
schema staleness found — no separate regeneration step is needed before 12b.

**Implementation implications — 12b:** render `cumulativeEmitted`/`distributionMethod` on epochs (not
`rewardPool`/`carryOut`); make the single constant change `PRODUCTION_CLAIM_READINESS →
read_only_no_claim_action` + regenerate OpenAPI/web schema; update the CoreSlot rewards caveat display +
the two test files asserting the old literal; ship the non-actionable Claiming card.

**Implementation implications — 12c:** none from this delta — 12c is `/supply` + cross-links over the
already-sampled contract; no contract change. (Historical `/supply?height=` remains deferred.)
