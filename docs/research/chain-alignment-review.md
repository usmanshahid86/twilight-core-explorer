# Chain Alignment Review — twilight-core-explorer vs. Twilight chain

Date: 2026-06-24
Reviewer scope: READ-ONLY. Compares the explorer design + implementation reports in
`docs/research/*.md` and the implemented packages (`packages/chain-client`,
`packages/decoder`, `packages/proto`) against the verified chain source in
`<path-to-nyks-core>`. Every chain claim below was checked against code, not
only against the handoff.

Ground-truth reference: `nyks-core/docs/reference/explorer-integration-handoff.md`.

Severity legend: BLOCKER (will return wrong/empty data or 4xx in normal use) /
MAJOR (data correctness or robustness gap that bites in production) /
MINOR (cosmetic, doc, or low-frequency) / NOTE (informational / chain-side suggestion).

---

## Executive summary (top issues by severity)

1. **BLOCKER — `getClaimableRewards` cannot pass the required epoch range.** The interface
   and the REST call omit `start_epoch` & `end_epoch`, which the chain hard-requires; the
   route returns HTTP 400 every time.
2. **MAJOR — Consensus-address lookup does not enforce/normalize HEX.** The handler forwards
   the raw string; a bech32 `valcons` (the natural thing to pass from a Cosmos validatorset)
   produces a `encoding/hex: invalid byte` error from the keeper. No guard, no doc.
3. **MAJOR — The `SlotRewards` ascending-pagination trap is undocumented and unmitigated.**
   `getSlotRewards(slotId)` issues a single page with no key/limit handling. For recent-epoch
   claim status this silently drops the newest epochs once the chain exceeds one page.
4. **MAJOR — "Claimed" semantics not modelled from ClaimRecords / ClaimableRewards filtering.**
   Design treats `SlotRewards` + `claimable` as interchangeable claim sources; in reality
   `ClaimableRewards` returns ONLY unclaimed records (empty ⇒ claimed). The data model's
   `RewardClaim.claimed` boolean has no documented derivation rule.
5. **MINOR/NOTE — Design still recommends `buf` + `ts-proto`/Telescope as the production path**
   while the chain ships only a descriptor set. The implemented decoder (descriptor-backed) is
   correct; the lingering "production = generated TS" recommendation contradicts the handoff
   and the shipped approach.

The architecture is otherwise well-aligned: no staking/gov/mint/distribution models, correct
Msg type URLs, correct REST route strings (including `active-slots`), descriptor-based
decoding with the correct TxRaw→TxBody→Any flow, halving via `next-halving`, amounts as
strings in `utwlt`. Details and citations below.

---

## Issues

### 1. BLOCKER — ClaimableRewards omits the required `start_epoch` / `end_epoch`

- **Explorer claim/impl:**
  - Interface: `getClaimableRewards(slotId: bigint): Promise<ModuleSnapshot>`
    (`packages/chain-client/src/types.ts:24`) — no epoch-range parameters.
  - Impl: `getClaimableRewards` builds only the path with `slot_id` and passes no query
    (`packages/chain-client/src/rest-rpc-client.ts:251-255`).
  - The architecture proposal's interface draft has the same signature
    (`docs/research/explorer-architecture-proposal.md:148`). The handoff's requirement is
    not mentioned in any design doc (no occurrence of `start_epoch`/`end_epoch`).
- **Chain reality:** `ClaimableRewards` rejects a request with
  `req.StartEpoch == 0 || req.EndEpoch < req.StartEpoch` →
  `status.Error(codes.InvalidArgument, "invalid slot id or epoch range")`
  (`nyks-core/x/rewards/keeper/query_server.go:99-100`). The REST route documents these as
  **required** query params, "400 if range missing/invalid"
  (`nyks-core/docs/reference/rest-routes.md:25`).
- **Impact:** Every call returns HTTP 400. The explorer cannot read claimable rewards at all
  through this method — the primary "is this slot-epoch claimed?" source is unusable.
- **Fix:** Change the interface to
  `getClaimableRewards(slotId, startEpoch, endEpoch)` and append
  `start_epoch`/`end_epoch` as query params in the REST call. Drive the range from the
  indexer's known finalized-epoch window (e.g., `[1, currentFinalizedEpoch]` or a sliding
  window). Add a route-contract test asserting a 400 when params are missing so this can't
  regress.

