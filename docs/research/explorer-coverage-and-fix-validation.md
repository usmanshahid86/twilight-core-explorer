# Explorer Coverage & Chain-Alignment Fix Validation

Date: 2026-06-24
Scope: READ-ONLY. Part A validates the just-implemented chain-alignment fixes against the
chain source. Part B is a coverage/UX gap matrix mapping every chain feature to the
explorer design. Every claim cites `file:line` on both the explorer and the chain
(`nyks-core`) side. Where I could not verify something I say so explicitly.

Chain ground truth: `nyks-core/docs/reference/explorer-integration-handoff.md`.

---

## PART A — Chain-Alignment Fix Validation

### Fix 1 — ClaimableRewards epoch range (was BLOCKER) → **RESOLVED**

- Explorer: interface now `getClaimableRewards(slotId, startEpoch, endEpoch)`
  (`packages/chain-client/src/types.ts:24-28`); impl sends `start_epoch`/`end_epoch` as
  query params (`packages/chain-client/src/rest-rpc-client.ts:267-279`).
- Chain guard satisfied: keeper rejects `SlotId==0 || StartEpoch==0 || EndEpoch<StartEpoch`
  (`nyks-core/x/rewards/keeper/query_server.go:99-100`); REST doc lists both params as
  **required**, "400 if range missing/invalid"
  (`nyks-core/docs/reference/rest-routes.md:25`).
- Returns unclaimed-only: keeper filters `reward.Claimed` and non-positive amounts
  (`query_server.go:110-119`).
- Test exercises the BLOCKER: `getClaimableRewards(7n, 10n, 20n)` asserts
  `start_epoch=10` / `end_epoch=20` on the URL
  (`packages/chain-client/test/rest-rpc-client.test.js:220,245-246`).
- Verdict: param names, ordering, and required-range contract all match. The type system
  now makes the no-range 400 case unrepresentable (the params are non-optional `bigint`).
  Minor note: there is **no negative test** asserting the keeper's 400 when the range is
  invalid — the previous review (`chain-alignment-review.md:69-70`) asked for a
  route-contract test that the params are mandatory; the type signature enforces this at
  compile time, so the regression risk is low, but a runtime 400 fixture is still absent.

### Fix 2 — SlotRewards pagination → **RESOLVED**

- Explorer: `getSlotRewards(slotId, pagination?)`
  (`packages/chain-client/src/types.ts:23`, `rest-rpc-client.ts:257-265`);
  `buildPaginationQuery` emits exactly `pagination.limit`, `pagination.offset`,
  `pagination.key`, `pagination.reverse`, `pagination.count_total`
  (`rest-rpc-client.ts:342-352`). These are the standard cosmos `query.PageRequest` gateway
  names.
- Chain: `SlotRewards` uses `query.CollectionPaginate(..., req.Pagination, ...)` over
  `ClaimRecords` keyed `(slotID, epoch)` ascending
  (`nyks-core/x/rewards/keeper/query_server.go:83-90`); REST doc lists `pagination.*`
  (`rest-routes.md:24`). Because it threads `req.Pagination`, `pagination.reverse=true` is
  honored — this is exactly the ascending-limit trap escape hatch flagged in handoff §5.
- Test: `getSlotRewards(7n, { limit: 25n, reverse: true })` asserts
  `pagination.limit=25` and `pagination.reverse=true`
  (`test/rest-rpc-client.test.js:219,243-244`).
- Verdict: param names correct; reverse path proves the ascending-limit trap is avoidable.
  Caveat (design-level, not transport): the transport now *supports* `reverse`, but it does
  not *force* newest-first or auto-page-to-key — a caller can still issue a bare `limit` and
  re-introduce the trap. The architecture doc pushes the correct usage
  (`explorer-architecture-proposal.md:178`, `explorer-api-surface-refresh.md:159`), but the
  guarantee lives in the calling projection layer, which is not yet implemented (Phase E).

### Fix 3 — Consensus-address normalization (reject bech32) → **RESOLVED (acceptable rejection)**

