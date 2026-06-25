# Phase 8c-0 — Coverage-Truth Check Report

Date: 2026-06-25

Status: DONE (analysis + scope decision; no projection/model added).

## 1. Summary

Before building Phase 8c-1 (expected signer set + missed-signature evidence), we verified — against
the live chain and the indexed database — whether the CoreSlot temporal consensus map provides a
**complete enough** expected-signer set to compute liveness, and who is actually in scope.

Two things were established:

1. **Scope is CoreSlots-only.** The consensus validator set and the CoreSlot operator set are not the
   same. Most of the consensus set is *not* CoreSlots and is out of scope for CoreSlot signing
   liveness.
2. **The temporal map is not yet complete for the one real CoreSlot.** Slot 4 was active and signing
   from genesis but has no window for its pre-inactivation period, because genesis activation never
   emitted an indexed lifecycle event (the genesis-window gap carried since Phase 6b).

This report also runs the **deferred Phase 8b live smoke** (Postgres was down when 8b shipped) and
confirms 8b is correct on real data.

## 2. Method

- Live CometBFT RPC `/validators?height=H` at sample heights (RPC up; chain at height ~7421).
- Indexed Postgres (`twilight_explorer`) direct queries over the local smoke dataset.
- Deployed the pending `20260625002000_operator_signing_evidence` migration and ran
  `operator_signing_evidence_v1` (`RESET_PROJECTION=true`) to produce the real attribution
  distribution.

The local DB is a **sparse smoke set**: 36 `Block` rows spanning heights 119–3585 (not contiguous),
131 `BlockSignature` rows. The chain itself is far ahead (~7421).

## 3. Findings

### 3.1 Consensus set (live `/validators`)

Fixed 4-validator PoA set, power 1 each:

| address | genesis–~3555 | 3556–3568 | 3569–3583 | 3584+ |
|---|---|---|---|---|
| `a071ac…0b15` | ✓ | ✓ | ✓ | ✓ |
| `aff2293e…98b1a` | ✓ | ✓ | ✓ | ✓ |
| `f355e5…a8411` | ✓ | ✓ | ✓ | ✓ |
| `f060bf…c7d23` | ✓ | — (inactivated) | ✓ (reactivated) | → rotated |
| `fa90d2…6f23` | — | — | — | ✓ (rotation of f060) |

Lifecycle timeline (from indexed events): slot 4 `coreslot_inactivated` @3554 (membership leaves at
3556 = +2), `coreslot_activated` @3567 (membership at 3569 = +2), key rotation `f060`→`fa90` applied
@3582 (membership 3584 = +2). These three transitions are the only events that produced windows.

### 3.2 CoreSlot universe (indexed)

Only **two** CoreSlots exist:

- **slot 1** — operator `twilight17n30…`, **no consensus address**, never activated → correctly has
  no consensus window. Not a gap.
- **slot 4** — operator `twilight10c2j…`, active operator, consensus key `f060…` then `fa90…`.

`CoreSlotConsensusWindow` contains exactly two rows, both slot 4: `f060` [3569, 3584) and `fa90`
[3584, ∞). **The genesis validators `a071`/`aff2`/`f355` have zero references in any CoreSlot or
window row — they are not CoreSlots.**

### 3.3 Phase 8b live smoke (now run; previously deferred)

`OperatorSigningEvidence` = **131 rows = 131 BlockSignatures** (1:1), zero unresolved failures, cursor
idle at 3585:

| attributionStatus | rows | distinct addrs |
|---|---|---|
| `attributed` | 15 | 1 (`f060`, slot 4) |
| `unmapped_validator` | 48 | 3 (`a071`/`aff2`/`f355`) |
| `no_consensus_window` | 67 | 4 |
| `absent_no_validator` | 1 | 0 (the 3584 rotation-transition absent entry) |

`attributed` rows are exclusively slot 4 / `f060` at committed heights **3569–3583** — exactly its
reactivation window — with operator `twilight10c2j…`. This is strong confirmation that Phase 8b's
status taxonomy, coverage-existence split, historical-window attribution, and idempotent 1:1 output
all behave correctly on real data. **The Phase 8b "smoke not run" caveat is discharged.**

### 3.4 Coverage gap

`f060` appears in 22 signatures: 15 `attributed` (3569–3583), plus **7 `no_consensus_window`** at
heights 118–120 and 3552–3555 — i.e. slot 4 was a bona-fide active CoreSlot signing then, but its
genesis-active period has no window. Coverage ratio of windows vs the *full consensus set* is 0/4
below 3569 and 1/4 after — but that ratio is the wrong denominator (see §4).

## 4. Decision: liveness scope is CoreSlots-only