### 2. MAJOR — Consensus-address lookup does not enforce HEX

- **Explorer claim/impl:** `getCoreSlotByConsensusAddress(consensusAddress: string)` forwards
  the string verbatim into the path (`packages/chain-client/src/rest-rpc-client.ts:199-204`);
  interface at `packages/chain-client/src/types.ts:14`. The design notes consensus addresses
  exist but never states the hex-not-bech32 constraint (handoff §2 footgun absent from all
  design docs). The data model stores `consensusAddress String?` with no encoding note
  (`docs/research/explorer-data-model.md:247`).
- **Chain reality:** `consensus_address` is **hex** on both
  `consensus/{consensus_address}` and `reserved-consensus-address/{consensus_address}`
  (`nyks-core/docs/reference/rest-routes.md:40,43`); handoff §2 (lines 38-41) confirms the
  keeper rejects bech32 with `encoding/hex: invalid byte`, and the valid hex value comes from
  CometBFT `/validators[].address`.
- **Impact:** A caller passing the bech32 `valcons` (the obvious value from
  `cosmos/base/tendermint/.../validatorsets`) gets a hard error, and the explorer's
  validator→slot correlation silently fails. Likely to bite whoever wires the "Network" page.
- **Fix:** Document the hex contract on the method and the `CoreSlot.consensusAddress` field;
  derive the lookup key from CometBFT `/validators[].address` (already hex). Optionally
  validate/normalize input (reject `twilightvalcons…`, or convert) before issuing the request.

### 3. MAJOR — SlotRewards ascending-pagination trap unmitigated

- **Explorer claim/impl:** `getSlotRewards(slotId)` issues a single un-paginated request
  (`packages/chain-client/src/rest-rpc-client.ts:247-249`). Design instructs "Use rewards REST
  `slot-rewards` and `claimable` responses to populate claim records"
  (`docs/research/explorer-architecture-proposal.md:376-379`,
  `docs/research/explorer-data-model.md:404`) without any pagination-direction caveat. No
  design doc mentions the trap (no `ascending`/`page to the key` occurrences).
- **Chain reality:** `SlotRewards` is keyed `(slotID, epoch)` and "prefix by slot yields
  **ascending** epoch order" (`nyks-core/x/rewards/keeper/query_server.go:83`). Handoff §5
  (lines 97-100) flags this exact bug: a fixed-limit single page drops the most recent epochs
  once the chain exceeds one page — it produced false soak failures.
- **Impact:** For recent-epoch claim/reward state, the newest epochs are dropped past page 1.
  The explorer would under-report or mis-state recent claims. This is correctness, not just
  performance.
- **Fix:** Either (a) page through to the end / page-to-key when reading recent state, or
  (b) for targeted recent-epoch questions use `ClaimableRewards` with an explicit recent
  range (after fixing issue 1). Normalize pagination in `packages/chain-client` with a
  fixture test, as the design's own risk table (`explorer-api-surface-refresh.md:131`) already
  recommends — but currently does not implement.

### 4. MAJOR — "Claimed" status not derived from ClaimRecords / claimable filtering

- **Explorer claim/impl:** `RewardClaim.claimed Boolean` with sources listed as
  "`EpochReward` and `SlotRewards`" + `reward_claimed` event
  (`docs/research/explorer-data-model.md:373-407`). The model treats `claimable` and
  `slot-rewards` as parallel claim sources without stating how `claimed` is computed.
- **Chain reality:** Authoritative claim status lives in **ClaimRecords**; `ClaimableRewards`
  returns **only UNCLAIMED** records (claimed ones are filtered out) — empty ⇒ claimed or none
  (handoff §5 lines 101-105). The `EpochReward` snapshot's embedded rewards are NOT the claim
  source of truth (handoff §5 line 104). `IterateClaimRecordsForSlot` backs both surfaces
  (`nyks-core/x/rewards/keeper/query_server.go:102`).
- **Impact:** If the indexer infers `claimed=false` from presence in `claimable`, it is
  correct only by accident; if it infers claim status from `EpochReward.rewards`, it will be
  wrong. Ambiguity here yields inconsistent claim pages.
