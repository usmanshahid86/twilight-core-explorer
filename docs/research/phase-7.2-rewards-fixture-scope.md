# Phase 7.2 — Live Rewards-Claim Fixture — Scope

**Status: Scope (no implementation).** Date: 2026-06-27. Goal: produce a localnet with a **finalized
claimable epoch + a real claim**, ingested into the explorer DB, so the Phase 12 rewards/supply
surfaces have **real data** to build and validate against (today they return `200 []`).

## 1. What 7.2 must produce (acceptance)

The explorer's Phase 9d endpoints must return populated, correct data:
- `/api/v1/rewards/epochs` — ≥1 **finalized** epoch (`totalReward`, `denom`, `activeSlotCount`).
- `/api/v1/coreslots/{slotId}/rewards` — that epoch's per-slot reward with **`claimed:true`** +
  `claimedAtHeight` + `claimTxHash`.
- `/api/v1/rewards/claims` — the **claim event** (slotId, claimant, amount, startEpoch/endEpoch, txHash).
- `/api/v1/supply` — total supply reflecting the **emission**.
- `/api/v1/rewards/balances` — the sampled rewards-module balance.

## 2. What nyks-core already gives us (the keystone)

`~/Github/nyks-core` has a complete rewards harness — **we do not build claim mechanics from scratch**:
- `scripts/localnet/rewards-smoke.sh` (`make localnet-rewards-smoke`) — a **self-contained proof**:
  inits a 4-node localnet with a short epoch (`REWARDS_EPOCH_LENGTH`, default 10), waits for epoch 1 to
  **finalize**, submits a **real claim** (`twilightd rewards claim 1 1 1 --from operator1`), asserts
  emission/accounting, then **stops + exports + tears down**.
- `scripts/localnet/rewards-soak.sh` (`make localnet-rewards-soak`) — the parameterized soak harness
  (env: `SOAK_DURATION`, `EPOCH_LENGTH`, `PREMINE`, `CHAOS`) with **periodic claim/pause/param/restart
  drills** → multiple finalized epochs + multiple claims. Design: `nyks-core/docs/research/
  x-rewards-soak-harness-design.md`.
- Mechanics confirmed: emission/epoch = `EPOCH_LENGTH × 416190` (SUBSIDY); per-slot = emission / 4;
  claim moves balances, never changes supply. Genesis knob: `app_state.rewards.params.epoch_length_blocks`.
- Claim CLI: `twilightd rewards claim <slotId> <startEpoch> <endEpoch> --from operatorN`. Queries:
  `twilightd rewards-query {epoch-info,epoch-reward,slot-rewards,claimable,module-balances,
  cumulative-emitted,supply-schedule,params}`.

## 3. The gap (why we adapt, not just run)

`rewards-smoke.sh` is a *pass/fail proof*, not an explorer fixture:
1. **It tears the chain down** (`trap stop.sh EXIT` + final `stop.sh`) — our indexer can't ingest a dead
   chain.
2. **It exposes only RPC (26657) + gRPC (9090), NOT REST.** `init.sh` configures gRPC but never sets
   `api.enable`/`:1317`. Our indexer needs **RPC** for the rewards *events* (epochs/claims/slot-rewards —
   the core Phase 12 data, ingested from `/block_results`) **and REST (1317)** for the *sampled*
   supply/balances projections.

So we need a **targeted fixture run** adapted from the harness: short epoch + **REST enabled on node0** +
finalize ≥1 epoch + ≥1 claim + **leave the chain running** (or ingest-then-stop) on RPC 26657 / REST 1317.

## 4. Plan — Part A: the chain fixture (nyks-core)

