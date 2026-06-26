# Phase 9d — Rewards, Supply & Account-Balance API — Implementation Report

**Status: COMPLETE** (implemented, tested, live-validated against the fixture DB)

Date: 2026-06-26

The final API slice: exposes the rewards domain plus the 9d-0 sampled supply/balances through the
strictly DB-only public API. Nothing is recomputed; nothing is read live. Claims are history-only and
the Phase-7.2 gate is surfaced as in-data caveat fields; supply comes only from
`RewardsBalanceSample('supply')` (never summed); account balances come only from
`AccountBalanceCurrent` (current, bounded, sampled). OpenAPI now documents **32 paths**.

## 1. Endpoints shipped (9 new)

- `GET /api/v1/supply` — latest (or `?height=`) sampled supply; `?denom=`; `source:"sampled"` + `sampledAtHeight`.
- `GET /api/v1/accounts/:address/balances` — current sampled balances (subresource; `/accounts/:address` unchanged).
- `GET /api/v1/rewards/epochs`, `/rewards/epochs/:epoch` — aggregate epochs (+ `rewardSemantics:"aggregate_projection"`).
- `GET /api/v1/coreslots/:slotId/rewards` — per-slot rewards (+ observed-claim caveats).
- `GET /api/v1/rewards/claims` — claim history only (+ history caveats).
- `GET /api/v1/rewards/balances` — rewards/module balance samples (supply excluded by default).
- `GET /api/v1/rewards/params`, `/rewards/treasury-payments` — event history.

## 2. Files changed

New (`apps/api/src`):
- `dto/rewards.ts` (epoch/slot-reward/claim/balance/params/treasury DTOs + caveat constants + mappers),
  `dto/balances.ts` (supply + account-balance DTOs + mappers).
- `repositories/rewards-repository.ts`, `repositories/balances-repository.ts`.
- `routes/rewards.ts`, `routes/balances.ts`.
- `lib/slot-id.ts` — **extracted** shared `parseSlotId` (was private in `routes/coreslots.ts`).

Changed:
- `routes/coreslots.ts` — now imports the shared `parseSlotId` (local copy removed; no duplication).
- `server.ts` — register `rewardsRoutes`, `balancesRoutes`.
- `test/mock-prisma.js` — rewards models, supply/account-balance reads, fixture factories.
- `docs/reference/openapi.json` — regenerated (32 paths, tracked).

New tests: `test/rewards.test.js`, `test/balances.test.js`.

## 3. Locked decisions honored

- **Q1 caveat (in-data fields, envelope unchanged):** each `ClaimItem` and `SlotRewardItem` carries
  `productionClaimReadiness:"gated_by_phase_7_2"`; claims add `claimSemantics:"event_history_only"`,
  slot rewards add `claimSemantics:"projection_observed_not_live_claimable"`; epochs carry
  `rewardSemantics:"aggregate_projection"`. List/detail envelopes stay `{ data, page }` / `{ data }`.
- **Supply:** only `RewardsBalanceSample('supply')`; latest = `max(height)` supply rows; `?height=H`
  exact (404 if none); never summed from balances; `source`/`sampledAtHeight` included; amounts strings.
- **Account balances:** only `AccountBalanceCurrent`; subresource; `/accounts/:address` untouched;
  unsampled → `200 { sampled:false, sampledAtHeight:null, balances:[] }` (never a fabricated zero).
- **Epochs:** `RewardEpochProjection`; epochNumber-DESC keyset; invalid → `400 invalid_epoch`; missing →
  `404`; `include=raw` detail-only; not presented as claimable truth.
- **CoreSlot rewards:** 9c-consistent slot semantics (`400 invalid_slot_id` / `404` / `200 empty`);
  `claimed`/`claimedAtHeight`/`claimTxHash` exposed as observed, with the caveats above.
- **Claims:** `RewardClaimEvent`, history-only; filters `slotId/claimant/txHash/fromHeight/toHeight`
  (no `payoutAddress` scan); composite keyset `(height DESC, id DESC)`.
- **Rewards balances:** `RewardsBalanceSample`; **excludes `supply` by default**; `?sampleKind=supply`
  opts in; `source:"sampled"`.
- **Params/treasury:** `RewardsParamsChange` / `RewardsTreasuryPayment`, id-DESC keyset, history only.
- **Numerics:** every numeric path/query/cursor part via `parseUint64` (int64-bounded, length-capped) →
  clean `400`, never a Postgres 500. **No live reads; no chain-client; no projection recompute.**

## 4. Endpoint examples (live, fixture DB @ 3196)

