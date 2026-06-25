# Phase 7 — Rewards Semantic Projection Report

Date: 2026-06-25

Status: PASS (rebuildable semantic projection); observed snapshot path fixed and
live-confirmed in Phase 7.1 — see section 17.

## 1. Summary

Phase 7 adds rebuildable semantic projection for `x/rewards`, plus a clearly separated
observed-sample path. The design folds in the pre-implementation review corrections:

- **Rebuildable semantic projection `rewards_semantic_v1`** — derived only from generic
  indexed rows (ExplorerTransaction / Message / Event). Deterministically rebuildable.
  Covers epoch finalization, claim history, params/pause/resume, and treasury payments.
- **Observed-sample path `rewards_snapshot_v1`** — point-in-time ChainClient snapshots tied
  to the height they were sampled at (`sampledAtHeight`). Slot reward amounts and module
  balances. Explicitly NOT rebuildable to a past height.

`EpochReward`/`epoch_finalized` is treated as aggregate context, never claim truth. Claim
truth has two reconciled sources: the snapshot's observed `claimed` flag and the
event-derived claim provenance from `reward_claimed`. Rewards is a separate domain and is not
part of the CoreSlot combined rebuild.

## 2. Files Changed

New:
- `apps/indexer/src/projections/rewards-semantic.ts` (rebuildable projector)
- `apps/indexer/src/projections/rewards-semantic-cli.ts`
- `apps/indexer/src/projections/rewards-snapshot.ts` (observed-sample ingester)
- `apps/indexer/src/projections/rewards-snapshot-cli.ts`
- `apps/indexer/src/projections/reset-rewards.ts`
- `apps/indexer/src/projections/reset-rewards-cli.ts`
- `apps/indexer/test/projections/rewards-semantic.test.js` (22 tests)
- `prisma/migrations/20260625000800_rewards_semantic_projection/migration.sql`
- `docs/research/phase-7-rewards-semantic-projection-report.md`

Modified:
- `prisma/schema.prisma` — 6 rewards models.
- `apps/indexer/src/projections/types.ts` — rewards projection names, type URLs, event
  types, change-type/denom constants, 4 new failure kinds.
- `apps/indexer/package.json` — `project:rewards[:dev|:reset]`, `project:rewards-snapshot[:dev]`.

## 3. Prisma Models / Migration

Migration `20260625000800_rewards_semantic_projection` adds:

- `RewardEpochProjection` (rebuildable) — `epochNumber` unique; aggregate epoch context.
- `RewardClaimEvent` (rebuildable) — claim history; `sourceEventId` unique for idempotency.
- `RewardsParamsChange` (rebuildable) — queued/activated/pause/resume/direct_update;
  `sourceEventId` and `sourceMessageId` nullable-unique.
- `RewardsTreasuryPayment` (rebuildable) — `treasury_paid` history; `sourceEventId` unique.
- `SlotRewardProjection` (observed sample) — `@@unique([slotId, epochNumber])`, carries
  `sampledAtHeight` plus claim provenance fields.
- `RewardsBalanceSample` (observed sample) — `@@unique([height, sampleKind, address,
  moduleName, denom])`.

No generic or CoreSlot tables changed.

## 4. Rewards Event / Message Surface

Verified against proto descriptors and the repo (no guessing):

Messages (`module = rewards`):
- `/twilight.rewards.v1.MsgClaimRewards`
- `/twilight.rewards.v1.MsgUpdateRewardsParams`
- `/twilight.rewards.v1.MsgPauseRewards`
- `/twilight.rewards.v1.MsgResumeRewards`

Events: `epoch_finalized`, `reward_claimed`, `params_update_queued`, `params_activated`,
`rewards_paused`, `rewards_resumed`, `treasury_paid`.

`epoch_finalized`, `params_activated`, and `treasury_paid` are EndBlock/finalize events with
no `txHash`. The projector loads rewards events by type **without** a txHash filter (ingestable
since Phase 6b-4) and only guards tx-bound events against failed transactions.
`params_update_queued` (tx) vs `params_activated` (EndBlock) mirror the key-rotation
requested/applied split.

## 5. Epoch Projection

`epoch_finalized` → `RewardEpochProjection` keyed by `epochNumber` (upsert). Extracts
`epoch_number`, `total_reward`/`amount`, `denom`, `active_slot_count`, stores raw event. A
missing/invalid epoch number records `invalid_epoch` and writes no row. Never creates slot
reward or claim rows (aggregate context only).

## 6. Slot Reward Snapshot Behavior (observed)

