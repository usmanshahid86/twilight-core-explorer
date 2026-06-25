# Phase 8c-3 — CoreSlot Health / Network Halt-Risk Report

Date: 2026-06-26

Status: **PASS.**

Adds `coreslot_health_v1`: the policy layer that turns the numeric 8c-2 summaries into operator-facing
health labels (`CoreSlotHealthSnapshot`, per active CoreSlot) and a single network halt-risk snapshot
(`NetworkLivenessRiskSnapshot`). Backend/projection only — no API/web/proposer, no live
RPC/genesis/validator-set, no raw-signature or 8a/8b recomputation, equal-power v1. Rebuildable.

## Scope / inputs

Consumes `CoreSlotLivenessSummary` (numeric truth + labels), `CoreSlotConsensusWindow` (authoritative
active set via the existing `findActiveCoreSlotWindowsAtHeight` temporal-map helper), and
`ProjectionFailure` (coverage). Does NOT consume BlockSignature / OperatorSigningEvidence. Health is
based on the **recent_100** window; lifetime/recent_500/recent_1000 are context only.

## Active-set rule (temporal map, not summary recency)

`networkLatestHeight` = max recent_100.lastCommittedHeight across summaries. Active set =
`findActiveCoreSlotWindowsAtHeight(networkLatestHeight)`. v1 emits a health snapshot for **only**
active slots. An active slot with no recent_100 summary → `unknown`/`missing_summary`. A slot with a
summary but not active → not emitted. Identity is sourced from the active window.

## Health policy (`coreslot_health_policy_v1`, strict precedence)

Constants (centralized in `types.ts`): `degradedUptimeBps = 9900`, `downMissedStreak = 10`.
1. **unknown** — no recent_100 or expectedCount 0 → `missing_summary`.
2. **incomplete** — summaryStatus incomplete or invalidHeightCount > 0 → `incomplete_summary`.
3. **down** — currentMissedStreak ≥ 10 → `sustained_miss_streak`.
4. **degraded** — currentMissedStreak 1..9 → `current_miss_streak`; else (streak 0 and uptimeBps <
   9900 or missedCount > 0) → `recent_misses`.
5. **healthy** — complete, uptimeBps ≥ 9900, streak 0, missed 0 → `complete_no_recent_misses`.

Data-quality gates (1,2) precede behavior gates (3,4,5).

## Network halt-risk policy (equal-power v1, strict precedence)

Active set = emitted health snapshots. healthy+degraded → available; down → unavailable;
incomplete/unknown → coverage-unknown. `availablePowerBps = floor(available*10000/active)`.
1. **unknown** — 0 active (`no_slots`) or any active incomplete/unknown (`coverage_unknown`).
2. **critical** — availablePowerBps ≤ 6666 (≤ 2/3) → `insufficient_available_power`.
3. **warning** — > 6666 and (downSlotCount > 0 or degradedSlotCount > 0 or unavailablePowerBps ≥
   2500) → `degraded_or_down_present`.
4. **normal** — all active healthy → `all_healthy`.

## Models

`CoreSlotHealthSnapshot` (per slot; `healthKey = coreslot_health_v1:{slotId}`): identity from the
active window, source-summary ids, recent_100 numerics copied, lifetime/recent_500/recent_1000 uptime
context, `isActiveAtLatest` (always true in v1), `healthStatus`/`healthReason`/`policyVersion`.
`NetworkLivenessRiskSnapshot` (single latest, `riskKey = network_liveness_risk_v1:latest`): status
counts, available/unavailable counts + bps, `haltRiskLevel`/`haltRiskReason`/`policyVersion`.

## Algorithm

Full recompute in one transaction: load summaries → networkLatestHeight → active windows → per active
slot classify + copy fields → delete-all + createMany health → count statuses → delete + create the
single network snapshot → cursor lastProjectedHeight = networkLatestHeight. Advisory lock. Missing
summary = `unknown` (NOT a failure). Standalone CLI after `coreslot_liveness_summary`.

**Corrupt-summary policy:** an active slot whose recent_100 summary violates a count invariant
(signed+missed != expected, or absent+nil != missed) records a `coreslot_health_invariant_violation`
ProjectionFailure AND is emitted as `healthStatus = incomplete`, `healthReason = corrupt_summary`
(numerics zeroed; identity from the active window). It is NEVER silently dropped — dropping would
leave `activeSlotCount` > emitted rows and understate network risk. The slot counts toward
`incompleteSlotCount`, forcing `haltRiskLevel = unknown` / `coverage_unknown`.

## Files changed

New: `apps/indexer/src/projections/coreslot-health.ts` (projector), `coreslot-health-cli.ts`,
`reset-coreslot-health.ts` (+ `-cli.ts`), `apps/indexer/test/projections/coreslot-health.test.js`,
migration `20260626000300_coreslot_health`. Edited: `prisma/schema.prisma` (2 models),
`apps/indexer/src/projections/types.ts` (projection name, health/risk status + reason consts,
`CORESLOT_HEALTH_POLICY`, 3 failure kinds), `apps/indexer/package.json` (scripts), checkpoint, runbook.
Reuses the existing `findActiveCoreSlotWindowsAtHeight` export (no new helper).

## Tests

18 mock-Prisma cases (all 5 health labels; degraded-streak vs degraded-recent-misses; uptime/streak
boundaries; context + identity copied; network normal/warning-degraded/warning-1-down-7500/critical-
2-down-5000/unknown; active-set vs missing-summary incl. inactive-with-summary not emitted; idempotent
recompute; scoped reset; no-scope-leak). Indexer suite: **242 tests, 240 pass / 0 fail / 2 skipped**.

## Local live smoke (accepted 4-CoreSlot fixture)

`RESET_PROJECTION=true npm --prefix apps/indexer run project:coreslot-health` (DB-verified):

| slot | healthStatus | reason | uptimeBps | currentMissedStreak |
|------|-------------|--------|-----------|---------------------|
| 1/2/3 | healthy | complete_no_recent_misses | 10000 | 0 |
| 4 | **degraded** | recent_misses | 5900 | **0** |

Network: `haltRiskLevel = warning` (`degraded_or_down_present`), activeSlotCount 4, healthy 3,
degraded 1, down 0, availableSlotCount 4, availablePowerBps 10000, latestCommittedHeight 360. All
`policyVersion = coreslot_health_policy_v1`; 0 unresolved `coreslot_health_v1` failures.

slot 4 is **degraded, not down**, because it recovered (currentMissedStreak 0) — confirmed from DB,
not assumed.

## Validation commands

```sh
npm run db:generate && npm run db:deploy   # applies 20260626000300
npm run typecheck && npm run build          # clean
npm --prefix apps/indexer test              # 242 / 240 pass / 2 skip
npm --prefix packages/chain-client test     # pass
npm run lint && git diff --check            # clean
# live: RESET_PROJECTION=true npm --prefix apps/indexer run project:coreslot-health
```

Run order: `… coreslot_liveness → coreslot_liveness_summary → coreslot_health`.

## Known limitations

- v1 thresholds (`degradedUptimeBps 9900`, `downMissedStreak 10`, critical ≤ 6666 bps) are explorer
  POLICY constants, not protocol rules; centralized + versioned for easy revision.
- Equal-power v1: power is count-derived; consensusPower weighting deferred.
- Only currently-active slots emitted; historical inactive-slot health deferred.
- Single latest network snapshot (no history); append-history deferred.
- `degradedUptimeBps` is effectively subsumed by `missedCount > 0` at the recent_100 grain (any miss
  lowers uptime below 10000); both retained to document intent and stay robust if the grain changes.
- No API/web/proposer/charts (later phases).