- Explorer: `normalizeConsensusAddressHex` lowercases 40-char hex, throws
  `ChainClientInputError` on `twilightvalcons1…` and on any non-40-hex input
  (`rest-rpc-client.ts:327-340`); applied to both consensus routes
  (`rest-rpc-client.ts:205-213,223-231`). Test covers all three branches
  (`test/rest-rpc-client.test.js:249-263`), and the route test confirms the lowercased path
  on the wire (`…:198,201`).
- Chain — both routes satisfied by lowercase hex:
  - `CoreSlotByConsensusAddress` does `hex.DecodeString(input)` then re-encodes lowercase
    before lookup → case-insensitive hex, rejects bech32 with `encoding/hex: invalid byte`
    (`nyks-core/x/coreslot/keeper/query_server.go:49-53`).
  - `ReservedConsensusAddress` does a **direct** `q.Reserved.Get(ctx, req.ConsensusAddress)`
    with no normalization (`query_server.go:80-81`) — the stored key is lowercase hex, so
    **only lowercase matches**. The client always lowercases, satisfying this.
  - Lowercase therefore satisfies BOTH routes. Confirmed.
- The design recommended *decoding* bech32→hex (`chain-alignment-fixes-design.md:64-66`);
  the implementation *rejects* bech32 instead, with an explicit "conversion not implemented
  in this transport yet" error message (`rest-rpc-client.ts:330-332`). **Is rejecting
  acceptable?** Assessing every real source of a consensus address the explorer would feed
  to these routes:
  - CometBFT `/validators` → `validators[].address` is **hex** (handoff §2 line 40,
    fixes-design:70). No bech32.
  - Block header `proposer_address` is base64 bytes → hex-encode. No bech32. The smoke DB
    already stores proposers as uppercase hex (`phase-ab-6-semantic-projection-design.md:78-80`).
  - Coreslot events carry `consensus_address` — emitted from the keeper, which stores hex
    (`nyks-core/x/coreslot/keeper/events.go:24,35,…`; fixed-hex per handoff §2).
  - **No real explorer path holds a bech32 `valcons`.** The only way to get one is the
    cosmos `…/validatorsets` REST, which handoff §2 explicitly says NOT to use for coreslot
    lookups. So the rejection branch is effectively unreachable from the intended data
    sources, and throwing a typed error on it is safe — it fails loud on a misuse rather
    than passing a value the keeper would 4xx anyway.
  - Verdict: rejecting is **acceptable**. One residual: if a *human operator* pastes their
    `twilightvalcons…` into a future self-service search box, the explorer would have to
    decode it (bech32→20 bytes→hex). That is a UX feature, not a transport bug — see Part B
    gap "operator self-service".

### Fix 4 — Claim-truth documentation → **RESOLVED**

- Docs now state: `SlotRewards` rows are claim truth (carry `claimed`/`claimed_at_height`),
  `ClaimableRewards` is unclaimed-only for an explicit range, `reward_claimed` events are
  history/correlation, `EpochReward` is aggregate-only
  (`explorer-api-surface-refresh.md:161`; `explorer-data-model.md:406-410`;
  `phase-ab-6-semantic-projection-design.md:573`).
- Chain confirms:
  - `EligibleSlotReward.claimed` is field 8, `claimed_at_height` field 9
    (`nyks-core/proto/twilight/rewards/v1/rewards.proto`, EligibleSlotReward block) — these
    rows are what `SlotRewards` returns (`query_server.go:84-95`).
  - `ClaimableRewards` returns unclaimed-only (`query_server.go:110-119`).
  - `EpochReward` embeds `repeated EligibleSlotReward rewards = 13` as a finalization
    snapshot (`rewards.proto`, EpochReward block); `epochs/{n}` returns 404 until finalized
    (`query_server.go:73-75`; `rest-routes.md:23`).
- Verdict: docs match the chain exactly.

### Fix 5 — Stale buf/Telescope decoder recommendation → **RESOLVED**

- Production decode path is now stated as the descriptor set, buf/ts-proto framed as
  optional explorer-side codegen (`explorer-architecture-proposal.md:285-292`;
  `explorer-api-surface-refresh.md:136-151`; `explorer-data-model.md:627-630`).
