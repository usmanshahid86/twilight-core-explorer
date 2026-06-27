# Phase 11b+c — Network, Liveness, and Operator Surfaces — Implementation Plan

**Status: Plan (no code).** Date: 2026-06-27. **Branch (to create):** `feat/11bc-network-operator-surfaces`
off merged `main` (after 11a merges). Depends on Phase 9 API + 10a/10b + **11a** (CoreSlot sections,
reused here). Contract-grounded against `docs/reference/openapi.json` + the generated web schema.

## 1. Status: **READY**

Open items (§22) are minor structuring choices with recommendations, not blockers.

## 2. Executive summary

Three surfaces, all reuse-heavy because 11a + 10a already built the pieces:
- **`/liveness`** — network halt-risk summary (`/network/liveness-risk`) + a **bounded per-slot health
  fan-out** (`/coreslots/{slotId}/health`, cap 100), reusing the existing slot list + health hooks.
- **`/network`** — validator set at the latest indexed height (`useValidatorSet(height)` from `/status`)
  + proposer leaderboard (`/network/proposers`); adds a top-level **Network** nav entry.
- **`/operator/[address]`** — the north-star, built on an **isolated operator resolver** that maps an
  address → CoreSlot(s) via the `/coreslots` filters (operator → consensus → payout fallback), then
  reuses 11a's `CoreSlotDetail`/sections for the resolved slot.

The riskiest dependency is the **operator resolver** (sequential 3-filter fallback). **One operator
owns exactly one CoreSlot (chain rule)**, so the expected cardinality is 0 or 1; >1 is a surfaced
anomaly, not a picker case. The resolver is a pure, separately-unit-tested module
(`lib/operator-resolver.ts`) — preserving the isolation benefit of the original 11c split even inside
one PR.

**Operator-forward orientation (locked).** This is a PoA chain: a CoreSlot *is* the validator and an
operator (1:1) runs it, so the **operator is the user-facing identity** (the validator-equivalent),
CoreSlot-backed in data. Live data (2026-06-27) confirms `CoreSlot.metadata.moniker` carries a human
name when present (e.g. `core5`) but is **optional and open-ended** (some slots `null`/scalar). So this
phase:
- adds a **`displayName(operator) = moniker ?? shorten(operatorAddress)`** identity used everywhere;
- renders an **extension-ready Operator profile** (`parseOperatorMetadata`) that *promotes* known
  metadata fields (today: `moniker`) and *preserves* unknown ones via `JsonView`, so future chain
  additions (website, details, security-contact, …) appear with **no rewrite** and can be promoted to
  first-class fields one line at a time;
- **links operator/proposer identities through to `/operator/[address]`** on the network pages and
  (retro) on block proposers — making the operator the hub everything points at.

**Contract reality:** the moniker is **only on `/coreslots/{slotId}` (`metadata`)** — NOT on `/coreslots`
(list), `/network/proposers`, or `/network/validator-set`. So leaderboard/validator-set/list tables get
operator **links** for free, but to show **names** they need a bounded operator-metadata enrichment
(§14). This is exactly the kind of gap a future API change (adding `operatorMetadata` to those
responses) would close — design the enrichment so it can be dropped later.

## 3. Contract audit findings

- **`/coreslots` filters** (`operatorAddress`, `consensusAddress`, `payoutAddress`, + status) each return
  **`200` with a (possibly empty) `data` array — never `404`** for "no match." So the resolver detects
  cardinality via `data.length`, and errors (`400`/transport) are a separate branch.
- **`/network/liveness-risk`** takes no params, codes **`200`/`404`**. The `404` = "no liveness snapshot
  yet" → must render a **soft non-error state**, not the hard NotFound.
- **`/network/validator-set` requires `height`** (`200`/`400`); derive from `/status`
  `indexer.lastIndexedHeight`. **`/network/proposers`** no params, `200` only.
- **No `/operator*` endpoint** (confirmed in 11a) — resolver via `/coreslots` filters only.
- Fixture has **5 CoreSlots** → the cap (100) is a safety net, never hit in practice (PoA).

## 4. Endpoint inventory