`rewards_snapshot_v1` samples `getSlotRewards(slotId)` for known CoreSlot slots (or explicit
`SLOT_IDS`) and writes `SlotRewardProjection` rows with `sampledAtHeight`. These are observed
samples, not rebuildable. The amount fields are never fabricated by the semantic projector;
they originate only from snapshots. `getModuleBalances` and `getCumulativeEmitted` are stored
as `RewardsBalanceSample` observed samples.

## 7. Claim Projection (rebuildable)

`MsgClaimRewards` + `reward_claimed` correlate by `txHash` + `msg_index` + `slot_id`. On a
confirmed claim a `RewardClaimEvent` is created (idempotent on `sourceEventId`), and existing
`SlotRewardProjection` rows in `[startEpoch, endEpoch]` are set `claimed=true` with
provenance (`claimedAtHeight`, `claimTxHash`, `claimMsgIndex`, `claimEventId`). If no slot
reward rows exist for the range, the claim is still recorded and `missing_reward_records` is
written — amounts are never fabricated. Failed txs do not project claims. Message-without-event
→ `missing_event`; event-without-message → claim recorded from event + `missing_message`;
ambiguous events → `claim_correlation_failed`. The claim projector never unsets `claimed`.

## 8. Params / Pause / Resume

- `MsgUpdateRewardsParams` + `params_update_queued` → `queued` (params payload from message).
- `MsgUpdateRewardsParams` + same-tx `params_activated` → `activated`.
- `MsgUpdateRewardsParams` with neither → `direct_update` + `missing_event` drift.
- `params_activated` EndBlock-only → `activated`.
- `MsgPauseRewards` + `rewards_paused` → `pause`; `MsgResumeRewards` + `rewards_resumed` →
  `resume`; event-only variants recorded with drift failures.

Idempotency via `sourceEventId`/`sourceMessageId` unique upserts.

## 9. Treasury / Supply / Module Balance

`treasury_paid` → `RewardsTreasuryPayment` (rebuildable event history), never slot reward
claim truth. Module balances / cumulative emitted → `RewardsBalanceSample` (observed). Supply
schedule is a schedule, not a balance, and is left to a future consumer rather than coerced
into a balance sample.

## 10. Failure Behavior

Deterministic `failureKey` upserts. New kinds: `invalid_epoch`, `invalid_amount`,
`missing_reward_records`, `claim_correlation_failed` (plus reused `missing_event`,
`missing_message`, `invalid_slot_id`, `unknown_semantic_type`). Per-height unresolved
failures are cleared before recompute; reruns do not duplicate. Unknown future rewards events
(events with `module = rewards` and an unrecognized type) are recorded as
`unknown_semantic_type` and never crash the projector. Only unexpected write errors halt the
`rewards_semantic_v1` cursor.

## 11. Reset / Rebuild

`resetRewardsProjections` deletes all six rewards tables plus `ProjectionFailure` /
`ProjectionCursor` scoped to `REWARDS_PROJECTIONS` (`rewards_semantic_v1`,
`rewards_snapshot_v1`). Generic rows, CoreSlot semantic rows, and CoreSlot cursors/failures
are never touched. Rewards is intentionally NOT wired into the CoreSlot combined rebuild
(`reset-semantic.ts` / `coreslot-semantic-rebuild.ts` unchanged).

## 12. Tests

`apps/indexer/test/projections/rewards-semantic.test.js` — 22 tests covering all 20 required
cases: epoch projection (and that it creates no claim truth), snapshot slot rewards + claimed
truth + snapshot/claim reconciliation, balance samples, claim creation + range update +
missing_reward_records + failed-tx + missing_event/message + ambiguous, params
queued/activated/pause/resume, treasury, reset isolation, idempotent rerun, unknown-event
guardrail, and a source guard asserting no `/cosmos/staking|gov|mint|distribution` usage.

Full suite: `npm --prefix apps/indexer test` → 147 tests, 146 passed, 1 skipped (opt-in
Postgres integration), 0 failed. `npm --prefix packages/chain-client test` → 14 passed.

## 13. Optional Live / Localnet Smoke

- `rewards_semantic_v1` was run over the indexed range 119..3585 against the local DB
  (`RESET_PROJECTION=true`): cursor idle at 3585, 0 epoch/claim/params/treasury rows, 0
  failures — expected, since that range contains no rewards events. Confirms the projector
  runs cleanly over real indexed data.