- Chain ships only `docs/proto/twilight-descriptors.pb`, no buf/ts-proto (handoff §4).
  Matches.

### Regressions / incompleteness

- **No regressions found.** All five fixes are reflected in `types.ts`, `rest-rpc-client.ts`
  and the test, and the doc sections were updated consistently.
- Incompleteness (low severity, all calling-layer not transport):
  1. No runtime negative test for the ClaimableRewards 400 (compile-time enforced instead).
  2. `SlotRewards` reverse is *available* but the "never bare-limit for recent epochs"
     guarantee is unenforced until the rewards projection layer exists (Phase E).
  3. bech32 consensus-address *decoding* is deferred (rejected, not converted) — fine for
     indexer paths, a gap only for a future human-paste search box.
- BLOCKER spot-check: the new test (`test/rest-rpc-client.test.js:207-247`) directly
  exercises the previously-broken call with a real `(slot, start, end)` and asserts the
  query string — the BLOCKER case is covered.

---

## PART B — Coverage / UX Gap Matrix

Audiences: **Monitor** (network health watcher) and **Operator** (prospective/active slot
operator). Impact = effect on operator-friendliness.

### B.1 Query-route coverage (20 routes)

All 20 routes are present on the `ChainClient` interface
(`packages/chain-client/src/types.ts:9-32`) and wired in the transport
(`rest-rpc-client.ts:183-295`), verified against `rest-routes.md:16-44`. Route strings
(incl. `active-slots`, `current-epoch/active-blocks`) confirmed by the route test
(`test/rest-rpc-client.test.js:190-242`). Coverage at the **transport** level is complete;
the gaps below are about whether a route surfaces in a **page/projection** for a user.

| Route | Page/section (design cite) | Status | Journey | Impact |
|---|---|---|---|---|
| rewards `Params` | Rewards overview "params summary" (`roadmap:279`) | Covered | Both | Med |
| rewards `EpochInfo` | Rewards overview / dashboard card (`roadmap:279`, `arch:412,454`) | Covered | Both | Med |
| rewards `NextHalving` | Supply view (implied) | Partial | Both | High |
| rewards `EpochReward` | Epoch detail (`roadmap:280`, `arch:414`) | Covered | Both | Med |
| rewards `SlotRewards` | Claims/epoch per-slot rows (`data-model:654`) | Covered | Operator | High |
| rewards `ClaimableRewards` | Claims unclaimed check (`data-model:406`) | Covered | Operator | High |
| rewards `CumulativeEmitted` | Supply (`arch:417`) | Covered | Both | High |
| rewards `SupplySchedule` | Supply (implied, `arch:382`) | Partial | Both | High |
| rewards `CurrentEpochActiveBlocks` | — | Missing | Monitor | Med |
| rewards `ModuleBalances` | Module-balances card/endpoint (`arch:416,458`) | Covered | Monitor | Med |
| coreslot `Params` | CoreSlot list header (implied) | Partial | Operator | High |
| coreslot `CoreSlot` | Slot detail (`roadmap:215,229`) | Covered | Both | High |
| coreslot `CoreSlots` | Slot list (`roadmap:215,229`) | Covered | Both | High |
| coreslot `ActiveCoreSlots` | Dashboard "Active CoreSlots" (`arch:451`) | Covered | Both | High |
| coreslot `CoreSlotByOperator` | Account↔slot relationship (`arch:408`) | Partial | Operator | High |
| coreslot `CoreSlotByConsensusAddress` | proposer→slot join (`review:147-157`) | Partial | Monitor | High |
| coreslot `PendingKeyRotations` | (rotation projection `pab6:433`) | Partial | Operator | Med |
| coreslot `LastAppliedValidators` | — | Missing | Monitor | Med |
| coreslot `ReservedConsensusAddress` | — | Missing | Operator | Low |
| coreslot `RewardWeight` | Slot detail "reward weight" (`roadmap:229`) | Covered | Both | Med |

### B.2 Event coverage (19 events)