A small script (e.g. `scripts/localnet/rewards-fixture.sh`) derived from `rewards-smoke.sh`:
1. `init.sh` (4 nodes) + set `epoch_length_blocks` short (e.g. 10–20) in each genesis (as smoke does).
2. **Enable REST on node0:** in `node0/config/app.toml` set `[api] enable = true`, `address =
   "tcp://0.0.0.0:1317"`, `swagger = true` (one extra `sed`, mirroring the existing gRPC `sed`). RPC
   node0 already on 26657 (matches the explorer's `COMET_RPC_URL`).
3. `start.sh` and **drop the teardown trap** (or run the soak with a duration).
4. Drive ≥1 — ideally **2–3** — epoch finalizations and **1–2 claims** (e.g. `rewards claim 1 1 1`,
   then a later `rewards claim 2 2 2`) so the rewards pages have several rows. Optionally let it run a
   few more epochs for liveness richness.
5. **Leave it running** (RPC 26657 + REST 1317), print the height range + chain-id + claim tx hashes.
   (Alternative: ingest during the run, then stop — but leaving it up is simpler for iterative dev.)

## 5. Plan — Part B: ingest into the explorer (twilight-core-explorer)

With the localnet up (`COMET_RPC_URL=http://127.0.0.1:26657`, `REST_URL=http://127.0.0.1:1317`):
1. **Ingest the range:** `START_HEIGHT=1 END_HEIGHT=<final> DATABASE_URL=… npm --prefix apps/indexer run
   start`.
2. **Project (order matters — CLAUDE.md):** `project:coreslot-semantic` (metadata→lifecycle→payout→
   params→key_rotation→temporal_map) → the **genesis temporal-map seed** (per
   [[coverage-truth-genesis-gap]], required before liveness) → liveness (8a/8b/8c) → **`project:rewards`
   → `project:rewards-snapshot` → `project:balance-snapshot`**.
3. **Boot the API** against that DB and verify §1 acceptance.

## 6. Fixture DB decision (recommend)

The rewards localnet is a **new chain** (`twilight-rewards-localnet-1`) distinct from the current fixture
(`twilight_explorer`, 3196 blocks, CoreSlot/liveness-rich, **no rewards**). Two paths:
- **A — new canonical fixture (recommended target):** run the localnet long enough (a few epochs +
  liveness) and **rebuild `twilight_explorer`** from it → one fixture that has *everything incl.
  rewards*. Cost: re-run the full projection sequence (incl. genesis seed); re-eyeball existing pages
  (web tests are mocked, so unaffected).
- **B — separate rewards DB (fast unblock):** ingest into `twilight_explorer_rewards` and point the API
  there for Phase 12 dev/validation; keep the current fixture for everything else. Lower risk, two DBs.

Recommend **B to unblock Phase 12 quickly**, then **A** as the durable consolidation once Phase 12 is
built (so the canonical fixture is rewards-complete).

## 7. Concrete acceptance numbers (EPOCH_LENGTH=10, after claiming slot 1 / epoch 1)

emission/epoch = `10 × 416190 = 4,161,900` utwlt · per-slot = `1,040,475` · module balance after claim =
`3,121,425` · supply after finalize = `2×1e12 + 4,161,900 = 2,000,004,161,900`. Map: `/rewards/epochs`
epoch 1 totalReward 4,161,900; `/coreslots/1/rewards` amount 1,040,475 claimed:true; `/supply`
2,000,004,161,900; `/rewards/claims` the claim row.

## 8. Risks / notes

- **REST must be enabled** or supply/balances samples stay empty (rewards epochs/claims still populate
  from RPC). This is the one required nyks-core change.
- **Genesis seed:** liveness pages need the height-1 temporal-map seed on re-ingest ([[coverage-truth-
  genesis-gap]]).
- Claim signer ≠ payout in the smoke (`operator1` signs, `operator0` is paid) — `/rewards/claims`
  `claimant` is the signer; the explorer must not assume signer == payout.
- This is a backend/chain-fixture task (nyks-core + indexer), **not web work** — Phase 12 web resumes
  after the fixture exists.

## 9. Recommended next steps

1. Adapt `rewards-smoke.sh` → `rewards-fixture.sh` (REST on, no teardown, 2–3 epochs + 1–2 claims).
2. Ingest + project into a fresh DB (path B); verify §1 acceptance.
3. Re-evaluate the `gated_by_phase_7_2` caveats against the now-live evidence (do they soften, or stay?).
4. Resume Phase 12 (12b rewards hub) against real data.