Confirmed with the user (2026-06-25). `a071`/`aff2`/`f355` are foundation/genesis consensus
validators **outside** the CoreSlot operator model and are out of scope for CoreSlot signing
liveness. Consequences for Phase 8c-1:

- **Expected signer set = active CoreSlots**, NOT the consensus commit set. A completeness check that
  compares window count to `commitSetSize` (=4) is wrong for this chain — it would flag every height
  incomplete forever because 3 of 4 commit entries are non-CoreSlot validators.
- The product is **"CoreSlot operator signing liveness."** Non-CoreSlot validators produce no
  expected-signer rows and no misses.
- **Correction note:** an earlier working assumption in the planning notes (that the three genesis
  validators needed genesis-window seeding) was wrong — they are not CoreSlots and nothing maps to
  them. The only real gap is slot 4's own genesis window.

## 5. Genesis seeding is structurally required (resolved 2026-06-25)

The open question — does genesis CoreSlot activation emit an indexable event? — is **answered NO**,
verified against the Twilight Core node source:

- `x/coreslot/keeper/genesis.go:22-41` — `InitGenesis` writes slot state **directly**
  (`Slots.Set`, `ByOperator.Set`, `ByConsensus.Set`) with **no** `emitRegistered`/`emitActivated`.
  The only event on that path is `coreslot_validator_update_emitted` from `diffAndPersist`
  (`endblock.go:212`).
- That event is **not indexable** anyway: `InitGenesis` runs inside `InitChain`
  (`module.go:79-82`), not in a block. CometBFT only surfaces `FinalizeBlock`/tx events for real
  blocks in `/block_results`, so an indexer sees **nothing** for the genesis validator set.

**Therefore the temporal map cannot be built from block events alone — a genesis seed is mandatory,
and it is structural, not an artifact of the current broken localnet.** Even a clean genesis with 4
CoreSlot operators hits this: all four would be invisible to the explorer, and every block‑1..N
signer whose slot was created at genesis would fail the cons-addr→slot lookup — mis-reporting the
*founding* validators' liveness as 100% unmapped (i.e. the whole network at launch).

### 5.1 Seeding design (preserves the rebuildable invariant)

- Add a `ChainClient.getGenesis()` over CometBFT `/genesis` RPC; parse
  `app_state.coreslot.{slots, params, reward_weights, reserved_consensus_addresses,
  pending_key_rotations}` — the canonical, deterministic, height-anchored initial state.
- Seed the temporal map / `CoreSlotProjection` at **height 1** for every genesis slot with
  `status == ACTIVE` (a window per active genesis slot, `effectiveFromHeight = 1`), then layer the
  event-driven deltas from height 1 onward.
- This stays rebuildable: genesis is fixed, so the seed is reproducible — treat it as the
  **height-1 baseline** of the projection, not a live snapshot. The `validatorUpdateHeight + 2`
  offset does **not** apply to the genesis baseline (it is the initial set, not an update).

### 5.2 Height detail for the liveness side

Block 1 has no `last_commit` (nothing signs block 0); block 2's `last_commit` is the genesis set
signing block 1 (committed height 1). With N‑1 attribution, genesis operators are "expected to sign"
from committed height 1 — which matches seeding them active at height 1.

## 5b. Recommended fixture reset (still worth doing)

Independently of seeding, rebuild the fixture: tear down the current localnet and restart with **4
CoreSlot operators registered/active from genesis**, then re-ingest **contiguously** from height 1.
The current DB is sparse (36 non-contiguous blocks) and cannot support per-height liveness. The clean
fixture gives a fully-attributable dataset (once seeded) and lets us deliberately halt a node to
generate *real* missed-signature evidence for 8c-1/8c-2/8c-3.

## 6. Next steps

1. Rebuild the localnet fixture with 4 genesis CoreSlot operators; re-ingest contiguously from h1.
2. **Add genesis seeding to the temporal map** (`ChainClient.getGenesis` + height-1 baseline of all
   active genesis slots) — confirmed mandatory (§5). This is a prerequisite for both the temporal map
   (6b) and liveness (8c).
3. Then implement Phase 8c-1 (`operator_missed_signature_evidence_v1`) with the CoreSlots-only
   expected set and the narrow "active CoreSlot but window-less" completeness guard.

## 7. Validation

- Route guards: no stale `/twilight/coreslot/v1/slots/active` or `/cosmos/{staking,gov,mint,
  distribution}` implementation references (docs/guard mentions only).
- `coverageStartHeight` (post-fixture) = first indexed committed height where every active CoreSlot
  has a window — on a clean genesis fixture this is the genesis height.