All 19 event-type strings are reproduced verbatim and mapped to projections
(`explorer-architecture-proposal.md:300-312,357-362`;
`phase-ab-6-semantic-projection-design.md:200-216,270-278`), matching the chain consts
(`nyks-core/x/coreslot/keeper/events.go`, `nyks-core/x/rewards/keeper/events.go` +
`x/rewards/types/events.go:5-7`). No invented events.

| Event group | Projection (design cite) | Status | Impact |
|---|---|---|---|
| coreslot lifecycle (registered/activated/inactivated/suspended/removed) | `CoreSlotLifecycleEvent` (`pab6:328-362`) | Covered (design) | High |
| coreslot key rotation (requested/rotated/cancelled) | `CoreSlotConsensusKeyRotation` (`pab6:433-466`) | Covered (design) | Med |
| coreslot payout/metadata/params updated | dedicated change tables (`pab6:369-432,472-501`) | Covered (design) | Med |
| `coreslot_validator_update_emitted` | open question: lifecycle vs validator-set table (`pab6:366,920`) | Partial | High |
| rewards `epoch_finalized` | `RewardEpochProjection` (`pab6:505-538`) | Covered (design) | Med |
| rewards `reward_claimed` | `RewardClaimProjection` + tx correlation (`pab6:540-573`) | Covered (design) | High |
| rewards `treasury_paid` | `RewardEmissionEvent` (`pab6:575-607`) | Covered (design) | Med |
| rewards params queued/activated | `RewardParameterChange` (`pab6:638-671`) | Covered (design) | High |
| rewards paused/resumed | `RewardPauseResumeEvent` (`pab6:673-705`) | Covered (design) | High |

Note: all rewards/coreslot projections are **design-only** — `phase-ab-6` is explicitly a
non-implementing pass (`pab6:23,898-915`); only generic block/tx/event/account ingestion is
implemented (Phases A/B). So "Covered (design)" = on paper, not yet shipped.

### B.3 Generic surfaces

| Feature | Page (cite) | Status | Impact |
|---|---|---|---|
| Blocks / block detail | `roadmap:167,178` | Covered | Med |
| Txs / tx detail (msgs/events/decode) | `roadmap:188`, `arch:407` | Covered | High |
| Accounts + `utwlt` balances | `roadmap:189`, `arch:408` | Covered | Med |
| Supply (bank) | `roadmap:168,274` | Covered | Med |
| Decode-failure visibility | `arch:418`, `roadmap:363` | Covered | Med |
| Node/network status, indexer lag | `arch:402,450`, `roadmap:190` | Covered | Med |

### B.4 High-value, commonly-missing surfaces

