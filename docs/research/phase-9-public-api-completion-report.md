# Phase 9 — Public API — Completion Report (canonical)

**Status: COMPLETE.** Date: 2026-06-26. Tag: `explorer-phase-9-public-api`.

This is the canonical close-out for Phase 9 (the public REST/OpenAPI API) and the stable contract
Phase 10/Web builds against. Per-slice detail lives in the 9a/9b/9c/9d-0/9d reports; this index is the
single source of truth for *what the API surface is*. The machine-readable contract is
`docs/reference/openapi.json` — if this doc and the spec ever disagree, **the spec wins**.

## 1. Scope completed

A strictly **DB-only** Fastify v5 + TypeBox service (`apps/api`) that reads materialized Postgres rows
and serves them; it recomputes nothing and reads no chain. Delivered across five merged slices:

- **9a — Foundation:** server/plugin wiring, error envelope, keyset pagination, health/status/blocks.
- **9b — Generic explorer:** txs, accounts, search, decode-failures, projections diagnostics.
- **9c — CoreSlot / validator / liveness:** CoreSlot lifecycle + sub-resources, liveness/health, network.
- **9d-0 — Indexer (pre-req):** `balance_snapshot_v1` materializing supply + per-address balances.
- **9d — Rewards / supply / account-balances:** rewards domain + sampled supply/balance surfaces.

**32 GET operations** documented in OpenAPI; `apps/api` suite **114 tests / 114 pass**.

## 2. Endpoint inventory (32, all `GET`)

Envelopes (locked, uniform): list → `{ data, page: { limit, nextCursor } }`; detail → `{ data }`;
error → `{ error: { code, message, details? } }`. All heights/amounts/BigInt are **strings**.

**Health/liveness (2):** `/health/live`, `/health/ready` (ready = DB reachable + no failed migrations).
**Foundation (3):** `/api/v1/status`, `/api/v1/blocks`, `/api/v1/blocks/{height}`.
**Generic (8):** `/api/v1/txs`, `/txs/{hash}`, `/accounts`, `/accounts/{address}`, `/search`,
`/decode-failures`, `/projections`, plus `/accounts/{address}/balances` (9d, sampled subresource).
**CoreSlot (9):** `/coreslots`, `/coreslots/{slotId}`, `/{slotId}/events`, `/{slotId}/windows`,
`/{slotId}/key-rotations`, `/{slotId}/liveness`, `/{slotId}/health`, `/{slotId}/proposed-blocks`,
`/{slotId}/rewards`.
**Network (3):** `/network/validator-set`, `/network/proposers`, `/network/liveness-risk`.
**Rewards/supply (7):** `/rewards/epochs`, `/rewards/epochs/{epoch}`, `/rewards/claims`,
`/rewards/balances`, `/rewards/params`, `/rewards/treasury-payments`, `/supply`.

## 3. DB-only invariants (the contract that must not regress)

- **No transport.** No `ChainClient`, `loadConfig`, RPC/REST/gRPC, or `fetch`/`http`/`undici`. A static
  no-chain guard test scans `apps/api/src` for these usages and fails the build if reintroduced.
- **No recomputation.** The API serves materialized rows only; all semantics are produced by the
  indexer/projectors upstream. Adding a projection means an indexer phase, never API-side derivation.
- **Observed-sample honesty.** Supply and account balances are `source:"sampled"` + `sampledAtHeight`;
  **absence is never a fabricated zero** (`/accounts/:address/balances` returns `sampled:false` when no
  sample exists). Account balances are scoped to the address's **latest** `sampledAtHeight` so one
  response never mixes snapshot heights.
- **Claims are history, not live truth.** No live `ClaimableRewards`. Claim/economics surfaces carry
  machine-readable `productionClaimReadiness:"gated_by_phase_7_2"` + `claimSemantics`; epochs carry
  `rewardSemantics:"aggregate_projection"`. These are **in-data fields**, not envelope changes.
- **Hardened inputs.** Every numeric path/query/cursor part goes through int64-bounded, length-capped
  `parseUint64` (overflow → clean `400`, never a Postgres 500). Cursors are strict base64url with a
  canonical round-trip check; list endpoints use N+1 lookahead so a full final page emits
  `nextCursor:null`; composite cursors push the predicate per source (no deep-pagination skips).

## 4. Projection dependencies (API surface → backing rows)

Every endpoint reads materialized rows only. Mapping (from the repositories):

