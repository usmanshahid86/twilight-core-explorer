# Twilight Core Explorer Phase 6b-2 Temporal Consensus Map Recovery Report

Date: 2026-06-25

Status: PASS

## 1. Summary

Phase 6b-2 recovers and completes the temporal consensus map / validator-set timeline work.
It adds a rebuildable `CoreSlotConsensusWindow` projection that maps:

```text
consensusAddress -> slotId/operator/status/power over height windows
```

The projection is derived from existing semantic rows:

- `CoreSlotLifecycleEvent`
- `CoreSlotConsensusKeyRotation`

Generic canonical rows remain untouched. The map is now available as the dependency for later
proposer-to-slot enrichment, block signature attribution, liveness windows, operator
timelines, and validator-set audit views. Those downstream consumers are intentionally not
implemented in this phase.

## 2. Audit Result of Claude Partial Work

Decision: Path B — repair heavily.

Reusable:

- The partial `CoreSlotConsensusWindow` model concept was appropriate and was kept.
- Existing Phase 6b-1 key-rotation rows were suitable input for this projection.
- Existing combined reset / rebuild patterns and deterministic `ProjectionFailure.failureKey`
  helper were reusable.

Needs repair:

- The model needed explicit ACTIVE signing-window semantics.
- No migration existed for the model.
- No projection constants, projector, CLI, reset helper, query helpers, combined rebuild
  integration, or report existed.
- Combined in-memory tests needed to model Prisma-generated lifecycle ids because temporal
  windows retain `openedByLifecycleId` / `closedByLifecycleId`.

Discarded / replaced:

- No unsafe temporal-map projector existed, so there was no projection logic to discard.
- The untracked empty `CLAUDE.md` file was left untouched.

Missing:

- Temporal projection implementation.
- Half-open interval query helpers.
- Conflict checks.
- Individual temporal reset command.
- Combined CoreSlot semantic rebuild integration after key rotation.
- Unit tests for lifecycle-derived windows, key-rotation-derived windows, conflicts,
  idempotency, reset behavior, and height semantics.

Risky decisions:

- Effective-height behavior uses an explorer-side rule for now: validator-set-affecting
  events at height `H` become effective at `H + 1` unless the event explicitly carries
  `effective_height`. This must be confirmed with a live localnet validator-set fixture.
- PostgreSQL exclusion constraints were not added; overlap prevention currently lives in
  projector logic and tests.
- When a key rotation lacks `oldConsensusAddress`, the projector closes exactly one open
  slot window only when unambiguous; multiple open windows produce
  `temporal_window_ambiguous`.

## 3. Files Kept / Repaired / Added

Kept and repaired:

- `prisma/schema.prisma`
  - completed `CoreSlotConsensusWindow` as the ACTIVE temporal window table.
- `apps/indexer/src/projections/types.ts`
  - added `coreslot_temporal_map_v1`, extended CoreSlot semantic projection ordering, and
    added temporal failure kinds.
- `apps/indexer/src/projections/reset-semantic.ts`
  - combined reset now clears temporal windows.
- `apps/indexer/src/projections/coreslot-semantic-rebuild.ts`
  - combined rebuild now runs temporal map after key rotation.
- `apps/indexer/test/projections/coreslot-key-rotation.test.js`
  - combined rebuild/reset coverage now includes temporal map.
- `apps/indexer/test/projections/coreslot-semantic-rebuild.test.js`
  - combined rebuild/reset tests now include temporal windows and the temporal-map cursor.

Added:

- `prisma/migrations/20260625000600_coreslot_temporal_consensus_map/migration.sql`
- `apps/indexer/src/projections/coreslot-temporal-map.ts`
- `apps/indexer/src/projections/coreslot-temporal-map-cli.ts`
- `apps/indexer/src/projections/reset-temporal-map.ts`
- `apps/indexer/src/projections/reset-coreslot-temporal-map.ts`
- `apps/indexer/test/projections/coreslot-temporal-map.test.js`
- `docs/research/phase-6b-2-temporal-consensus-map-report.md`

## 4. Prisma Model / Migration

Added `CoreSlotConsensusWindow`.

Important fields:

- `slotId`
- `operatorAddress`
- `consensusAddress`
- `status` (`ACTIVE` signing window)
- `consensusPower`
- `effectiveFromHeight`
- `effectiveToHeight`
- open source refs: `openedByKind`, `openedByEventId`, `openedByRotationId`,
  `openedByLifecycleId`
- close source refs: `closedByKind`, `closedByEventId`, `closedByRotationId`,
  `closedByLifecycleId`
- `rawOpenJson`
- `rawCloseJson`

Indexes cover slot, operator, consensus address, window bounds, status, and common
`slotId/effectiveFromHeight` plus `consensusAddress/effectiveFromHeight` queries.

No generic canonical tables were changed.

## 5. Temporal Window Model and Half-Open Intervals

`CoreSlotConsensusWindow` uses half-open interval semantics:

```text
[effectiveFromHeight, effectiveToHeight)
```

A window applies at height `H` when:

```text
effectiveFromHeight <= H
and (effectiveToHeight is null OR H < effectiveToHeight)
```

`effectiveToHeight` is exclusive, not inclusive. Query helpers and tests enforce this.

The table represents ACTIVE signing windows only. Pending, inactive, suspended, and removed
states are represented by the absence or closure of an ACTIVE window, not by inactive
window rows.

## 6. Effective-Height Rule

Explorer-side rule for now:

- If an event carries `effective_height`, use it.
- Otherwise a validator-set-affecting event emitted at height `H` becomes effective for
  consensus identity at `H + 1`.
- For key rotations, use `CoreSlotConsensusKeyRotation.effectiveHeight` when present;
  otherwise use `appliedHeight + 1`.

TODO: confirm activation and key-rotation validator-set effective boundaries with live
localnet fixtures.

Correction from Phase 6b-3 / Phase 6b-4:

- The `H + 1` rule above is obsolete for block-height validator-set membership windows.
- Live localnet evidence showed validator update at `H`, `next_validators_hash` changing at
  `H + 1`, and `/validators?height` membership changing at `H + 2`.
- Phase 6b-4 adds `CoreSlotConsensusWindow.validatorUpdateHeight` and updates
  `effectiveFromHeight` / `effectiveToHeight` to use `validatorUpdateHeight + 2`.
- The same `+2` membership rule is applied to suspension, removal, immediate-applied
  rotation, and explicit lifecycle `effective_height` cases by consistency, but those cases
  still need dedicated live fixture coverage.
- A future robust design should derive validator-set entry/exit windows directly from
  `coreslot_validator_update_emitted`; Phase 6b-4 keeps the lifecycle/key-rotation semantic
  row approach and aligns it to the observed membership boundary.

Height semantics retained for later consumers:

- `block.header.proposer_address` belongs to block height `N`, so proposer enrichment should
  query the temporal map at height `N`.
- `block.last_commit.signatures` in block `N` are signatures for committed block `N - 1`,
  so future liveness attribution should query the temporal map at height `N - 1`.

## 7. Lifecycle-Derived Window Behavior

Lifecycle input rows:

- `coreslot_registered`
- `coreslot_activated`
- `coreslot_inactivated`
- `coreslot_suspended`
- `coreslot_removed`

Rules:

- `coreslot_registered` does not open an ACTIVE signing window.
- `coreslot_activated` opens an ACTIVE window when it has a valid consensus address.
- `coreslot_inactivated`, `coreslot_suspended`, and `coreslot_removed` close any open
  ACTIVE window for the slot at the effective height.
- Duplicate activation for the same slot/address/effective height updates the existing
  window instead of creating an overlap.
- Activating a slot while a different open window exists for the same slot closes the old
  window at the new effective height before opening the new one.

## 8. Key-Rotation-Derived Window Behavior

Key rotation statuses:

- `requested`
- `immediate_applied`
- `applied`
- `cancelled`

Rules:

- `requested` does not open or close windows.
- `cancelled` does not open or close windows.
- `immediate_applied` and `applied` close the old ACTIVE window and open a new ACTIVE window
  at the rotation effective height.
- If `oldConsensusAddress` is present, only the matching open window is closed.
- If `oldConsensusAddress` is missing, exactly one open slot window may be closed if the
  state is unambiguous.
- If multiple open slot windows exist and old address is missing, the projection records
  `temporal_window_ambiguous` and does not open a misleading new window.
- Invalid or missing new consensus addresses create `invalid_consensus_address` and do not
  open a window.