| Surface | Status | Journey | Impact | Evidence |
|---|---|---|---|---|
| **Per-operator liveness / uptime** | **Missing** | Monitor + Operator | **High** | No page, projection, or table anywhere derives a signer→slot uptime view. Block `last_commit` signatures are not ingested (indexer fetches `getBlock`/`getBlockResults`/`getTxsByHeight` only — `pab6:43`; `BlockResultsSource` has no commit-signature field — `types.ts:49-55`). Requires a temporal cons-addr→slot map (events provide it: `pab6:136` chain-side note) joined to per-height signatures. Hardest gap. |
| **Authority-action transparency** (registrations/suspensions w/ `reason`, param updates) | **Partial (design only)** | Monitor | **High** | Designed as `CoreSlotLifecycleEvent.reason` + `RewardParameterChange`/`CoreSlotParameterChange` (`pab6:348,472,638`). Captured at projection level but no dedicated "authority action log" page is in the page list (`roadmap:89`); a monitor must reconstruct trust from scattered slot-detail pages. |
| **Onboarding legibility** ("how to become an operator": authority, register→activate, live params: min/max slots, reward weight, open slots, reward-per-slot) | **Missing** | Operator | **High** | No onboarding page. `Params` routes are fetched but not surfaced as an operator-facing "what are the rules / how do I join" view. Register/activate are authority-gated msgs (`pab6:179-180`) — the explorer never explains the PoA admission flow. |
| **Per-operator economics page** (earned/claimable/claimed, payout addr, weight, claim history w/ tx hash) | **Partial (design only)** | Operator | **High** | Pieces exist: `SlotRewards.claimed`, `ClaimableRewards`, `RewardClaimProjection.claimTxHash`, `RewardWeight`, payout from `CoreSlotProjection`. But there is no single per-operator economics page in the page list — Claims is a flat table (`roadmap:281`), not an operator dashboard. |
| **Operator self-service** (paste operator/cons addr → status + claimable + history + liveness) | **Missing** | Operator | **High** | Search supports operator/consensus address (`arch:403`) but routes to generic account/slot views, not a consolidated self-service page. A pasted `twilightvalcons…` would also currently throw at the transport (Fix 3) since bech32 decode is deferred. |
| **Tokenomics view** (emitted vs max supply, halving progress by supply-threshold, per-epoch emission) | **Partial** | Both | **High** | Data wired (`CumulativeEmitted`, `SupplySchedule`, `NextHalving`, `epoch_finalized.minted_emission`) and supply page exists, but no explicit halving-progress/tokenomics visualization in the page list; risk of modeling halving as block-height is avoided in docs (`review:196-198`). |
| **"How this network works" explainer** (CoreSlot PoA, no staking/gov, rewards/halving) | **Missing** | Both | **High** | Strong in research docs and in the "why not ping.pub" stance (`arch:505-507`), but no in-UI explainer page is planned (`roadmap:89` nav list has none). The chain's whole value-prop to newcomers is its non-standard model; not surfacing it in-product is the biggest legibility miss. |
| **Graceful 501 handling** (no broken staking/gov/mint/distribution tabs) | **Covered** | Both | High | Non-goals explicit; 501 treated as expected (`explorer-old-repo-audit.md:79-85`); `ChainClient` forbidden from calling those routes (`arch:169,194`); no staking/gov pages (`roadmap:104,422`). |
| **Graceful unknown Msg/event handling** | **Covered** | — | Med | Unknown messages/events stored with `decodeError`, never halt the block (`arch:243-244`; `pab6:736`; `phase-ab-2-…:123`). |

### B.5 Indexer operational robustness

| Concern | Status | Evidence |
|---|---|---|
| Idempotent re-indexing | Covered | unique keys + idempotent upserts (`arch:239`; `phase-ab-2-…:16,154-156`); idempotent re-run test (`roadmap:145`). |
| Backfill-from-genesis + live-tail | Covered (genesis backfill implied via configurable start height) | sequential from `cursor+1` (`arch:218-222`); batch/pausable backfill in hardening (`roadmap:336,352,372`). |
| Gap detection | **Partial** | Sequential cursor prevents forward gaps, but no explicit "scan for holes / re-fetch missing heights" routine is documented. |
| Crash recovery / checkpointing | Covered | cursor updated in same DB txn as writes (`arch:240`); single-writer advisory lock (`phase-ab-2-…:17,126`). |
| DB schema migrations | Covered | Prisma migrations (`arch:26`; `phase-ab-2-…:38`; `roadmap:313,320`). |
| Self-observability (lag vs tip) | Covered | `latestChainHeight` tracked (`pab6:160`); `/health/ready` + `/api/status` expose lag (`arch:401-402,450`); lag monitoring in hardening (`roadmap:356`). |
| Reorg handling | **Appropriately light, NOT over-engineered** | Only a block-hash-mismatch **halt** (`arch:241`; `pab6:787-793`), no rollback/replay machinery built. Correct: CometBFT = instant finality, so no reorgs; the halt is a corruption tripwire, not reorg handling. They did not over-build for reorgs. |

---

## Top gaps ranked by operator-friendliness impact

1. **Per-operator liveness/uptime — Missing (High).** No signer→slot uptime view; block
   commit signatures aren't even ingested. Hardest and most operator-relevant gap; also the
   core *monitor* metric on an N-of-N PoA chain where one down validator halts the chain.
2. **"How this network works" explainer — Missing (High).** The chain's defining feature is
   its non-standard CoreSlot-PoA/no-staking/supply-halving model; not surfacing it in-UI
   leaves every newcomer to reverse-engineer it.
