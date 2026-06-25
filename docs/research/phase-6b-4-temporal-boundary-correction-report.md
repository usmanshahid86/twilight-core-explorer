# Phase 6b-4 — Temporal Boundary Precision Correction Report

Date: 2026-06-25

Status: PASS. Implementation complete and the live localnet rerun has now been executed
(Option B, full combined reset + replay over the indexed range 119..3585) against the running
4-node twilight-localnet-1. The corrected `validatorUpdateHeight + 2` boundary is confirmed
end-to-end for the reactivation and delayed key-rotation cases, and the finalize-ingestion ->
key-rotation `applied` chain is confirmed. See section 11 for the recorded DB results.

The earlier "not run" status was because the original run was gated from local RPC/Postgres
access; a later session had that access and completed the rerun.

## 1. Summary

Phase 6b-4 corrects the temporal consensus map boundary after Phase 6b-3 live localnet
evidence showed that block-height validator-set membership changes at
`validatorUpdateHeight + 2`, not `H + 1`.

The phase also fixes the generic block-results ingestion gap: CometBFT ABCI++ delayed
CoreSlot apply events can appear under `finalize_block_events`, so the indexer now ingests
that block-level event stream in addition to begin/end block events.

## 2. Files Changed

Code and schema:

- `packages/chain-client/src/types.ts`
- `packages/chain-client/src/rest-rpc-client.ts`
- `apps/indexer/src/mapper.ts`
- `apps/indexer/src/projections/coreslot-temporal-map.ts`
- `prisma/schema.prisma`
- `prisma/migrations/20260625000700_temporal_boundary_traceability/migration.sql`

Tests and fixtures:

- `packages/chain-client/test/rest-rpc-client.test.js`
- `apps/indexer/test/fixtures/empty-block.json`
- `apps/indexer/test/fixtures/tx-block.json`
- `apps/indexer/test/ingest-height.test.js`
- `apps/indexer/test/projections/coreslot-key-rotation.test.js`
- `apps/indexer/test/projections/coreslot-semantic-rebuild.test.js`
- `apps/indexer/test/projections/coreslot-temporal-map.test.js`

Docs:

- `docs/research/explorer-project-checkpoint.md`
- `docs/research/phase-6b-2-temporal-consensus-map-report.md`
- `docs/research/phase-6b-4-temporal-boundary-correction-report.md`

## 3. `finalize_block_events` Ingestion Correction

`RestRpcChainClient.getBlockResults()` now exposes:

- `beginBlockEvents`
- `endBlockEvents`
- `finalizeBlockEvents`
- `txResults`

`apps/indexer/src/mapper.ts` maps `finalizeBlockEvents` into generic `Event` rows with:

```text
phase = finalize_block
eventKey = height:finalize_block:txHash-or-none:eventIndex
```

This keeps finalize events distinct from begin/end block events and tx events, even when the
event index is the same. Re-ingestion remains idempotent because `eventKey` includes the
phase.

The regression test uses the Phase 6b-3 height 3582 artifact and verifies that ingestion
stores:

- one `coreslot_key_rotated` finalize event
- two `coreslot_validator_update_emitted` finalize events
- no duplicate events after re-ingesting the same height

## 4. Corrected Temporal Boundary Rule

Phase 6b-3 live localnet evidence showed:

```text
validator update at H
next_validators_hash changes at H + 1
/validators?height membership changes at H + 2
```

Therefore `CoreSlotConsensusWindow`, which is used for block-height membership attribution,
now uses:

```text
effectiveFromHeight / effectiveToHeight = validatorUpdateHeight + 2
```

For lifecycle events:

- `validatorUpdateHeight = event.effective_height` when present
- otherwise `validatorUpdateHeight = event.height`

For applied/immediate-applied key rotations:

- `validatorUpdateHeight = rotation.effectiveHeight` when present
- otherwise `validatorUpdateHeight = rotation.appliedHeight`

Requested and cancelled rotations still do not open or close temporal windows.

## 5. Named Constant / Traceability

The temporal projector now exports:

```ts
VALIDATOR_SET_MEMBERSHIP_OFFSET = 2n
```

The constant is used for membership-height calculation instead of scattering inline `+ 2n`
math.

`CoreSlotConsensusWindow` now stores:

```prisma
validatorUpdateHeight BigInt?
```

This makes the distinction explicit:

- `validatorUpdateHeight`: event or explicit effective height that caused the validator-set update.
- `effectiveFromHeight`: block-height membership start, equal to `validatorUpdateHeight + 2`.
- `effectiveToHeight`: exclusive block-height membership end, also computed from the close-side validator update height plus 2.

## 6. Update / Next-Hash / Membership Distinction