| Endpoint | Params | Codes | Use |
|---|---|---|---|
| `/network/liveness-risk` | — | 200, **404** | `/liveness` summary (404 → soft empty) |
| `/coreslots` (filtered) | status/operatorAddress/consensusAddress/payoutAddress, limit, cursor | 200, 400 | resolver + liveness slot set |
| `/coreslots/{slotId}/health` | — | 200, 400, 404 | per-slot health fan-out (reused 11a hook) |
| `/status` | — | 200 | latest indexed height |
| `/network/validator-set` | **height (REQ)** | 200, 400 | `/network` validator set |
| `/network/proposers` | — | 200 | `/network` leaderboard |
| `/coreslots/{slotId}` + 7 sub-resources | (11a) | — | reused by the operator view |

## 5. Required params + pagination model

- **height** (validator-set): from `/status` `indexer.lastIndexedHeight`, digit-validated, **no
  `Number()`**; reuse `useValidatorSet(height)` (disabled until present; explicit unavailable state).
- **Resolver filter queries:** `apiGet('/api/v1/coreslots', { [filterKey]: address, limit: 100 })` —
  single page suffices (an operator owning >100 slots is unrealistic for PoA; cap noted).
- **Liveness slot set:** reuse the existing `useCoreSlots` (limit 100, single fetch); `page.nextCursor !==
  null` ⇒ **capped note** (more than `LIVENESS_HEALTH_FANOUT_LIMIT = 100` slots).
- `/network/*`, `/liveness-risk`, `/health`, `/status` are single fetches (`useQuery`). No new keyset
  lists in 11b+c (the proposer leaderboard + validator set are plain arrays).

## 6. Error-code handling plan

Reuse `ErrorState` (branches on `error.code`) **except** two soft cases:
- `/network/liveness-risk` `not_found` (404) → soft "No liveness snapshot yet" panel (not NotFound).
- Resolver: empty `data` is **not** an error — it drives the 0-match empty state; only transport
  (`network_unavailable`) / `invalid_query` (400) propagate to `ErrorState`.
Validator-set: `invalid_height`/unavailable → the existing unavailable state (10a pattern). Per-slot
health fan-out: individual slot errors render inline per row (the row shows "health unavailable"),
never failing the whole page.

## 7. Route / page plan

| Route | Source | Notes |
|---|---|---|
| `/liveness` | `/network/liveness-risk` + bounded `/health` fan-out | replaces placeholder |
| `/network` | `/status` → `/network/validator-set?height=` + `/network/proposers` | **new route + nav entry** |
| `/operator/[address]` | resolver over `/coreslots` filters → 11a sections | **new route** |

## 8. `/liveness` implementation plan

`LivenessOverview`:
1. **Risk summary** (`useLivenessRisk`): `haltRiskLevel` `Badge`, healthy/degraded/down/unknown/incomplete
   counts, available/unavailable slot counts, `availablePowerBps` (`bpsToPercent`), `policyVersion`,
   `latestCommittedHeight`. On 404 → soft "no snapshot" panel.
