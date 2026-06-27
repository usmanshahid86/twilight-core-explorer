# Phase 7.2 — Live Rewards-Claim Fixture + Projector Corrections — Implementation Report

**Status: PASS** (implemented, typechecked, linted, tested, built; validated live against the fixture).
Date: 2026-06-27. Diagnosis: [`phase-7.2-rewards-fixture-findings.md`](phase-7.2-rewards-fixture-findings.md).
Scope/runbook: [`phase-7.2-rewards-fixture-scope.md`](phase-7.2-rewards-fixture-scope.md) ·
[`phase-7.2-rewards-ingest-runbook.md`](phase-7.2-rewards-ingest-runbook.md). **Not committed/merged.**

## 1. Executive summary

The live rewards-claim fixture (`twilight-rewards-fixture-1`, ingested into `twilight_explorer_rewards`)
was the first time the rewards/identity projection layer saw **real** finalized-epoch + claim events. It
revealed the layer was written against an **assumed** event schema and had four concrete gaps (F1–F4).
All are fixed, regression-tested, and re-validated end-to-end through the Phase 9 API. The system never
fabricated state while broken — it degraded honestly via `ProjectionFailure`s, which is the
correctness-over-guessing invariant working.

## 2. Files changed

**New:**
- `apps/indexer/src/projections/coreslot-genesis-identity.ts` — `seedCoreSlotGenesisIdentity` (F1).
- `apps/indexer/test/projections/coreslot-genesis-identity.test.js` — genesis-seed suite (5 cases).
- `prisma/migrations/20260627000100_reward_epoch_emission_fields/migration.sql` — additive (D2).
- Docs: this report + `phase-7.2-rewards-fixture-findings.md` (+ scope/runbook from earlier in the phase).

**Modified:**
- `apps/indexer/src/projections/rewards-semantic.ts` — F2/F3 attribute mappings (+ fallbacks).
- `apps/indexer/src/projections/coreslot-metadata.ts` — invokes the genesis identity seed (F1 wiring).
- `apps/indexer/src/projections/coreslot-semantic-rebuild.ts` — threads `client`/`seedGenesis` to metadata.
- `apps/indexer/src/projections/rewards-snapshot.ts`, `balance-snapshot.ts` — pass sample height (F4).
- `packages/chain-client/src/{http.ts,rest-rpc-client.ts,types.ts}` — `x-cosmos-block-height` passthrough (F4).
- `prisma/schema.prisma` — `cumulativeEmitted` + `distributionMethod` on `RewardEpochProjection` (D2).
- `apps/api/src/dto/rewards.ts` — promote the two fields through `RewardEpochListItem`/`Detail` (D2).
- `docs/reference/openapi.json`, `apps/web/src/lib/api/generated/schema.d.ts` — regenerated contract/types.
- Tests: `rewards-semantic.test.js` (3a/3b real-key cases), `rest-rpc-client.test.js` (height-pin),
  `apps/api/test/{mock-prisma.js,rewards.test.js}` (fixture + new-field assertions).

## 3. What changed, per finding

- **F1 — genesis CoreSlot identity seed.** Genesis-created slots (`coreslot-genesis add`) emit no on-chain
  lifecycle events, so `CoreSlotProjection` stayed empty → the rewards snapshot enumerated 0 slots →
  `/coreslots/{id}/rewards` empty + `missing_reward_records` failures. The seed reads the **rebuildable**
  `getGenesis()` (NOT the live `getActiveCoreSlots()` sample, which would violate rebuildability) and
  writes the full identity baseline at height 1. Consensus-address derivation (sha256(pubkey)[:20]) and
  status normalization (`SLOT_STATUS_ACTIVE`→`ACTIVE`) match lifecycle/temporal-map so a genesis slot
  reconciles to one identity; later events upsert onto the same `slotId`.
- **F2 — `epoch_finalized` mapping.** `totalReward←allocated`, `activeSlotCount←eligible_slots`,
  `cumulativeEmitted←cumulative_emitted`, `distributionMethod←distribution_method`, `denom←utwlt`
  (not emitted; native-denom default). `reward_pool`/`carry_out` stay in preserved raw until a fixture
  exercises `carry_out ≠ 0`. Old keys (`total_reward`/`active_slot_count`) kept as fallbacks.
- **F3 — `reward_claimed` mapping.** `claimant←signer` (the chain emits `signer`, not claimant/operator/
  creator); claim `denom←utwlt`. slot/epoch/amount were already correct.
- **F4 — sampled-height honesty.** Threaded an `x-cosmos-block-height` header through the ChainClient
  sampled reads and passed the sample height from the snapshot projectors, so observed samples reflect —
  and are labeled at — the ingest height instead of drifting with a long-running localnet.
- **D2 — contract promotion.** `cumulativeEmitted`/`distributionMethod` are first-class API fields
  (migration + DTO + openapi + web types); `rewardPool`/`carryOut` deliberately deferred.

## 4. Live acceptance (clean height-53 fixture, via the API)

| Endpoint | Result |
|---|---|
| `/rewards/epochs` | 5 epochs; `totalReward 4,161,900`; `activeSlotCount 4`; `cumulativeEmitted`→`20,809,500`; `distributionMethod` set ✓ |
| `/coreslots/1/rewards` | epochs 1–5; **1–3 `claimed:true`** + `claimedAtHeight` (11/31/31) + `claimTxHash` ✓ |
| `/rewards/claims` | 2 rows, `claimant`=signer, `utwlt` ✓ |
| `/supply` | `2,000,020,809,500 utwlt`, `sampledAtHeight:53` ✓ |
| ProjectionFailures | **0** ✓ |