```
GET /api/v1/supply
{ "data": { "sampledAtHeight":"3196", "source":"sampled",
            "supply":[{ "denom":"utwlt", "amount":"2000000000000" }] } }

GET /api/v1/accounts/twilight1m7674p4…/balances   (sampled operator)
{ "data": { "address":"twilight1m7674p4…", "sampled":true, "sampledAtHeight":"3196",
            "source":"sampled", "balances":[{ "denom":"utwlt", "amount":"1000000000000" }] } }

GET /api/v1/accounts/twilight1nobody/balances     (unsampled)
{ "data": { "address":"twilight1nobody", "sampled":false, "sampledAtHeight":null,
            "source":"sampled", "balances":[] } }

GET /api/v1/rewards/balances    (supply excluded by default)
{ "data":[{ "sampleKind":"cumulative_emitted", "source":"sampled", "denom":"utwlt", "amount":"0", … }],
  "page":{ "limit":50, "nextCursor":null } }
```
Negatives (live): `/supply?height=1` → 404; `/rewards/epochs/abc` → 400 `invalid_epoch`;
`/coreslots/99999/rewards` → 404; `/rewards/claims?slotId=<int64 overflow>` → 400.

## 5. Tests added & validation

`apps/api` suite: **113 tests / 113 pass / 0 fail** (was 86; +27). New coverage: epochs list/detail/
raw/404/invalid_epoch/int64-overflow; coreslot rewards 400/404/200-empty + observed-claim caveats;
claims height/id composite cursor + slotId filter + history caveat + int64-overflow filter; rewards
balances supply-excluded-by-default + `?sampleKind=supply`; params changeType filter + treasury
ordering; supply latest/`?height`/`?denom`/404/int64-overflow/amount-string/source; account balances
sampled-true vs unsampled (no fabricated zero). All 9a/9b/9c tests preserved; OpenAPI drift green;
no-chain guard auto-covers the new files.

Ritual (all green): `db:generate`, `typecheck` (all workspaces), `build`, `npm --prefix apps/api test`
113/113, `openapi:check` "up to date" (32 paths), `npm run lint`, `apps/indexer` 258 pass,
`chain-client` 16/16, `git diff --check` clean, NUL scan clean.

## 6. Live validation output

Materialized rewards + balance rows (`project:rewards`, `project:rewards-snapshot`,
`project:balance-snapshot`), then booted the API against the fixture DB. `/supply` returned
`utwlt=2000000000000 @3196` (matches the supply sample); `/accounts/<funded operator>/balances`
returned `utwlt=1000000000000` (matches `AccountBalanceCurrent`); an unsampled address returned
`sampled:false`/empty; `/rewards/balances` excluded supply; rewards epochs/claims/slot-rewards returned
`200 []` (the fixture has no finalized epochs/claims — minimal rewards activity); the negative paths
returned the expected 400/404.

## 7. Known limitations

- **Empty rewards surfaces on the fixture** — the localnet fixture has no finalized epochs or claim
  events, so epochs/claims/slot-rewards are exercised live only as `200 []`; populated behavior is
  covered by the mock tests.
- **Claims `address` filter is `claimant` only** (indexed); a `claimant ∪ payoutAddress` scan is
  deliberately not implemented (payoutAddress is unindexed).
- **Account balances are current-only and bounded** (operator/payout, per 9d-0); no history, no
  all-account coverage.
- **Caveats are constant per-item fields** — `productionClaimReadiness`/`claimSemantics`/
  `rewardSemantics` repeat on every row to keep the locked `{ data, page }` envelope; that redundancy
  is intentional.

## 8. Phase 7.2 claim caveat

This phase exposes **no live claimable rewards**. `RewardClaimEvent` is historical; `SlotRewardProjection.
claimed` is an observed/sampled flag, not "claimable now." Both surfaces carry
`productionClaimReadiness:"gated_by_phase_7_2"` (machine-readable, in-data), so clients can detect that
claim/economics data is not production-ready until Phase 7.2 (live claim fixture) passes. No
`/rewards/status` endpoint and no envelope change were introduced.

## 9. Next steps

- Force-add nothing new (no migration); `docs/reference/openapi.json` already tracked → plain `git add`.
- With 9d complete, **the public API surface for Phase 9 is finished** (9a foundation, 9b generic, 9c
  CoreSlot/validator/liveness, 9d rewards/supply). Remaining roadmap: Phase 10 web foundation, Phase 11
  Twilight pages, Phase 12 onboarding, Phase 13 hardening (incl. the deferred API rate-limit/helmet/
  ESLint and Phase 7.2 live claims).

**Phase 9d Rewards/Supply API: COMPLETE**
