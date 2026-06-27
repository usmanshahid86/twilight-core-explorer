# Phase 7.2 — Tracked Follow-ups (non-blocking)

**Status: open, low-priority.** Date: 2026-06-28. Surfaced by the adversarial + Codex reviews of the
Phase 7.2 rewards/identity projector corrections (see `phase-7.2-rewards-fixture-report.md`). None block
the Phase 7.2 work — all validation is green and live acceptance passed — but each is a real, if narrow,
correctness item to close when convenient.

## FU-1 — temporal-map shares the genesis-failure-durability pattern

**Severity: low (correctness; malformed-genesis-only).** Same class as the genesis-identity `0n` fix that
shipped in this phase, but **unfixed** in a proven Phase 8 component.

`coreslot-temporal-map.ts` writes per-slot genesis seed failures (`invalid_consensus_address`,
`invalid_slot_id`, `genesis_coreslot_malformed`) at `sourceHeight: 1n` (e.g. `seedGenesisSlot`,
~lines 323/345/369/381). Its own per-height pass `projectCoreSlotTemporalMapHeight`
(`coreslot-temporal-map.ts:252`) opens height 1 with
`deleteMany({ projectionName: CORESLOT_TEMPORAL_MAP_PROJECTION, sourceHeight: height, resolved: false })`,
which **deletes those genesis failures** when the height loop reaches 1. So on a malformed *active*
genesis slot, the window failure is silently swallowed — the same failure-durability violation that
`coreslot-genesis-identity.ts` fixed by stamping genesis-document failures at the pre-chain sentinel
`sourceHeight: 0n`.

- **Repro:** rebuild the temporal map (reset / startHeight≤1) against a genesis whose active slot has an
  invalid/absent consensus address; expect a durable `invalid_consensus_address` ProjectionFailure at
  height 1 — it is deleted by the height-1 cleanup.
- **Fix:** stamp temporal-map genesis seed failures at `sourceHeight: 0n` (mirroring
  `coreslot-genesis-identity.ts`), and update the temporal-map tests that assert `sourceHeight: 1n` for
  genesis failures. Left out of the Phase 7.2 PR to keep it focused and avoid churning a proven projector.

## FU-2 — genesis-identity `0n` sentinel is not airtight on an empty `Block` table

**Severity: low (correctness; operationally unreachable).** Narrowed-but-not-eliminated edge of the FU-fixed
genesis-identity durability bug.

`coreslot-genesis-identity.ts` stamps genesis failures at `sourceHeight: 0n` so the metadata per-height
cleanup (`sourceHeight: height`) cannot delete them — safe because the height loop starts at the min
indexed block (≥1). **But** if the `Block` table is empty, `getMinBlockHeight`/`getMaxBlockHeight`
(`coreslot-semantic-rebuild-cli.ts`) fall back to `0n`, so `endHeight < startHeight` is `0 < 0 = false`
and the loop runs height 0 → the height-0 `deleteMany` would wipe the `0n` genesis failures. This requires
an **empty canonical table AND a malformed genesis AND projecting before ingesting** simultaneously — an
order you never actually run.

- **Fix (airtight):** have the rebuild skip a zero-block chain entirely (guard the loop when there are no
  blocks), or skip height 0 in the per-height loop, or use a sentinel no real height can equal.

## FU-3 — duplicate malformed-genesis slots collapse to one `ProjectionFailure`

**Severity: low (observability; pre-existing).** Not introduced by Phase 7.2; surfaced during review.

In `coreslot-genesis-identity.ts`, N genesis slots each missing `slot_id` produce an identical
`failureKey` (all-null discriminators + same `sourceHeight` + same `failureKind: invalid_slot_id`), so
they collapse into a single `ProjectionFailure` row while `failuresCreated` counts each. The failure
count and the persisted-row count disagree, and only one malformed slot is visible.

- **Fix:** add a per-slot discriminator (e.g. the genesis-slots array index) to the genesis-failure
  `failureKey` so each malformed slot is recorded distinctly.

## Notes

- All three are low-priority and were explicitly judged non-blocking by both the local adversarial
  reviewer and Codex.
- FU-1 + FU-3 are best fixed together (both touch genesis-seed failure recording across the two seeders);
  FU-2 is an independent CLI guard.