2. **Per-slot health table** (`PerSlotHealthTable`): fetch the slot set via `useCoreSlots` (≤100), then a
   **bounded fan-out** of `/coreslots/{slotId}/health` (cap `LIVENESS_HEALTH_FANOUT_LIMIT = 100`). Each
   row: slotId (link to `/coreslots/{slotId}`), `summaryStatus`/`healthStatus` `Badge`, uptimeBps,
   missed streak, isActiveAtLatest. If `nextCursor !== null` (slot set exceeds the cap) → a clear
   a capped note that does **not** invent a total: **"Showing the first 100 CoreSlots. More are
   available — open individual CoreSlot pages for full detail."** (the only signal is `nextCursor !==
   null`; we never claim "of N"). Per-slot health errors render inline, not page-fatal.
   Do **not** use `/coreslots/{slotId}/liveness` here (that's per-slot windows; this page is network-level).

## 9. `/network` implementation plan

`NetworkPage`:
1. Derive `height` from `useStatus` (`indexer.lastIndexedHeight`, digit-validated). If absent →
   explicit unavailable state (reuse the 10a CoreSlotHealthPanel pattern); **never call validator-set
   without height**.
2. **Validator set** (`useValidatorSet(height)`): **operator-forward** — lead with the operator
   (`displayName` via the directory, §14) linked to `/operator/[operatorAddress]`, then slotId(link),
   consensusAddress(`MonoCopy`), consensusPower, effectiveFrom→To; header notes "at height H".
3. **Proposer leaderboard** (`useProposers`): **operator-forward** — operator `displayName` (linked to
   `/operator/[operatorAddress]`) + slotId(link) + `blocksProposed`, sorted by `blocksProposed` desc
   with a stable `slotId` tie-break.
4. **Nav:** add `Network` to the header NAV (see §15).

Operator names in (2)/(3) come from the **bounded operator directory** (§14) — the proposers/validator-
set responses carry only `operatorAddress`. The directory is **non-blocking**: the tables render
immediately with operator **address links**, and names upgrade in place when the directory resolves; a
directory error (or per-slot metadata failure) never fails the page — that row just keeps its address
link. No moniker ⇒ `displayName` = shortened address (still linked).

## 10. `/operator/[address]` implementation plan

`app/operator/[address]/page.tsx` (thin server) → `<OperatorView address={params.address}>` (client):
1. `useOperatorResolution(address)` → `{ status, matchedRole, slots }` (resolver §11).
2. **Operator header (operator-forward):** **`displayName`** as the headline (moniker from the resolved
   slot's `metadata`, else shortened address) + the full address (`MonoCopy`) + a role `Badge` ("matched
   by operator / consensus / payout address") + an **Operator profile** block (`parseOperatorMetadata`:
   known fields promoted, unknown `extras` via `JsonView` — extension-ready). Framed as "Operator
   (validator) — runs CoreSlot N."
3. **Render the single resolved slot** — one operator = one CoreSlot (chain rule):
   - **1 slot (expected):** header + reuse **`CoreSlotDetail` by the resolved `slotId`** (composes all
     11a sections — maximal reuse). No picker.
   - **0 slots:** non-error empty state "No CoreSlot found for this address."
   - **>1 slots (anomaly — must not happen per chain rule):** render the first slot **and** a visible
     "multiple CoreSlots matched this address (unexpected)" note — surfaced, never silently dropped.

## 11. Operator resolver algorithm (`lib/operator-resolver.ts` — isolated, pure)

```
const ROLE_FILTERS = [
  ['operator',  'operatorAddress'],
  ['consensus', 'consensusAddress'],
  ['payout',    'payoutAddress'],
];
async function resolveOperator(address, get = apiGet):
  for [role, filterKey] of ROLE_FILTERS:
    const res = await get('/api/v1/coreslots', { [filterKey]: address, limit: 100 });
    if (res.data.length > 0) return { matchedRole: role, slots: res.data };   // stop at first non-empty
  return { matchedRole: null, slots: [] };