- **Fix:** Define the rule explicitly: `claimed` is true when a `(slot,epoch)` record exists in
  `SlotRewards`/ClaimRecords but is absent from `ClaimableRewards` for the same range; or set
  `claimed=true` on observing a `reward_claimed` event covering that epoch range. Document that
  `EpochReward` is a finalization snapshot, not claim truth.

### 5. MINOR — Production decoder recommendation contradicts chain reality (and the shipped impl)

- **Explorer claim:** "Production strategy: generated TypeScript protobuf types … using `buf`
  + `ts-proto` or Telescope" (`docs/research/explorer-data-model.md:623`,
  `explorer-architecture-proposal.md:276`, `explorer-api-surface-refresh.md:148-149`).
- **Chain reality:** "There is no buf / Telescope / ts-proto in the chain repo — only the
  descriptor set" (handoff §4 line 77). The chain only exports
  `docs/proto/twilight-descriptors.pb`.
- **Impact:** Low — the *implemented* decoder is descriptor-backed and correct
  (`phase-ab-5-tx-decoder-report.md`), so this is a stale recommendation, not a shipped bug.
  But it could mislead a future contributor into expecting upstream TS bindings.
- **Fix:** Update the design docs to make descriptor-backed decoding the production path (which
  it already is), and frame `buf`/`ts-proto` as an optional, explorer-side codegen choice that
  must be driven from the descriptor set / protos, not from any upstream chain TS package.

### 6. MINOR — `proposerCoreSlotId` / proposer mapping assumes a resolvable proposer→slot link

- **Explorer claim:** `Block.proposerCoreSlotId BigInt?` and index on it
  (`docs/research/explorer-data-model.md:33,47`).
- **Chain reality:** Block proposer addresses come from CometBFT (hex consensus address). The
  only way to map proposer→slot is `CoreSlotByConsensusAddress` (hex) — i.e., it depends on
  issue 2 being correct. There is no direct proposer→slot query.
- **Impact:** Low/structural — fine as a nullable projection, but it cannot be populated unless
  the hex consensus-address lookup (issue 2) works.
- **Fix:** Populate `proposerCoreSlotId` via the (hex) consensus-address join, and leave null
  when no active slot matches (e.g., after removal). Note the dependency in the data-model doc.

### 7. NOTE — `epoch_finalized` attribute coverage in the projection

- **Explorer claim:** `RewardEpoch` carries `carryIn`, `distributableFees`, `remainderPolicy`
  (`explorer-data-model.md:342-350`).
- **Chain reality:** The emitted `epoch_finalized` event carries `epoch`, `start_height`,
  `end_height`, `minted_emission`, `cumulative_emitted`, `reward_pool`, `allocated`,
  `carry_out`, `eligible_slots`, `distribution_method`
  (`nyks-core/x/rewards/keeper/events.go:17-27`). Several modelled fields (`carry_in`,
  `distributable_fees`, `remainder_policy`) are NOT event attributes.
- **Impact:** None if those fields are sourced from the `EpochReward` REST snapshot rather than
  the event. Just ensure the projection does not expect them on the event itself.
- **Fix:** Document which `RewardEpoch` fields come from the event vs. the `EpochReward`
  snapshot, so event-only reindex paths don't leave them spuriously null/blank.

---

## What the design got RIGHT (balanced view)

- **No staking/gov/mint/distribution models or routes.** Explicit non-goals and 501-as-expected
  posture are correct and repeatedly enforced (`explorer-data-model.md:9-17`,
  `explorer-architecture-proposal.md:198-207`, `explorer-old-repo-audit.md:79`). Matches
  handoff §1.
- **Validators sourced from CoreSlot + CometBFT, not staking.** "Active slots, not staking
  validators, are the explorer's operator set" (`explorer-architecture-proposal.md:330-331`).
  `/block_results` treated as mandatory for lifecycle events. Matches handoff §2.
- **Correct Msg type URLs** for all 9 coreslot + 4 rewards messages
  (`explorer-architecture-proposal.md:245-260`), verified against
  `nyks-core/x/{coreslot,rewards}/types/codec.go`.