| API surface | Backing models / projection |
|---|---|
| blocks, txs, accounts, decode-failures | `Block`, `ExplorerTransaction`, `Message`, `Event`, `Account`, `DecodeFailure` (generic canonical) |
| search | `Block`, `ExplorerTransaction`, `Account`, `CoreSlotProjection` |
| status, projections | `IndexerCursor`, `ProjectionCursor`, `ProjectionFailure` |
| coreslots + lifecycle/metadata/payout/key-rotation/windows | `CoreSlotProjection`, `CoreSlotLifecycleEvent`, `CoreSlotMetadataChange`, `CoreSlotPayoutChange`, `CoreSlotConsensusKeyRotation`, `CoreSlotConsensusWindow` (6a/6b semantic + temporal map) |
| coreslot liveness / health | `CoreSlotLivenessSummary` (8c-2), `CoreSlotHealthSnapshot` (8c-3) |
| network (validator-set / proposers / liveness-risk) | `CoreSlotConsensusWindow`, `BlockProposerAttribution` (`proposer_attribution_v1`), `NetworkLivenessRiskSnapshot` (8c-3) |
| blocks proposer / coreslot proposed-blocks | `BlockProposerAttribution` |
| rewards (epochs/claims/balances/params/treasury) + coreslot rewards | `RewardEpochProjection`, `SlotRewardProjection`, `RewardClaimEvent`, `RewardsBalanceSample`, `RewardsParamsChange`, `RewardsTreasuryPayment` (`rewards_semantic_v1`) |
| supply, account balances | `RewardsBalanceSample('supply')` + `AccountBalanceCurrent` (`balance_snapshot_v1`, observed sample) |

## 5. Validation commands

```sh
npm install && npm run db:generate
npm run typecheck                      # all workspaces, strict
npm --prefix apps/api run build
npm --prefix apps/api test             # 114/114
npm --prefix apps/api run openapi:check # spec drift gate ("up to date", 32 paths)
npm run lint                           # NOTE: currently a no-op (real linter deferred to 13)
npm --prefix apps/indexer test         # 258 pass
npm --prefix packages/chain-client test # 16/16
git diff --check                       # whitespace
```

The no-chain guard runs inside `apps/api test`. OpenAPI is regenerated from the route schemas and
`openapi:check` fails CI on drift — regenerate on any route/schema change.

## 6. Tags / PRs

| Slice | PR | Tag |
|---|---|---|
| 9a foundation | #7 | — |
| 9b generic explorer | #9 | — |
| 9c CoreSlot/validator/liveness | #11 | — |
| 9d-0 balance/supply snapshot (indexer) | #13 | — |
| 9d rewards/supply/account-balances | #15 | — |
| **Phase 9 milestone (checkpoint commit)** | — | **`explorer-phase-9-public-api`** |

Prior milestone for reference: `explorer-phase-8-liveness-backend`.

## 7. Known limitations

- **Phase 7.2 open** — claims/economics are history/observed only and wear the
  `gated_by_phase_7_2` caveat until a live claim fixture proves claimable-now semantics.
- **Claims `address` filter = `claimant` only** (indexed); no `payoutAddress` scan (unindexed).
- **Account balances are current-only and bounded** to CoreSlot operator/payout addresses (per 9d-0);
  no history, no all-account coverage. Supply/balances are sampled at a height, not live.
- **Caveat fields repeat per row** (`productionClaimReadiness`/`claimSemantics`/`rewardSemantics`) to
  preserve the locked envelope — intentional redundancy.
- **Deferred to Phase 13 hardening:** rate limiting, security headers (helmet), cache-control/ETag, and
  a real linter (`npm run lint` is a no-op today).
- **Deferred search:** `twilightvalcons` bech32 lookup (needs a pure bech32 dep); `/network/params`.

## 8. Phase 10 / Web handoff

The API is a **frozen contract** for the web build. Recommended starting posture:

- **Source of truth:** consume `docs/reference/openapi.json`; generate a typed TS client from it
  (openapi-typescript) so any API change becomes a web-side type error. Do not hand-write request types.
- **Pagination:** keyset only — pass back `page.nextCursor` opaquely; never synthesize cursors. A
  `null` `nextCursor` means end-of-list. Map to an infinite-query pattern.
- **Strings, not numbers:** heights/amounts/IDs are strings (int64/BigInt safe) — keep them strings in
  the UI; format at render, never `Number()` them.
- **Render observed-sample honesty:** show `sampledAtHeight` next to supply/balances; render
  `sampled:false` as "no sample," not "0". Surface the claim/rewards caveats
  (`productionClaimReadiness`, `claimSemantics`, `rewardSemantics`) rather than hiding them — the UI
  must not present gated claim data as production-ready.
- **Error handling:** branch on `error.code` (e.g. `invalid_cursor`, `invalid_epoch`, `invalid_slot_id`,
  `not_found`), not on message text.
- **Scope split:** Phase 10 = generic shell + pages over 9a/9b (dashboard, blocks, txs, accounts,
  search, status, supply/network); Phase 11 = Twilight-specific pages over 9c/9d (CoreSlot lifecycle,
  liveness/health, validator/network, rewards) — including the north-star operator view.
- **Before/with the rewards UI:** sequence **Phase 7.2** so reward pages can drop the caveat instead of
  shipping it.

**Phase 9 Public API: COMPLETE — stable contract for Phase 10.**