## 5. Projection-order nuances (documented, not bugs)

1. A `project:rewards` reset wipes the **co-owned** `SlotRewardProjection`; the claim reconciliation
   (`claimTxHash` + clearing `missing_reward_records`) needs snapshot rows present. Full-truth order:
   `rewards(reset) → rewards-snapshot → rewards(replay)` (clear only the semantic cursor for the replay).
   The first pass's `missing_reward_records` is expected and clears on replay.
2. After a schema/DTO change, kill the API by port + clean-rebuild — an orphaned `node dist/index.js`
   serves the pre-`db:generate` Prisma client, so promoted fields read as `null`.

## 6. Validation (all green)

`npm run typecheck` · `npm run lint` · `npm test` (api 114, web 94) · `npm --prefix apps/indexer test`
**265** · `npm --prefix packages/chain-client test` **17** · `openapi:check` up to date · web `openapi:check`
up to date · static route guards: no stale/unsupported route implementations (only historical doc refs).

## 7. Known limitations / follow-ups

- The reconcile replay (nuance #1) is a manual cursor-clear in the runbook; a dedicated reconcile step
  could encode it. Low priority — the order is documented and idempotent.
- `rewardPool`/`carryOut` remain raw-only until a fixture produces `carry_out ≠ 0` (then an additive
  migration promotes them).
- Path B (separate `twilight_explorer_rewards` DB) stands; consolidate to one rewards-complete canonical
  fixture after Phase 12, per the scope doc.

## 7b. Adversarial review + fixes (2026-06-27)

Local adversarial-reviewer ran the full ritual independently (all numbers matched), verified the
consensus-address derivation byte-for-byte and the live end-state, and returned **PARTIAL** with one
MAJOR + notes. Resolved:

- **MAJOR (fixed) — genesis-seed ProjectionFailures were deletable at height 1.** The seed stamped
  failures at `sourceHeight: 1n` with `projectionName: CORESLOT_METADATA_PROJECTION`; the metadata
  per-height pass opens height 1 with `deleteMany({projectionName, sourceHeight: 1, resolved:false})`,
  so on a *malformed* genesis the durable failure was silently swallowed (failure-durability invariant
  violation; happy path unaffected). **Fix:** stamp genesis-document failures at the pre-chain sentinel
  `sourceHeight: 0n` (never revisited by the height loop, since min indexed block ≥1). Added assertions
  that genesis failures persist at height 0.
- **NOTE (fixed) — incremental re-seed could regress event-derived fields.** The upsert `update` branch
  re-wrote the full baseline (incl. `updatedHeight: 1n`). Changed to a **no-op `update: {}`** so a
  non-reset re-seed never clobbers lifecycle/metadata-derived state; added a no-clobber regression test
  (and made the mock honor create-vs-update, addressing the reviewer's test-coverage note).
- **NOTE (accepted, locked) — `denom ← utwlt`** on events that carry no denom is the locked D4
  native-denom default, applied consistently (epoch + claim, both branches).
- **Follow-up (out of scope, flagged) — temporal-map shares the same latent pattern:**
  `coreslot-temporal-map.ts` writes *per-slot* genesis failures (`invalid_consensus_address`, etc.) at
  `sourceHeight: 1n`, and `projectCoreSlotTemporalMapHeight` deletes `sourceHeight:height,resolved:false`
  at height 1 — so a malformed *active* genesis slot's window failure is likewise deletable. Pre-existing
  in a proven (Phase 8) component; left untouched here to keep this PR focused. **Recommend a separate
  fix** mirroring the sentinel-height approach.

Post-fix validation re-run: typecheck/lint OK; indexer **266** pass / 0 fail (was 265; +1 no-clobber
test); happy-path fixture data intact (4 ACTIVE CoreSlots, 5 epochs, 3 slot rewards claimed, 0 failures).

**Re-review (same reviewer, scoped to the fixes): PASS.** Independently confirmed the `0n` sentinel
survives every `deleteMany` path in the blocks-present scenario, no `failureKey` collision across the
three genesis failure kinds, and the no-clobber test genuinely discriminates the fix. Two non-blocking
residuals tracked as follow-ups:
- **Empty-`Block`-table sentinel edge:** `getMinBlockHeight` falls back to `0n` on an empty canonical
  table, so `endHeight < startHeight` is `0 < 0 = false` and the loop runs height 0 → the height-0
  `deleteMany` could wipe `0n` genesis failures. Requires empty-DB **and** malformed genesis **and**
  projecting-before-ingesting at once (operationally unreachable; you always ingest first). Airtight fix:
  have the height loop skip 0, or guard the rebuild against a zero-block chain.
- **Duplicate-malformed-slot `failureKey` collapse (pre-existing, not introduced here):** N genesis slots
  each missing `slot_id` share one deterministic `failureKey` → collapse to a single `ProjectionFailure`
  row while `failuresCreated` counts N. Equally true before this change. Fix: add a per-slot discriminator
  (e.g. array index) to the genesis-failure key.

## 8. Final recommendation

**Ready for review** (local adversarial-reviewer, then Codex/Copilot on the PR). All locked decisions
honored (D1 allocated, D2 split, D3 genesis seed, D4 utwlt, D5 height-pin), invariants intact (rebuildable
genesis source, no fabricated values, failures-not-guesses), full validation green. Phase 12 (rewards/
supply web) is unblocked against real data; re-evaluate the `gated_by_phase_7_2` caveats next.