- **Event projections match exactly** — all 12 coreslot and 7 rewards event-type strings are
  reproduced verbatim (`explorer-architecture-proposal.md:289-301,344-352`;
  `explorer-data-model.md:311-323,444-452`), matching
  `nyks-core/x/{coreslot,rewards}/types/events.go`. **No invented events** (no
  `reward_distributed`, `validator_jailed`, etc.).
- **Correct REST route strings**, including `active-slots` (not the colliding `slots/active`)
  and a route-contract test requirement against regression
  (`explorer-architecture-proposal.md:323`, `explorer-api-surface-refresh.md:98,176-179`;
  `packages/chain-client/src/routes.ts:23`). Matches handoff §5.
- **Halving by `next-halving` / supply schedule**, not block height
  (`explorer-architecture-proposal.md:366`, no block-height-halving language anywhere).
  Matches handoff §7.
- **Amounts as strings in `utwlt`**, display `TWLT = utwlt / 1_000_000`
  (`explorer-architecture-proposal.md:377-378`), and reward amounts are indeed `string` in the
  proto (`nyks-core/proto/twilight/rewards/v1/rewards.proto:24,28,29,45`).
- **Descriptor-backed raw-tx decode flow is correct**: `TxRaw → TxBody(body_bytes) →
  messages[] (Any) → resolve type_url`, copied from the chain's
  `docs/proto/twilight-descriptors.pb`, with decode failures recorded as non-halting data
  (`phase-ab-5-tx-decoder-report.md:18-24,113-163`). Matches handoff §4.
- **`reward_claimed` carries no tx hash** → indexer correlates `claimTxHash` from
  tx/messages/events (`explorer-architecture-proposal.md:379`,
  `explorer-data-model.md:406`). Correct: the event attributes are `signer, slot_id,
  start_epoch, end_epoch, amount, payout_count` (`nyks-core/x/rewards/types/events.go:14-20`),
  no hash.
- **N-of-N PoA liveness** acknowledged in the architecture framing (CoreSlot owns validator
  admission); the data model and dashboard avoid staking-style fault tolerance.

---

## Legitimate chain-side gaps the explorer exposes (suggestions for the chain)

1. **No descending / reverse pagination guarantee on `SlotRewards`.** Because it is strictly
   ascending by epoch, every consumer must page-to-end to read recent state. A `reverse` flag
   honored by the query (it may already via standard `pagination.reverse` — worth confirming
   in `query_server.go`) or a dedicated "latest N epochs for slot" query would remove the
   single most common indexing footgun.
2. **`reward_claimed` and lifecycle events omit the tx hash**, forcing every indexer to
   correlate. Not a bug (consensus state shouldn't store hashes), but a documented note that
   the hash must come from the tx envelope would save each integrator the rediscovery.
3. **No proposer→slot resolution helper.** Mapping a block proposer (hex consensus addr) to a
   slot requires `CoreSlotByConsensusAddress`, which fails after a slot is removed/rotated.
   A historical "consensus address → slot at height H" lookup would let explorers attribute
   historical blocks correctly.
4. **`ClaimableRewards` returning only-unclaimed is correct but implicit.** A boolean
   `claimed` field on `SlotRewards` rows (rather than requiring the absence-from-claimable
   inference) would make claim-status indexing unambiguous and remove a class of bugs.
5. **Consensus-address encoding (hex vs bech32) is a recurring trap.** Accepting (or
   error-messaging for) bech32 `valcons` on the consensus routes — or documenting it loudly in
   Swagger param descriptions — would prevent the most likely first-call failure.

---

## Verification notes / limits

- All chain claims above were confirmed by reading chain source (cited `file:line`), not only
  the handoff: codec type URLs, event-type/attribute consts, `query_server.go` pagination and
  InvalidArgument guards, rest-routes table, and the rewards proto string fields.
- I did **not** execute the explorer or hit a live node; implementation findings (issues 1-3)
  are from reading `packages/chain-client/src/{types.ts,routes.ts,rest-rpc-client.ts}`. The
  400 behavior for issue 1 is inferred from the keeper guard at
  `query_server.go:99-100` plus the route doc, which is unambiguous.
- I could not confirm whether `RestRpcChainClient.snapshot` passes through a caller-supplied
  query object for the rewards routes generally; the `getClaimableRewards` method as written
  passes none, which is the load-bearing fact for issue 1.