Requested or cancelled rotations never produce ACTIVE windows.

## 9. Conflict / Validation Rules

The projector prevents these impossible states:

- one slot mapped to two ACTIVE windows at the same height.
- one consensus address mapped to multiple slots at the same height.
- `effectiveToHeight <= effectiveFromHeight`.
- requested/cancelled rotations opening active windows.
- suspended/inactivated/removed slots staying open past the close height.

Failures use deterministic `ProjectionFailure.failureKey` upserts. New temporal failure kinds:

- `missing_activation_window`
- `temporal_window_conflict`
- `temporal_window_ambiguous`
- `temporal_order_ambiguous`
- `effective_height_invalid`
- `rotation_correlation_failed`
- `unknown_semantic_type`

Per-height unresolved temporal failures are cleared before recompute, and deterministic keys
avoid duplicate unresolved failures on idempotent reruns.

## 10. Query Helpers

Added internal helpers:

- `findConsensusWindowAtHeight(prisma, consensusAddress, height)`
- `findSlotConsensusWindowAtHeight(prisma, slotId, height)`
- `findSlotConsensusWindowAtHeight(prisma, slotId, consensusAddress, height)`

These helpers normalize consensus hex addresses and apply half-open interval logic. No API
routes are exposed yet.

## 11. Reset / Rebuild Integration

Individual temporal reset deletes only:

- `CoreSlotConsensusWindow`
- `ProjectionFailure` where `projectionName = coreslot_temporal_map_v1`
- `ProjectionCursor` where `projectionName = coreslot_temporal_map_v1`

Combined CoreSlot semantic reset now also clears temporal windows. Generic rows and unrelated
semantic rows are preserved by individual temporal reset.

Combined rebuild order is now:

```text
metadata -> lifecycle -> payout -> params -> key_rotation -> temporal_map
```

The temporal map runs last because it depends on lifecycle and key-rotation semantic rows.

## 12. Tests

Added `apps/indexer/test/projections/coreslot-temporal-map.test.js` with 25 tests covering:

1. activation opens ACTIVE consensus window.
2. pending registration does not open ACTIVE consensus window.
3. inactivation closes open window at effective height.
4. suspension closes open window at effective height.
5. removal closes open window at effective height.
6. applied key rotation closes old window and opens new window.
7. immediate applied key rotation closes old window and opens new window.
8. requested rotation does not open or close windows.
9. cancelled rotation does not open or close windows.
10. missing old address closes exactly one open slot window if unambiguous.
11. missing old address plus multiple open windows emits `temporal_window_ambiguous`.
12. invalid new consensus address emits `invalid_consensus_address`.
13. duplicate activation does not create overlapping duplicate windows.
14. same consensus address cannot map to two slots at the same height.
15. same slot cannot have two active windows at the same height.
16. `effectiveToHeight` must be greater than `effectiveFromHeight`.
17. consensus-address query helper uses half-open interval logic.
18. slot query helper uses half-open interval logic.
19. proposer joins should query block height `N`.
20. future signature attribution should query committed height `N - 1`.
21. idempotent rerun does not duplicate windows or failures.
22. reset deletes temporal rows and preserves generic plus other semantic rows.
23. combined rebuild order includes temporal map after key rotation.
24. unknown key-rotation status records `unknown_semantic_type`.
25. temporal map projection does not mutate generic rows.

Combined semantic rebuild tests were extended so ordering, reset behavior, cursor advance, and
real-projector rebuild paths include temporal map.

## 13. Optional Local Smoke

Local Postgres was available; migration applied via `npm run db:deploy`.

Temporal map projection over the known metadata-only smoke range:

```text
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public \
CHAIN_ID=twilight-localnet-1 \
START_HEIGHT=119 END_HEIGHT=121 RESET_PROJECTION=true \
npm --prefix apps/indexer run project:coreslot-temporal-map:dev
```

Result:

- `CoreSlotConsensusWindow = 0`
- temporal map `ProjectionFailure = 0`
- `coreslot_temporal_map_v1` cursor idle at height 121

Combined semantic rebuild over the same range:

- `CoreSlotProjection = 1`
- `CoreSlotMetadataChange = 1`
- `CoreSlotLifecycleEvent = 0`
- `CoreSlotPayoutChange = 0`
- `CoreSlotParameterChange = 0`
- `CoreSlotConsensusKeyRotation = 0`
- `CoreSlotConsensusWindow = 0`
- CoreSlot `ProjectionFailure = 0`
- all six CoreSlot projection cursors idle at height 121
- generic rows preserved (`Block = 3`, `ExplorerTransaction = 1`, `Message = 1`,
  `Event = 5`)

Zero temporal windows is expected for this range because it only contains the Phase 6a-1
metadata update transaction.

## 14. Live / Localnet Fixture Result

A dedicated live activation / delayed key-rotation fixture was not produced in this phase.
The current validation uses synthetic lifecycle and key-rotation fixtures plus the existing
metadata-only local smoke range.

TODO: create a localnet fixture that exercises activation, delayed key rotation, and closure
events to confirm the explorer-side `H + 1` effective-height assumption against observed
validator-set behavior.

## 15. Validation

```text
npm install                         # passed, already up to date
npm run db:generate                 # passed
npm run typecheck                   # passed
npm test                            # passed
npm run lint                        # passed
npm --prefix apps/indexer test      # 120 passed, 1 skipped, 0 failed
DATABASE_URL=... npm run db:deploy  # passed, migration applied
```

Static guards:

```text
grep -R "/twilight/coreslot/v1/slots/active" apps packages prisma docs scripts \
  --exclude-dir=node_modules || true
```

Only an old validation command embedded in a prior report matched; no implementation
reference exists.

```text
grep -R "/cosmos/staking\|/cosmos/gov\|/cosmos/mint\|/cosmos/distribution" \
  apps packages prisma docs scripts --exclude-dir=node_modules || true
```

Matches are docs-only guardrails / historical non-goals. No source dependency was added.

## 16. Known Limitations

- The original effective-height boundary note is superseded by Phase 6b-3 / 6b-4 evidence
  for inactivation, reactivation, and delayed key rotation. Suspension, removal,
  immediate-applied rotation, and explicit lifecycle `effective_height` still need live
  fixture coverage.
- No database exclusion constraint enforces non-overlap; prevention is in projector logic and
  tests for now.
- `coreslot_validator_update_emitted` is not projected.
- Only ACTIVE signing windows are represented.
- No proposer-to-slot enrichment or block-signature attribution yet.
- No liveness / uptime projection yet.
- No API routes or web pages yet.

## 17. Explicit Non-Goals

- No block signature / liveness ingestion.
- No proposer enrichment.
- No rewards projection.
- No API routes.
- No web pages.
- No generated gRPC clients.
- No buf migration.
- No chain repo changes.
- No staking/gov/mint/distribution compatibility.

## 18. Next Recommended Step

Phase 8 operator liveness / uptime design can now consume the temporal map rather than
building a parallel consensus-address mapping. Before productionizing liveness, add a live
localnet fixture that confirms activation and key-rotation effective-height boundaries.

## 19. Correction Note (2026-06-25, Phase 8c-0) — genesis seeding is a missing prerequisite

The event-only design here has a structural gap: **genesis CoreSlots emit no indexable event**, so
the temporal map cannot be built from block events alone. Verified in the Twilight Core node source:
`InitGenesis` (`x/coreslot/keeper/genesis.go:22-41`) writes slot state directly with no
emit-registered/activated; the only event (`coreslot_validator_update_emitted`, `endblock.go:212`)
fires inside `InitChain` (`module.go:79-82`), which CometBFT never surfaces in `/block_results`.
Consequence: every genesis-created CoreSlot is invisible to this projection until it emits a later
lifecycle/rotation event, so its signatures fail cons-addr→slot resolution (founding validators
mis-reported as unmapped at launch).

Fix (rebuildable, additive): a **genesis-baseline seed** — `ChainClient.getGenesis()` over CometBFT
`/genesis`, parse `app_state.coreslot.{slots, …}`, open one ACTIVE window per genesis slot at
`effectiveFromHeight = 1` (the `validatorUpdateHeight + 2` offset does **not** apply to the genesis
set), then replay event deltas from h1+. See `docs/research/phase-8c-0-coverage-truth-report.md` §5.
This is a prerequisite for Phase 8c liveness and should precede the event replay in the temporal-map
rebuild order.
