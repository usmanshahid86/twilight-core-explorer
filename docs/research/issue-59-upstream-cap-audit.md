# Issue #59 — Upstream-cap audit: projections must not outrun the projections they read

Follow-up to #56. Audits every derived projection for the bug class where a projection advances its
cursor past a height whose **upstream projection** output does not exist yet — producing nothing (or a
mis-attribution) for that height, then never revisiting it: a permanent, silent gap.

## The bug class

A projection is vulnerable when **all** of these hold:
1. It is **incremental** (advances a forward cursor; processes each height once) — NOT a full recompute
   (delete-then-recreate), which self-heals.
2. It reads the output of **another projection** (not just generic canonical rows from the ingester).
3. Its `endHeight` can exceed that upstream projection's progress.

If the upstream's output is **sparse** (rows exist at only some heights — e.g. lifecycle events, or
consensus windows opened per activation), the downstream cannot detect "behind" by looking at the max
row height, so it must cap `endHeight` at the **upstream's cursor**.

## Classification (all projections)

| Projection | Reads | Shape | Cap | Verdict |
|---|---|---|---|---|
| base: metadata / lifecycle / payout / params / key-rotation / block-signatures / rewards-semantic | generic canonical rows (ingester) | incremental | `maxBlock` | safe — generic rows exist once the block is ingested |
| temporal-map | lifecycle + key-rotation events (**sparse**) | incremental | **upstream cursor** (fixed in #56) | fixed (#56) |
| operator-signing-evidence | `BlockSignature` (dense) **+ consensus windows (sparse)** | incremental | `max(sourceBlockHeight)` **+ temporal-map cursor** | fixed (#59) |
| coreslot-liveness | `operatorSigningEvidence` (dense) **+ consensus windows (sparse)** | incremental | `max(sourceBlockHeight)` **+ temporal-map cursor** | fixed (#59) |
| proposer-attribution | `Block` (generic) **+ consensus windows (sparse)** | incremental | `maxBlock` **+ temporal-map cursor** | fixed (#59) |
| coreslot-liveness-summary | liveness evidence | **full recompute** | — | safe — delete-then-recreate self-heals |
| coreslot-health | summaries + windows | **full recompute** | — | safe — delete-then-recreate self-heals |

### Why the dense-source cap alone was insufficient (#59)

`operator-signing-evidence` and `coreslot-liveness` already capped at `max(upstream.sourceBlockHeight)`,
which protects against outrunning their **dense** source (signatures / evidence). But all three
incremental consumers *also* read **consensus windows** (temporal-map's sparse output) for attribution /
expected-signer evaluation, and nothing capped that. During backfill/catch-up they could attribute a
height before its window was built — silently recording `noConsensusWindow` / `unmappedValidator` / "no
expected signers" / dropped proposer — then advance past it. This is why the devnet #56 incident required
resetting the **whole** liveness chain, not just temporal-map. Reproduced end-to-end before the fix
(`operator-signing-evidence.test.js`, the `#59` case) and now asserted fixed.

## Fix

All three cap `endHeight` at the temporal-map cursor via `capEndHeightAtTemporalMapCursor`
(`coreslot-temporal-map.ts`, built on the shared `readProjectionCursorHeight` in `cursor.ts`):
`endHeight = min(existing cap, temporal-map cursor)`. A missing upstream cursor reads as `0n`, which stalls
the downstream until the upstream has run. Baking the temporal-map projection name into that helper removes
the "wrong upstream" risk from the three call sites. The cap is conservative on the `sourceBlockHeight` axis
(attribution uses `committedBlockHeight`, and windows are effective at `activate + 2`), so capping at the
temporal-map cursor never over-runs. In steady state the temporal-map cursor equals `maxBlock`, so there is
no lag.

### Airtight committed-height guarantee (Codex-review follow-up)

The source-axis cap is only sound if `committedBlockHeight ≤ sourceBlockHeight`. A code review found that
`block-signatures` previously trusted a raw `last_commit.height` verbatim (unbounded), so a parseable but
**inconsistent** height (`> sourceBlockHeight`) could still push a consumer past temporal-map. Fixed at the
root: `block-signatures` now enforces the CometBFT invariant that block *H*'s `last_commit` is for *H − 1* —
a parseable `last_commit.height ≠ H − 1` is recorded as an `inconsistent_committed_height` `ProjectionFailure`
and the protocol-derived `H − 1` is used instead of the raw value (mirroring the existing
unparseable-`invalid_height` path). This makes `committed ≤ source` structurally guaranteed, so the cap is
airtight rather than assumption-bound — and it closes a pre-existing violation of the "inconsistent history →
`ProjectionFailure`, never a guessed value" invariant.

## Invariant for future work

**Any incremental projection that reads a sparse upstream projection's output must cap its `endHeight` at
that upstream's cursor** (use `readProjectionCursorHeight`). A `max(row height)` cap is only safe for a
**dense** upstream (a row at ~every height). Full-recompute projections are exempt (they self-heal).