3. **Onboarding legibility — Missing (High).** No "how do I become an operator" page
   (authority, register→activate, live params). Directly blocks the prospective-operator
   journey.
4. **Operator self-service page — Missing (High).** No paste-address → status + claimable +
   history + liveness consolidation; bech32 cons-addr paste also currently throws.
5. **Per-operator economics page — Partial (High).** All data exists but is scattered across
   a flat Claims table and slot detail; no per-operator earned/claimable/claimed dashboard.
6. **Authority-action transparency log — Partial (High).** Reason-carrying lifecycle and
   param-change projections are designed but there's no dedicated authority-action audit
   page — the trust surface for a PoA authority.

(Runners-up: tokenomics/halving-progress visualization — Partial/High; `last-applied-validators`
and `current-epoch/active-blocks` routes fetched but unsurfaced — Missing/Med.)

## What's strong

- Transport-level correctness is excellent: all 20 routes, all 19 event names verbatim, all
  13 Msg type URLs, `active-slots` not `slots/active`, amounts-as-strings/`utwlt`,
  halving-by-supply-threshold, descriptor-backed tx decode. All five chain-alignment fixes
  land cleanly with tests and matching doc updates.
- Correct architectural posture: no staking/gov/mint/distribution models, 501 treated as
  expected, validators sourced from CoreSlot+CometBFT, "why not ping.pub" reasoning.
- Indexer foundation is genuinely robust: idempotent upserts, advisory-lock single writer,
  cursor-in-transaction, lag observability, migrations — and correctly *not* over-engineered
  for reorgs (instant finality).
- Semantic-projection design (`phase-ab-6`) is thorough, rebuildable-from-generic-rows, with
  a `ProjectionFailure` strategy and event/message hybrid correlation.

## Recommendations

UX (close the operator/monitor gaps):
1. Add a **per-operator page** keyed by slot/operator: status, payout, reward weight,
   earned/claimable/claimed (from `SlotRewards.claimed` + `ClaimableRewards`), claim history
   with correlated `claimTxHash`, and lifecycle/authority-action timeline.
2. Add a **liveness/uptime projection**: ingest block `last_commit` signatures, maintain a
   temporal cons-addr→slot map from coreslot events, and compute per-slot signed/missed per
   window. Surface N-of-N halt risk for monitors.
3. Add a static **"How this network works"** explainer page and an **onboarding** page that
   renders live `coreslot Params` (min/max slots, weights, open slots) + current reward-per-
   slot + the register→activate flow.
4. Add an **authority-action log** page from the lifecycle/param-change projections
   (suspensions with `reason`, param updates with authority).
5. Add **bech32 `valcons` decode** at the consensus-address boundary (the deferred branch in
   Fix 3) so operator self-service paste works.
6. Add a **tokenomics view**: emitted vs max supply, supply-threshold halving progress (from
   `NextHalving`/`SupplySchedule`), per-epoch emission series.

Indexer hardening:
7. Add explicit **gap detection** (scan for missing heights / re-fetch) beyond forward-only
   cursor.
8. Add a **negative route-contract test** for the ClaimableRewards 400 and enforce
   "never bare-limit for recent epochs" in the rewards projection layer (force reverse or
   page-to-key) so the ascending trap can't be reintroduced by a caller.
9. Surface `last-applied-validators` and `current-epoch/active-blocks` (currently fetched but
   unmapped) on the network/rewards pages.

## Verification notes / limits

- All chain claims confirmed by reading `nyks-core` source (cited), not just the handoff:
  `query_server.go` guards/pagination/hex semantics, `events.go` consts, `rewards.proto`
  field numbers, `rest-routes.md`.
- I did **not** run the explorer or hit a live node; Part A findings are from reading
  `packages/chain-client/src/*` and the test file. The fixes are verified at the
  source/contract level.
- Part B "Covered (design)" rows for rewards/coreslot projections and pages reflect the
  **design docs**; only generic ingestion is implemented (Phases A/B). Page-list gaps are
  read from `explorer-implementation-roadmap.md:89` nav and the per-phase page lists; if a
  page is planned but not in those lists I marked it Missing/Partial and said so.
