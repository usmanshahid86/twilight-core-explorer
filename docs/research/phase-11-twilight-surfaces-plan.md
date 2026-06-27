# Phase 11 — Twilight-Specific Surfaces + Operator Page — Implementation Plan

**Status: Plan (no code).** Date: 2026-06-27. **Branch (to create):** off merged `main`.
Depends on: Phase 9 API + Phase 10a/10b (`apps/web`, merged). Plan is contract-grounded against
`docs/reference/openapi.json` + the generated web schema.

## 1. Phase 11 Plan: **READY**

The four §20 design questions are **locked** (operatorAddress+fallbacks; search slot-link primary;
separate `/network` route+nav; bounded liveness fan-out).

**Implementation status (2026-06-27):**
- **11a — CoreSlot list + detail + reusable sections: ✅ DONE** (PASS; report
  `docs/research/phase-11a-coreslot-surfaces-report.md`; branch `feat/11a-coreslot-surfaces`).
  Delivered `/coreslots` + `/coreslots/[slotId]` with the six reusable `slotId`-parameterized sections;
  web tests 62→67; no new client capability needed.
- **11b — Liveness + Network pages: pending.**
- **11c — Operator page: pending** (composes 11a's sections via operator→slot resolution).

## 2. Executive summary

Phase 11 builds the Twilight-differentiating surfaces over the existing 9c/9d API: CoreSlot list +
detail (aggregating 8 sub-resources), a network liveness page, a network validator/proposer page, and
the first-class **Operator page**. The keystone client work is already done — `apiGetPath` (10b) handles
every `/coreslots/{slotId}/*` templated path, and `useValidatorSet(height)` (10a) already solves the
height trap. The one genuinely new and risky thing is **operator identity resolution**: there is **no
`/operator` endpoint**, so the Operator page resolves an address → CoreSlot(s) via
`/coreslots?operatorAddress=` (cardinality 0/1/N). CoreSlot detail sections are built as reusable,
`slotId`-parameterized components so the Operator page composes the same sections.

## 3. Contract audit findings

- **No `/operator*` path exists.** Operator = a query over `/coreslots` by `operatorAddress` (and
  optionally `consensusAddress`/`payoutAddress` — all three are supported filters).
- **`/coreslots` list filters:** `status, operatorAddress, consensusAddress, payoutAddress` (+ limit,
  cursor). This is the operator-resolution mechanism.
- **`/coreslots/{slotId}` detail already embeds a `health` summary** (healthStatus, isActiveAtLatest,
  uptimeBps, currentMissedStreak, summaryStatus) + `consensusPubkey`, `metadata`, `raw?`.
- **`/coreslots/{slotId}/liveness` returns an ARRAY (per `windowKind`) and is NOT paginated**
  (`windowKind` filter only). `/health` is a single object, no params.
- **`/coreslots/{slotId}/rewards`** carries `productionClaimReadiness:"gated_by_phase_7_2"` +
  `claimSemantics:"projection_observed_not_live_claimable"` — the contract-allowed caveated subsection.
- **No CoreSlot→tx-list relation;** events carry `txHash` (link individual events to `/txs/{hash}`),
  but there is no "all txs for a slot" filter — omit any slot-tx list.
- **`/network/validator-set` requires `height`** (trap); `/network/proposers` + `/network/liveness-risk`
  take no params. `/status` exposes `indexer.lastIndexedHeight` (the height source, already used).

## 4. Endpoint inventory (all GET; codes verified)

| Endpoint | Path/Query | Codes | Pagination |
|---|---|---|---|
| `/coreslots` | q: limit, cursor, status, operatorAddress, consensusAddress, payoutAddress | 200,400 | keyset |
| `/coreslots/{slotId}` | p: slotId · q: include | 200,400,404 | — |
| `/coreslots/{slotId}/events` | q: limit, cursor, kind | 200,400,404 | keyset |
| `/coreslots/{slotId}/windows` | q: limit, cursor | 200,400,404 | keyset |
| `/coreslots/{slotId}/key-rotations` | q: limit, cursor | 200,400,404 | keyset |
| `/coreslots/{slotId}/liveness` | q: windowKind | 200,400,404 | **none (array)** |
| `/coreslots/{slotId}/health` | — | 200,400,404 | — |
| `/coreslots/{slotId}/proposed-blocks` | q: limit, cursor | 200,400,404 | keyset |
| `/coreslots/{slotId}/rewards` | q: limit, cursor | 200,400,404 | keyset |
| `/network/validator-set` | q: **height (REQ)** | 200,400 | — (array) |
| `/network/proposers` | — | 200 | — (array) |
| `/network/liveness-risk` | — | 200,404 | — (object) |
| `/status` | — | 200 | — |
| `/search` | q: q (REQ) | 200,400 | — (array) |

## 5. Required params + pagination model

- **slotId** path param → `apiGetPath('/api/v1/coreslots/{slotId}', { slotId }, …)`. Validate
  client-side as a numeric string only (string-safe); rely on API `invalid_slot_id` (400) / `not_found`
  (404). **Message must match the regex** — say "numeric slot id" (avoid the height-0 trap: a
  "positive integer" message needs `^[1-9]\d*$`; a plain `^\d+$` needs neutral wording).
- **height** for `/network/validator-set`: derive from `/status` `indexer.lastIndexedHeight`
  (digit-validated, no `Number()`); reuse `useValidatorSet(height)` — disabled until height present;
  explicit unavailable state otherwise (already implemented in 10a).
- Keyset lists reuse 10b's `useInfiniteQuery` + `nextPageParam` + `PaginatedTable` (opaque cursors,
  `nextCursor:null` stops). `/liveness`, `/health`, network/* are single fetches (no pagination).

## 6. Error-code handling plan

Reuse `ErrorState` (branches on `error.code`): `invalid_slot_id`/`invalid_height`→`InvalidInput`;
`not_found`→`NotFound`; `network_unavailable`→API-down; else generic. CoreSlot detail gates the page on
the `/coreslots/{slotId}` query (404→NotFound). Operator page gates on the resolution query (0
results→"no CoreSlot for this address," distinct from an API error). `/network/liveness-risk` 404 →
treat as "no liveness snapshot yet" (empty/freshness state, not a hard error).

## 7. Route / page plan

| Route | Source | Notes |
|---|---|---|
| `/coreslots` | `/coreslots` (+filter chips deferred) | list, replaces placeholder |
| `/coreslots/[slotId]` | `/coreslots/{slotId}` + 7 sub-resources | detail, sections reusable |
| `/liveness` | `/network/liveness-risk` + per-slot `/health` | network liveness, replaces placeholder |
| `/network` | `/network/validator-set?height=` + `/network/proposers` | validator set + leaderboard (new route) |
| `/operator/[address]` | `/coreslots?operatorAddress=` → slot sections | north-star, new route |

`/network` is a **new route with a new top-level `Network` nav entry** (locked §20.3); `/liveness`
stays separate (risk + per-slot health).

## 8. CoreSlot list/detail plan

- **List (`/coreslots`):** `PaginatedTable` — slotId (link), status `Badge`, operatorAddress
  (`MonoCopy`), consensusPower, rewardWeight, createdHeight, removedHeight. Filter chips
  (status/operator) **deferred** (contract supports them; not in 11 scope).
- **Detail (`/coreslots/[slotId]`):** thin server page → `<CoreSlotDetail slotId>`. Identity `DataList`
  (slotId, status, operator/payout/consensus addresses, power, rewardWeight, created/updated/removed
  heights, consensusPubkey, metadata via `JsonView`) + the embedded `health` summary. Then **reusable
  sections** (each its own `slotId`-parameterized component):
  - **Health** — `/health` (uptime lifetime/recent500/recent1000, streaks, missed counts, policyVersion).
  - **Liveness** — `/liveness` array, one row per `windowKind` (uptimeBps, signed/missed/expected, streaks).
  - **Proposed blocks** — `/proposed-blocks` (keyset; height link, time, attributionStatus).
  - **Authority history** — `/events` (keyset; kind badge lifecycle/metadata/payout, height, txHash link,
    `detail` via `JsonView`) + `/key-rotations` (keyset) + `/windows` (keyset) as the PoA trust surface.
  - **Rewards (caveated)** — `/rewards` small section (epoch, amount→TWLT, claimed, with
    `gated_by_phase_7_2` badge). Full rewards UX is Phase 12.
  - **Raw** — lazy `include=raw` via `RawSection`.

## 9. Liveness page plan (`/liveness`)

`/network/liveness-risk` summary (haltRiskLevel `Badge`, healthy/degraded/down/unknown counts,
availablePowerBps) + a per-CoreSlot health table. **Locked: bounded fan-out** — fetch
`/coreslots/{slotId}/health` per slot (PoA has few slots), each row showing `summaryStatus`/uptime and
linking to `/coreslots/[slotId]`; log + cap if the slot set ever grows large.

## 10. Network page plan (`/network`)

Validator set **at latest height** (`useValidatorSet(height)` from `/status`) — table of
slotId/consensusAddress/operatorAddress/consensusPower/effectiveFrom-To; explicit unavailable state
when height can't be derived (reused 10a pattern). Proposer leaderboard (`/network/proposers`) —
slotId/operator/blocksProposed, sorted by blocksProposed desc (stable tie-break by slotId).

## 11. Operator page plan (`/operator/[address]`) — north-star

No operator endpoint → resolve address → CoreSlot(s) via `/coreslots?operatorAddress={address}`:
- **Resolution (locked):** query `operatorAddress`; if empty, fall back to `consensusAddress` then
  `payoutAddress`. Only after all three are empty → **0 results** state "No CoreSlot for this address"
  (not an error).
- **1 result (normal PoA case):** render the operator view = the CoreSlot detail **sections reused**
  (identity, health, liveness, proposed-blocks, authority history, caveated rewards), keyed by the
  resolved `slotId`, with the operator framing ("Is my slot active/signing? what did I earn?").
- **N results:** the operator owns multiple slots → list each with a slot picker, or stack sections per
  slot. Recommend a compact per-slot accordion/list.

The page answers the north-star directly: active (status/isActiveAtLatest) · signing
(health/liveness uptime + missed streak) · authority actions (events/key-rotations) · proposed blocks
(proposed-blocks) · network risk (link to `/liveness`).

## 12. Search integration plan

`searchResultHref` already maps `coreslot` → `/coreslots/{slotId}` (works — slotId is in the result).
Phase 11 makes that link resolve to the real page; **11a needs no search change**. The `role` hint
plus an `/operator/{q}` secondary affordance is **deferred to 11c** (and only if it naturally touches
existing search code). The ambiguity picker is unchanged.

## 13. Shared components plan

Reuse all of 10b (`PaginatedTable`, `DataList`, `DetailShell`, `JsonView`, `RawSection`, `MonoCopy`,
`Badge`, states, freshness, formatters, `bps.ts`). New:
- `coreslots/CoreSlotSections/*` — `slotId`-parameterized section components (Health, Liveness,
  ProposedBlocks, AuthorityHistory, RewardsCaveated) reused by both CoreSlot detail and Operator page.
- `coreslots/CoreSlotDetail.tsx`, `coreslots/CoreSlotsList.tsx`.
- `operator/OperatorResolver.tsx` (address→slot cardinality 0/1/N) + `operator/OperatorView.tsx`.
- `network/ValidatorSetSection.tsx`, `network/ProposerLeaderboard.tsx`, `liveness/LivenessOverview.tsx`.
- New query hooks (all via existing `apiGet`/`apiGetPath`): `useCoreSlot(slotId)`,
  `useCoreSlotEvents/Windows/KeyRotations/ProposedBlocks/Rewards(slotId)` (infinite),
  `useCoreSlotLiveness(slotId)`, `useCoreSlotHealth(slotId)`, `useCoreSlotRaw(slotId, enabled)`,
  `useCoreSlotsByOperator(address)` (+ optional consensus/payout). `useValidatorSet`/`useProposers`/
  `useLivenessRisk`/`useCoreSlots` already exist.

## 14. Data correctness invariants

`slotId`, heights, amounts, cursors stay **strings — no `Number()`** (slotId is uint64). bps/counts are
bounded ints (safe as numbers, like 10a). Rewards amounts `utwlt→TWLT` via BigInt, raw preserved;
rewards caveats (`gated_by_phase_7_2`/`claimSemantics`) **visible**. Only contract fields rendered.
Opaque cursors; `error.code` branching; `sampled`/`sampledAtHeight` on rewards honored.

## 15. Unsupported relations intentionally omitted

- **No operator endpoint** → resolved via `/coreslots?operatorAddress=` (filter, not invented).
- **No CoreSlot→tx-list** → omit; link individual event `txHash` to `/txs/{hash}`.
- **No "current" validator set** without height → derive from `/status`.
- List filter UIs (status/operator/kind/windowKind) → deferred (contract supports; out of 11 scope).
- Full rewards economics (epochs list/claims/balances/treasury) → Phase 12 (only a caveated per-slot
  subsection here).

## 16. Testing plan

`useCoreSlotsByOperator` resolution (0/1/N); CoreSlot detail success + invalid_slot_id + not_found;
each sub-resource section renders (events/windows/key-rotations/liveness[array]/health/proposed-blocks/
rewards-with-caveat-visible); liveness array (non-paginated) renders all windowKinds; network page
validator-set uses derived height + unavailable-without-height; proposer leaderboard sort/tie-break;
operator page 0/1/N states + reuses sections; rewards caveat badge present; search coreslot→
`/coreslots/[slotId]` navigation; no `Number()` on slotId/heights/amounts; boundary + theme guards;
`openapi:check`. Vitest + RTL + jsdom.

## 17. Implementation sequencing — **split: 11a → 11b → 11c**

- **11a — CoreSlot list + detail + reusable sections — ✅ DONE.** `/coreslots`, `/coreslots/[slotId]`,
  and `coreslots/sections/{Health,Liveness,ProposedBlocks,AuthorityHistory,Rewards,Raw}.tsx` (each takes
  `slotId`). 10 new hooks via existing `apiGet`/`apiGetPath`. `/liveness`+`/health` correctly use
  `useQuery` (non-paginated). Codex review pending.
- **11b — Liveness + Network pages** (pending; light — `/liveness` reuses `useCoreSlotHealth` bounded
  fan-out, `/network` reuses `useValidatorSet(height)` + `useProposers`). Independent of 11c.
- **11c — Operator page** (pending; reuses 11a's `coreslots/sections/*` after resolving operator→slot
  via `/coreslots?operatorAddress=` + consensus/payout fallback; cardinality 0/1/N).

Three reviewable PRs beat one very large PR: 11a is large, 11c depends on 11a's components, and the
operator-resolution risk is best isolated in 11c. Each PR: typecheck/build/test/openapi:check/lint
green + report.

## 18. Codex validation focus

Operator resolution correctness (0/1/N; no invented operator endpoint; consensus/payout fallback if
adopted); only contract fields rendered (esp. the deep CoreSlot sub-resources); rewards caveat
visibility; validator-set height handling; liveness array (non-paginated) not mis-wired into
`useInfiniteQuery`; slotId string-safety + message/regex consistency; no DB/chain/RPC; opaque cursors.

## 19. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Operator identity (no endpoint; cardinality)** | Resolve via `/coreslots?operatorAddress=`; explicit 0/1/N states; isolate in 11c; test all three |
| CoreSlot detail breadth (8 sub-resources, N+1 fetches) | Lazy/independent section queries; collapse rarely-used sections; bounded fan-out only on small PoA sets |
| Liveness array mistaken for paginated | It returns a plain array — single `useQuery`, render all windowKinds (test guards) |
| validator-set height | Reuse the solved `useValidatorSet(height)` + unavailable state |
| slotId-0 / message mismatch | Match the validation message to the regex (lesson from the 10b height-0 fix) |
| Rewards caveat dropped | Caveat badge is a tested invariant on every rewards row |

## 20. Resolved decisions (locked 2026-06-27)

1. **Operator entry breadth → operatorAddress + fallbacks.** Resolve by `operatorAddress`; if empty,
   fall back to `consensusAddress` then `payoutAddress` (all contract-supported). Only after all three
   are empty show "No CoreSlot for this address." (§11)
2. **Search → operator routing → slot link primary.** Coreslot search results keep routing to
   `/coreslots/{slotId}` (contract-safe; slotId always present). A `/operator/{q}` secondary affordance
   for `role==="operator"` is **deferred to 11c** (and only if it naturally touches existing search
   code) — **no operator search enhancement in 11a**. (§12)
3. **Network nav → separate `/network` route + nav entry.** Keep `/liveness` (risk + per-slot health)
   and add a distinct `/network` route (validator-set + proposers) with a **Network** nav entry. (§7/§10)
4. **Liveness per-slot health → bounded fan-out.** Fetch `/coreslots/{slotId}/health` per slot
   (PoA-sized set) for a per-slot health table, with a logged cap if the set ever grows large. (§9)

## 21. Final recommendation

Proceed as **three sub-phases (11a CoreSlot → 11b Liveness/Network → 11c Operator)**. The riskiest
dependency — **operator identity resolution via `/coreslots?operatorAddress=`** — is novel and central
to the north-star, so it's isolated in 11c after 11a produces the reusable, `slotId`-parameterized
CoreSlot sections it composes. No new client capability is needed (`apiGetPath` + `useValidatorSet`
already exist). Lock the four §20 questions, then implement 11a first.