- Observed snapshot live ingest was not completed during the initial Phase 7 run (localnet
  REST 1317 was unreachable then). It has since been run and fixed in **Phase 7.1** — see
  section 17. The live snapshot now ingests and is idempotent on re-sample.

## 14. Known Limitations

- Live REST rewards snapshot is now exercised (Phase 7.1). On the localnet the slot had no
  finalized epochs yet, so `SlotRewardProjection` and per-slot pagination were not populated by
  live data; pagination is covered by unit tests and the null-key idempotency by a real-DB
  integration test.
- No claim fixture was exercised end-to-end on a live chain (no rewards activity in the
  indexed range); claim correlation is covered by synthetic fixtures.
- `SlotRewardProjection` per-epoch amounts are observed-sample only unless `epoch_finalized`
  is later found to carry a per-slot breakdown.
- Supply schedule is not yet materialized.
- The unknown-event guardrail relies on `Event.module = rewards`; block-level events without a
  module tag will be ignored rather than flagged (known types are always handled).

## 15. Explicit Non-Goals

- No block signature / liveness ingestion.
- No proposer enrichment.
- No API routes or web pages.
- No generated gRPC clients, buf migration, or chain repo changes.
- No staking/gov/mint/distribution routes or models.
- No treatment of `epoch_finalized` as claim truth.

## 16. Next Recommended Step

A live claim fixture (a real `MsgClaimRewards` once a slot has finalized epochs) would
exercise the claim/snapshot reconciliation end-to-end. After that, Phase 8 (block signature
ingestion + liveness projection) can proceed on the corrected temporal map, and
operator-economics views can join `RewardClaimEvent` / `SlotRewardProjection` to the CoreSlot
operator identity.

## 17. Phase 7.1 — Snapshot Idempotency + Pagination Fix

A line review of Phase 7 plus a live snapshot run found two real bugs in the observed-sample
path (the rebuildable `rewards_semantic_v1` projection was sound). Both are fixed here.

### Bug 1 — `RewardsBalanceSample` nullable compound-unique upsert (major)

The original `@@unique([height, sampleKind, address, moduleName, denom])` had nullable
`address`/`moduleName`. Prisma cannot target a row via a compound unique selector containing
NULLs, and Postgres does not dedupe NULLs in a unique index, so the live `cumulative_emitted`
sample (null address/moduleName) failed to upsert.

Fix: a deterministic, non-null `sampleKey` (`"<height>:<sampleKind>:<address|->:<moduleName|->:<denom>"`)
with a real `@unique`; the compound unique is replaced by a plain `@@index`. Migration
`20260625000900_rewards_balance_sample_key` drops the old index, adds `sampleKey NOT NULL`,
and adds the unique. The snapshot upsert now keys on `sampleKey`.

### Bug 2 — `getSlotRewards` not pagination-aware (major)

The ingester called `getSlotRewards(slotId)` once, silently truncating a slot with many
epochs to the first page. Fix: loop, passing `pagination.key` from the previous response's
`pagination.next_key` until exhausted (with a safety guard).

### Minor — `direct_update` clarified

A successful `MsgUpdateRewardsParams` with no confirming `params_update_queued`/`params_activated`
event records a `direct_update` change applied at tx height (the successful authority-gated tx
is itself the confirmation; there is no amount to fabricate) plus a `missing_event` soft drift
signal. Documented in code; not changed.

### Tests added

- Unit: `getSlotRewards` follows `next_key` across pages; deterministic non-null `sampleKey`
  for null address/moduleName; re-sampling a null-keyed balance is idempotent (in-memory).
- Integration (real Postgres, gated by `RUN_INTEGRATION_TESTS=1`):
  `rewards-snapshot.integration.test.js` upserts a null-address `cumulative_emitted` sample and
  proves idempotency on re-sample — the case the in-memory mock could not catch.

### Validation / live smoke

- `npm --prefix apps/indexer test`: 151 tests, 149 passed, 2 skipped (opt-in integration);
  with `RUN_INTEGRATION_TESTS=1` against `twilight_explorer_test`: 156 passed, 0 skipped.
  typecheck/lint/chain-client tests pass; static guards clean.
- Live snapshot smoke (`project:rewards-snapshot`, `SLOT_IDS=4`, REST reachable): now
  succeeds. First run wrote 1 `cumulative_emitted` balance sample (null address, the
  previously-failing case); a second run left it at 1 row (idempotent) with the
  `rewards_snapshot_v1` cursor advanced. `SlotRewardProjection = 0` because slot 4 has no
  finalized epochs yet (`getEpochReward(1)` is 404 — expected, epoch not finalized).