The explorer now treats these as separate concepts:

```text
H      = validator update event/effective height
H + 1  = next_validators_hash transition observed in block headers
H + 2  = /validators?height membership and block-height attribution boundary
```

The temporal map is intentionally keyed to the block-height membership boundary. Later
proposer enrichment should query the temporal map at block height `N`. Later signature
attribution should query the committed height `N - 1` for signatures contained in block
`N`.

## 7. Live-Confirmed vs Assumed-by-Consistency

Live-confirmed by Phase 6b-3:

- inactivation: update height 3554, membership changes at 3556
- reactivation: update height 3567, membership changes at 3569
- delayed key rotation: apply/effective height 3582, membership changes at 3584

Applied by consistency, but still needing live fixture coverage:

- suspension
- removal
- immediate-applied rotation
- lifecycle events with explicit `effective_height`

## 8. Future Robust Target

This phase does not rewrite the temporal map to derive directly from
`coreslot_validator_update_emitted`.

The robust future design is to derive validator-set entry/exit windows from
`coreslot_validator_update_emitted`, because it carries consensus address, power, slot id,
operator, and update height directly. Phase 6b-4 keeps the existing lifecycle/key-rotation
semantic-row approach and aligns it to observed membership height via
`VALIDATOR_SET_MEMBERSHIP_OFFSET`.

## 9. Regression Tests

Added or updated coverage for:

- `finalize_block_events` parsing at the chain-client boundary.
- `finalize_block_events` ingestion into generic `Event` rows.
- finalize event keys not colliding with begin/end/tx events.
- idempotent re-ingestion of finalize events.
- delayed slot 4 `coreslot_key_rotated` event transitioning a requested rotation to applied.
- lifecycle activation at `H` opening at `H + 2`.
- lifecycle inactivation/suspension/removal at `H` closing at `H + 2`.
- key rotation with `effectiveHeight` opening/closing at `effectiveHeight + 2`.
- key rotation without `effectiveHeight` opening/closing at `appliedHeight + 2`.
- `VALIDATOR_SET_MEMBERSHIP_OFFSET = 2n`.
- `validatorUpdateHeight` stored on opened windows.
- Phase 6b-3 fixture numbers:
  - 3554 closes at 3556
  - 3567 opens at 3569
  - 3582 rotates at 3584
- requested/cancelled rotations still do not create windows.
- combined semantic rebuild order remains:
  metadata -> lifecycle -> payout -> params -> key_rotation -> temporal_map

## 10. Backfill / Rerun Strategy

The safe rerun strategy must avoid stale windows and partial combined reset data loss.

Recommended Option A for temporal-map-only validation:

```text
1. reingest/backfill 3553..3585
2. re-run coreslot_key_rotation_v1 over 3553..3585
3. reset only coreslot_temporal_map_v1
4. replay temporal map from earliest indexed semantic/core height through 3585
```

Step 2 is required. Without it, the height 3582 finalize event becomes visible in the
generic `Event` table, but the existing `CoreSlotConsensusKeyRotation` row can remain
`requested`; then the temporal map cannot validate the rotation boundary at 3584.

Recommended Option B for full semantic validation:

```text
1. reingest/backfill 3553..3585
2. combined semantic reset
3. replay combined semantic projections from earliest indexed block height through 3585
```

Do not run combined reset over only `3553..3585`; it clears CoreSlot semantic state
globally and would lose earlier semantic history if only the fixture slice is replayed.

## 11. Local Fixture Rerun

Executed on 2026-06-25 against the running 4-node `twilight-localnet-1` (RPC
`http://127.0.0.1:26657`, latest height ~4304 at run time) and local Postgres.

### Strategy used: Option B (full combined reset + replay)

Option B was used rather than the amended Option A because it is a strict superset: the
combined rebuild runs `key_rotation` before `temporal_map` over the full indexed range, so it
exercises both the finalize-ingestion -> key-rotation transition and the temporal boundary in
one deterministic pass. Running the amended Option A afterward would only reproduce the same
windows, so it was not separately run.

```sh
# 1. apply the traceability migration
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public \
  npm run db:deploy

# 2. backfill the fixture range so finalize_block_events land (idempotent re-ingest;
#    explicit START/END re-fetches and upserts already-indexed heights)
CHAIN_ID=twilight-localnet-1 \
COMET_RPC_URL=http://127.0.0.1:26657 REST_URL=http://127.0.0.1:1317 \
DATABASE_URL=...:twilight_explorer?schema=public \
START_HEIGHT=3553 END_HEIGHT=3585 npm --prefix apps/indexer run start

# 3. full combined reset + replay over the indexed range (not the partial slice)
CHAIN_ID=twilight-localnet-1 DATABASE_URL=...:twilight_explorer?schema=public \
START_HEIGHT=119 END_HEIGHT=3585 RESET_PROJECTION=true \
npm --prefix apps/indexer run project:coreslot-semantic
```

