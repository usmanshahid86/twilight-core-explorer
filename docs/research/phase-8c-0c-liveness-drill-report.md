# Phase 8c-0c — Live One-Node Liveness Drill Report

Date: 2026-06-25

Status: DONE (analysis + live evidence; no projection/model added). This report captures the
empirical missed-signature behavior observed on a clean 4-CoreSlot localnet and fixes the design
inputs for Phase 8c-1 (expected set + missed evidence).

Prerequisite context: builds on the clean fixture from
`phase-8c-0b-genesis-temporal-map-seed-report.md` and the coverage-truth decisions in
`phase-8c-0-coverage-truth-report.md` (liveness is **CoreSlots-only**).

## 1. Purpose

Before writing the liveness projection (8c-1), drive a *real* missed-signature window on-chain and
observe how an absent CoreSlot operator actually appears in the indexed data — rather than guess the
shape. The single question to answer: **when a CoreSlot is down, can we attribute the miss to it from
the commit evidence, or must we deduce it?**

## 2. Fixture and method

- Chain: fresh 4-CoreSlot genesis localnet (`twilight-localnet-1`), all four slots
  `SLOT_STATUS_ACTIVE` from genesis, power 1 each. Node repo `nyks-core`, home
  `<twilight-localnet-home>`.
- Explorer: schema dropped/recreated, contiguous ingest **heights 1..361**, projections rebuilt
  (semantic incl. genesis seed → block_signatures_v1 → operator_signing_evidence_v1).
- Genesis-seeded consensus windows (all open across the range):

  | slot | consensusAddress (lowercase hex) |
  |------|----------------------------------|
  | 1 | `1b2860f43994efe71af2ba46e5e82d29e23f8441` |
  | 2 | `371546bfeeb646bb982e05e5b738ae8d52243067` |
  | 3 | `82b06c4c8fc4f6d45bd65094e1a50091e9d68272` |
  | 4 | `e502bc527751ca73da609cc82553260663a27535` |

- Drill: **node3 == slot 4** (`e502bc…7535`, confirmed from its `priv_validator_key.json`). Stopped
  node3 after height 292; chain continued on 3/4 (no halt, as expected for 3 of 4 equal-power
  validators clearing the >2/3 BFT threshold); restarted node3, which caught up and resumed signing
  and proposing.

## 3. Observed evidence

### 3.1 Signature flag shapes (Phase 8a `BlockSignature`)

```
blockIdFlagCode | signed | empty_addr | count
       1 (ABSENT)|  f     |   true     |  39
       2 (COMMIT)|  t     |   false    | 1399
       3 (NIL)   |  f     |   false    |   2
```

- **An ABSENT entry (flag 1) carries an EMPTY `validator_address`** — all 39 of them. CometBFT does
  not name the absent validator in the commit.
- A NIL entry (flag 3) *does* carry the address — both belonged to slot 4 (`e502bc…7535`), at the
  transition heights 316 and 348.

### 3.2 Attribution (Phase 8b `OperatorSigningEvidence`)

```
attributionStatus   | count
attributed          | 1401     (1399 commit-signed + 2 NIL with address)
absent_no_validator |   39     (the anonymous absent entries)
```

Totals reconcile: blocks 2..361 = 360 committed blocks × 4 = **1440** evidence rows = 1401 + 39.
1:1 with `BlockSignature`. **0 unresolved `ProjectionFailure`.**

### 3.3 Per-height set view across the outage

For every absent height the signed set is exactly `{1,2,3}` with one anonymous absent:

```
committedHeight | signed_slots | anon_absent | attributed_not_signed
   294          | 1,2,3,4      |     0        |
   295          | 1,2,3,4      |     0        |
   296..315     | 1,2,3        |     1        |            (20 heights)
   316          | 1,2,3        |     0        | 4          (slot 4 NIL)
   317..        | 1,2,3,4      |     0        |
```

(A second outage 329–347 + NIL at 348 occurred because the first node3 restart was fumbled in the
shell and the process was Ctrl-C'd; it is simply additional slot-4 miss data and changes nothing.)

- **Slots 1, 2, 3 never failed to sign any committed height** (zero not-signed rows).
- Total committed heights where slot 4 did not commit-sign: **41** (39 anonymous absent + 2 NIL).

## 4. Findings

1. **An absent CoreSlot is anonymous in the commit.** The absent entry has no `validator_address`,
   so Phase 8b necessarily classifies it `absent_no_validator`. You cannot read "slot 4 missed" off
   the absent entry.
2. **Misses must be computed by set-difference, not by a flag on an attributed row.**
   `missed(H, O) ⟺ O ∈ active-CoreSlot-windows(H) AND O has no flag=2 signed evidence at H`.
   At every absent height this resolves slot 4 by elimination: expected `{1,2,3,4}` − signed
   `{1,2,3}` = `{4}`.
3. **Two miss shapes, one rule.** The anonymous absent (flag 1, no address) is recovered only by the
   difference; the NIL (flag 3, address present) is directly identifiable. Both lack a flag=2 signed
   row, so the same difference rule catches both — the cause (absent vs nil) is recoverable as a
   sub-field.
4. **The miss boundary lags the process kill by ~3 blocks** (killed after 292, first absent at 296).
   Already-gossiped precommits linger and the commit for height H is assembled at H+1. This is real
   consensus behavior, faithfully recorded. 8c-1 must trust the data boundary, never wall-clock kill
   time.
5. **The Phase 8b taxonomy is validated.** `absent_no_validator` is correctly *not* a miss
   attribution by itself; it is an anonymous gap that becomes "slot 4 missed" only after the
   expected-set difference assigns it.

## 5. Design inputs locked for Phase 8c-1

- Expected signer set at committed height H = **active CoreSlot consensus windows covering H**
  (genesis-seeded; CoreSlots-only). Non-CoreSlot signers (`unmapped_validator`) are out of scope —
  ignored, never counted as expected or missed.
- Missed = expected active CoreSlots at H minus operators with a `flag=2` signed row at H.
- Each missed row should retain a **cause**: `absent` (matched by an anonymous flag-1 gap at H) or
  `nil` (matched by an attributed flag-3 row for that slot at H). Both count as missed for liveness
  (the block's commit lacked the signature either way).
- A useful **consistency check → `ProjectionFailure`**: per height, the count of missed-with-cause
  `absent` must equal the number of anonymous `absent_no_validator` entries at H. A mismatch means
  the expected set and the observed commit disagree and must not be silently reconciled.

## 6. Phase 8c-1 acceptance target (this dataset)

Running `coreslot_liveness_v1` over heights 1..361 must produce:

- One expected-signer row per (committed height, active CoreSlot) = **1440** rows
  (360 committed heights × 4 active slots).
- **41 missed rows, all slot 4** (39 cause=`absent`, 2 cause=`nil`).
- **0 missed rows for slots 1, 2, 3**; 1399 signed rows.
- **0 unresolved `ProjectionFailure`.**

This is the live regression target for the projection.

## 7. Out of scope (deferred to 8c-2)

Uptime percentages, rolling-window summaries, proposer enrichment, API/web. 8c-1 produces only the
per-height expected/missed evidence and its cause.