```
- Pure async function; `apiGet` injected for testability (mock-free unit tests).
- **Stops after the first non-empty role** (no wasted queries).
- Errors thrown by `apiGet` (ApiError with `code`) propagate to the caller — the resolver does not
  swallow them. Empty results are data, not errors.

## 12. Operator resolver state machine

| State | Condition | UI |
|---|---|---|
| **loading** | resolution query pending | `LoadingState` |
| **error** | `apiGet` threw (`network_unavailable` / `invalid_query`) | `ErrorState` (branch on `error.code`) |
| **none** | all three roles empty | empty: "No CoreSlot found for this address." |
| **found** | first non-empty role has 1 slot (expected) | role header + `CoreSlotDetail(slotId)` |
| **anomaly** | first non-empty role has >1 slots (must not happen — chain rule) | render first slot + a visible "multiple matched (unexpected)" note |

Fallback order is fixed: operatorAddress → consensusAddress → payoutAddress; the matched role is shown.
An operator owns exactly one CoreSlot (chain rule), so >1 is a surfaced anomaly, not a normal picker case.

## 13. Reuse plan for Phase 11a CoreSlot sections

The operator view renders **`CoreSlotDetail`** (which already composes
`Health/Liveness/ProposedBlocks/AuthorityHistory/Rewards/Raw` by `slotId`) for the resolved/selected
slot — **zero duplication**. The only operator-specific UI is the resolution header (`displayName` +
address + matched-role badge), the `OperatorProfile` block, and the >1-match anomaly note. The CoreSlot
detail identity card also adopts `displayName` so both pages lead with the operator's name. (If a
slimmer operator view is wanted later, the individual `coreslots/sections/*` are equally reusable.)

## 14. Shared components / hooks plan

- **Reused (exist):** `useStatus`, `useValidatorSet(height)`, `useProposers`, `useLivenessRisk`,
  `useCoreSlots`, `useCoreSlotHealth`, `CoreSlotDetail` + all `coreslots/sections/*`, `PaginatedTable`,
  `Table`, `Card`, `Badge`, `MonoCopy`, `StatCard`, states, freshness, formatters (`bps`/`height`/etc.).
- **New pure modules (extensible identity layer):**
  - `lib/operator-metadata.ts` — `parseOperatorMetadata(metadata: unknown): { moniker?: string; extras:
    Record<string, unknown> }` (defensive: guards null/scalar/object; promotes known keys, preserves the
    rest) and `displayName({ moniker, operatorAddress }): string` (moniker ?? shortened address). **Pure,
    unit-tested** independent of React — this is where future operator fields are promoted one line at a
    time.
  - `lib/operator-resolver.ts` — the address→slot resolver (§11).
- **New hooks:** `useOperatorResolution(address)`; `useCoreSlotHealthFanout(slotIds, cap)` (single
  `useQuery`, `Promise.all` over capped slotIds → per-slot `{slotId, health|error}` + `capped`);
  **`useOperatorDirectory(slotIds, cap)`** — a **disciplined, non-blocking** enrichment:
  - **input:** `slotIds[]` (cap 100); **fetch:** `/coreslots/{slotId}` (single `useQuery`, bounded
    `Promise.all`); **output:** `slotId → { displayName, moniker?, operatorAddress?, metadataExtras? }`.
  - **failure mode: per-slot fallback, never page-fatal.** A failed/missing metadata fetch for one slot
    yields `displayName = shorten(operatorAddress)` for that row; the rest still enrich. The directory is
    **not** a hard dependency of `/network` — if the whole enrichment errors or is still loading, the
    leaderboard/validator-set render immediately with operator **address links** and upgrade names when
    they arrive. Droppable wholesale if the API later adds `operatorMetadata` to list/network responses.
- **New components:** `liveness/LivenessOverview.tsx`, `liveness/PerSlotHealthTable.tsx`,
  `network/NetworkPage.tsx` (`ValidatorSetSection` + `ProposerLeaderboard`, both operator-forward),
  `operator/OperatorView.tsx`, `operator/OperatorProfile.tsx` (known fields + `extras`). **No slot
  picker** (one operator = one slot).
- **Operator-forward linking (cross-cutting, in scope):** an `OperatorLink` helper (renders
  `displayName` linked to `/operator/[operatorAddress]`, address fallback). Apply on the leaderboard,
  validator set, and **retro-link the block proposer** in 10b's `BlocksList`/`BlockDetail` and 11a's
  `CoreSlotProposedBlocksSection` (small touch — proposer cell becomes an `OperatorLink`). The CoreSlot
  detail identity header also adopts `displayName`.

## 15. Navigation update plan

Add `Network` to the header `NAV` array between `Liveness` and `Rewards`. Target order:
`Overview · Blocks · Transactions · Accounts · CoreSlots · Liveness · Network · Rewards · Supply · API`.
Liveness stays a separate top-level page.

## 16. Data correctness invariants

slotId/heights/amounts/addresses/cursors stay **strings — no `Number()`** (bps/counts are bounded ints,
safe as numbers per 10a). `availablePowerBps`/`uptimeBps` via `bpsToPercent`. Opaque cursors;
`error.code` branching; only contract-exposed fields; resolver empty ≠ error; liveness-risk 404 = soft
state. No reward economics beyond what 11a already shows (operator view inherits 11a's caveated rewards).
**`metadata` is open-ended `unknown`:** `parseOperatorMetadata` must guard for non-object/null/scalar
shapes, treat every field as optional, and never assume a key exists — known fields are promoted only
when present and the right type; everything else is preserved verbatim. No metadata field is invented.

## 17. Unsupported relations/features intentionally omitted

- **No operator endpoint** → resolver via `/coreslots` filters.
- **No "current" validator set** without height → derive from `/status`.
- **No network-level per-slot liveness endpoint** → `/liveness` fans out `/health` (per-slot windows live
  on the CoreSlot detail via 11a).
- **Operator moniker absent from list/network responses** (`/coreslots` list, `/network/proposers`,
  `/network/validator-set` carry only `operatorAddress`, not `metadata`). Names in those tables are
  enriched via the bounded `useOperatorDirectory` fan-out (§14); a future API change adding
  `operatorMetadata` to those responses would let us drop the fan-out. Links work without it.
- Search→operator routing: **not changed** (locked slot-link-primary). A tiny `role==="operator"` →
  `/operator/{q}` secondary link is allowed only if it's contract-safe and trivial — default off.
- No rewards economics / claims / supply detail (Phase 12); no charts; no mutations.

## 18. Testing plan

Resolver unit tests (pure, mock `get`): operatorAddress match; consensus fallback; payout fallback;
**stops after first non-empty role**; zero-match → `{matchedRole:null, slots:[]}`; error propagation
(branch on `error.code`). Page tests: `/liveness` risk summary success; liveness-risk **404 → soft no-
snapshot**; bounded per-slot health fan-out renders rows; **fan-out cap behavior** (capped note when
`nextCursor`); `/network` derives height from `/status`; **never calls validator-set without height**;
`/network` unavailable when height missing; proposer leaderboard renders + sort/tie-break;
`/operator/[address]` operator/consensus/payout matches + role badge; zero-match empty; **>1-match
anomaly note** (surfaced; chain rule says it shouldn't occur); **11a sections reused not duplicated**
(operator view mounts `CoreSlotDetail`); **`parseOperatorMetadata`/`displayName`** unit tests (moniker
present → name; absent/null/scalar/non-object → safe address fallback; unknown keys preserved as
`extras`); **operator-forward linking** (leaderboard/validator-set/block-proposer cells render
`displayName` linked to `/operator/[operatorAddress]`); bounded `useOperatorDirectory` enrichment + cap + **non-blocking failure** (directory error / per-slot
metadata failure → the row still renders the operator address link; `/network` is never blocked);
no `Number()` on height/slotId/address/cursor; boundary + theme guards; `openapi:check`. Vitest + RTL
+ jsdom.

## 19. Implementation sequencing inside the combined PR

1. **Pure identity layer first:** `lib/operator-metadata.ts` (`parseOperatorMetadata`/`displayName`) +
   `lib/operator-resolver.ts`, each with unit tests (riskiest + most-reused, isolated and fully proven).
2. **`/liveness`** (risk summary + bounded health fan-out hook).
3. **`/network`** (operator-forward validator-set + proposers via `useOperatorDirectory`) + the
   `Network` nav entry.
4. **`/operator/[address]`** (`useOperatorResolution` + `OperatorView` with `displayName` header +
   `OperatorProfile`, reusing `CoreSlotDetail`; single slot, no picker).
5. **Operator-forward cross-linking:** `OperatorLink` on leaderboard/validator-set + retro on block
   proposers (10b) and `CoreSlotProposedBlocksSection`; CoreSlot detail header adopts `displayName`.
6. Page tests + report.

Resolver first keeps the original 11c isolation benefit; the two network pages are independent and light;
the operator page consumes the proven resolver last.

## 20. Codex validation focus

Resolver correctness (fallback order, stop-after-first-non-empty, empty≠error, `error.code` branch, no
invented operator endpoint); validator-set height handling (never heightless); liveness-risk 404 soft
state; fan-out cap + per-row error isolation; 11a sections reused (no duplicated CoreSlot code); string
safety (no `Number()`); opaque cursors; no DB/chain/RPC; nav order.

## 21. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Operator resolver (fallback + cardinality)** | Pure isolated module, `apiGet` injected, unit-tested 0/1/N + fallback + error before any page wiring |
| Rules-of-hooks vs dynamic fan-out | `useCoreSlotHealthFanout` is ONE `useQuery` (`Promise.all` over capped slotIds) — no hooks-in-loop |
| liveness-risk 404 mis-rendered as error | Explicit soft-state branch on `not_found` |
| validator-set heightless 400 | Reuse solved `useValidatorSet(height)` + unavailable state |
| Operator view drift from CoreSlot detail | Reuse `CoreSlotDetail` wholesale — single source |
| Fan-out cost on large sets | Cap 100 + capped note; PoA is tiny in practice |

## 22. Resolved decisions (locked 2026-06-27)

1. **One operator = one CoreSlot (chain rule).** The Operator page renders the single resolved slot's
   `CoreSlotDetail` — no picker/accordion. >1 matches is a data anomaly: render the first slot + a
   visible "multiple matched (unexpected)" note (surfaced, never silently dropped). (§10/§12)
2. **Liveness fan-out → single aggregating `useQuery`** (`Promise.all` over the capped slotIds;
   cap-testable, one loading state). (§8/§14)
3. **Search untouched** — coreslot results keep routing to `/coreslots/[slotId]`; no operator link from
   search in 11b+c. (§17)

## 23. Final recommendation

Proceed as **one combined PR**, built in the §19 order with the **operator resolver isolated and
unit-tested first**. No new client capability is needed (`apiGet`/`apiGetPath`/`useValidatorSet` exist);
the operator view reuses `CoreSlotDetail` wholesale. Completing 11b+c finishes Phase 11 → then one
checkpoint update + the Phase 11 tag.