### Observed results (all canaries pass)

Ingestion / key-rotation chain:

- height 3582 now has three `finalize_block` events: one `coreslot_key_rotated` and two
  `coreslot_validator_update_emitted` (previously zero rows at 3582).
- slot 4 `CoreSlotConsensusKeyRotation.status = applied` (was `requested` before the finalize
  fix), with `oldConsensusAddress=f060bf23…`, `newConsensusAddress=fa90d27e…`,
  `effectiveHeight=3582`, `appliedHeight=3582`.

`CoreSlotConsensusWindow` for slot 4 (corrected `+2` boundary, half-open intervals):

| consensusAddress | validatorUpdateHeight | effectiveFromHeight | effectiveToHeight | opened / closed |
|---|---:|---:|---:|---|
| `f060bf23…` (old) | 3567 | 3569 | 3584 | lifecycle / key_rotation |
| `fa90d27e…` (new) | 3582 | 3584 | null (open) | key_rotation / — |

Membership-at-height probes (half-open `from <= H < to`):

```text
H=3568 -> none
H=3569 -> f060bf23 ACTIVE   (reactivation 3567 + 2)
H=3583 -> f060bf23 ACTIVE
H=3584 -> fa90d27e ACTIVE   (rotation effective_height 3582 + 2)
```

These match the live `/validators?height` membership boundaries from Phase 6b-3 exactly
(reactivation visible at 3569, new consensus address visible at 3584). Temporal-map
`ProjectionFailure` count for slot 4 over the range was zero.

### Caveat: inactivation close not demonstrable from this live range

The 3554 inactivation did **not** produce a closed window at 3556 in the live replay, because
the explorer had no open window for slot 4's original (genesis) active period: genesis
validators do not emit a `coreslot_activated` event, and indexing for this DB starts at height
119, so there was no baseline window for the inactivation to close (a correct no-op, no
failure emitted). The inactivation/suspension/removal "close at `H+2`" logic is covered by the
seeded unit tests; it simply cannot be exercised end-to-end from a range that excludes the
genesis activation. This is a data-coverage limitation, not a boundary defect.

## 12. Validation

Passed:

```text
npm install
npm run db:generate
npm run typecheck
npm test
npm run lint
npm --prefix packages/chain-client test
npm --prefix apps/indexer test
```

Observed focused results:

- `npm --prefix apps/indexer test`: 125 tests, 124 passed, 1 skipped, 0 failed
- `npm --prefix packages/chain-client test`: 14 passed, 0 failed
- `npm test`: workspace tests passed

Live execution (completed in a later session with local access — see section 11):

- `DATABASE_URL=... npm run db:deploy` — migration `20260625000700` applied.
- live localnet reingest/backfill of 3553..3585 — finalize events landed at 3582.
- combined reset + replay over 119..3585 — all six projection cursors idle at 3585.

## 13. Known Limitations

- The live rerun confirmed reactivation (3567->3569) and delayed key rotation (3582->3584).
  The inactivation close-at-`H+2` boundary was not exercisable live because slot 4 had no
  indexed genesis-activation window to close (see section 11 caveat); it is covered by unit
  tests only.
- `coreslot_validator_update_emitted` is now ingested from `finalize_block_events`, but the
  temporal map still does not derive windows directly from those events.
- Suspension, removal, immediate-applied rotation, and explicit lifecycle
  `effective_height` remain corrected by consistency, not live-proven.
- No PostgreSQL exclusion constraint enforces temporal non-overlap; projector logic and
  tests enforce it for now.

## 14. Explicit Non-Goals

- No block signature / liveness ingestion.
- No proposer enrichment.
- No rewards projection.
- No API routes.
- No web pages.
- No generated gRPC clients.
- No buf migration.
- No chain repo changes.
- No staking/gov/mint/distribution compatibility.

## 15. Next Recommended Step

The live rerun is complete (section 11), so the amended Option A is no longer required —
Option B already validated the same boundaries and the slot-4 canary.

Proceed to Phase 8 liveness / uptime using the corrected temporal map boundary. Phase 8 must
account for the genesis-window coverage gap: an operator active from genesis has no
`CoreSlotConsensusWindow` until it emits a lifecycle/rotation event, so "no window at height H"
for a known genesis validator should be treated as a backfill gap, not as "not signing." A
follow-up option is to derive validator-set windows directly from
`coreslot_validator_update_emitted` (now ingested), which would also seed genesis membership
and remove this gap.
