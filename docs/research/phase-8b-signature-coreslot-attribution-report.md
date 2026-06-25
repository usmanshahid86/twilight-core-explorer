# Phase 8b — Signature-To-CoreSlot Attribution Report

Date: 2026-06-25

Status: PASS.

## 1. Summary

Phase 8b adds `operator_signing_evidence_v1`, a rebuildable projection from Phase 8a
`BlockSignature` rows into `OperatorSigningEvidence` rows.

The projection attributes observed commit-signature evidence to historical CoreSlot ownership
by joining `BlockSignature.validatorAddress` against `CoreSlotConsensusWindow` at
`BlockSignature.committedBlockHeight`.

It does not read live RPC, modify generic ingestion, compute liveness percentages, compute
missed-signature counts, enrich proposers, or expose API/web surfaces.

## 2. Files Changed

Code and schema:

- `prisma/schema.prisma`
- `prisma/migrations/20260625002000_operator_signing_evidence/migration.sql`
- `apps/indexer/src/projections/operator-signing-evidence.ts`
- `apps/indexer/src/projections/operator-signing-evidence-cli.ts`
- `apps/indexer/src/projections/reset-operator-signing-evidence.ts`
- `apps/indexer/src/projections/reset-operator-signing-evidence-cli.ts`
- `apps/indexer/src/projections/types.ts`
- `apps/indexer/package.json`

Tests and docs:

- `apps/indexer/test/projections/operator-signing-evidence.test.js`
- `docs/research/phase-8b-signature-coreslot-attribution-report.md`
- `docs/research/explorer-project-checkpoint.md`

## 3. Prisma Model / Migration

Migration `20260625002000_operator_signing_evidence` adds `OperatorSigningEvidence`:

- deterministic `signatureKey @unique`
- `sourceBlockHeight`
- `committedBlockHeight`
- `signatureIndex`
- `validatorAddress`
- historical `slotId`, `operatorAddress`, `consensusPower`, `consensusWindowId`
- explicit `attributionStatus`
- preserved `blockIdFlag`, `blockIdFlagCode`, `signed`, and `rawSignatureJson`

The table is derived and rebuildable from `BlockSignature` plus `CoreSlotConsensusWindow`.

## 4. Projection Design

Projection name: `operator_signing_evidence_v1`.

The projection:

- reads existing `BlockSignature` rows only.
- drives range/cursor progress by `sourceBlockHeight`, matching `block_signatures_v1`.
- attributes by `committedBlockHeight`, never by `sourceBlockHeight`.
- uses deterministic upserts by `signatureKey`.
- refreshes attribution fields on rerun so later temporal-map backfill can update old
  `no_consensus_window` rows.
- uses `ProjectionCursor` / `ProjectionFailure`, not `IndexerCursor`.

Sparse ranges iterate existing `BlockSignature` rows. Missing numeric source heights do not
create false failures.

## 5. Attribution Source

Historical attribution comes from `CoreSlotConsensusWindow`.

The projector stores `slotId`, `operatorAddress`, `consensusPower`, and `consensusWindowId`
from the matched historical window row. It does not read current `CoreSlotProjection`
snapshot state, because current operator/power state must not rewrite past evidence.

## 6. Height Semantics

Input height fields:

- `sourceBlockHeight`: containing block height `N`.
- `committedBlockHeight`: height signed by `last_commit`, normally `N - 1`.

Attribution height:

```text
BlockSignature.committedBlockHeight
```

This phase does not use `header.proposer_address`.

## 7. Temporal Map Usage

The projector reuses:

```text
findConsensusWindowAtHeight(prisma, validatorAddress, committedBlockHeight)
```

It does not reimplement the consensus-address temporal join.

To distinguish coverage gaps from unmapped validators, it performs a narrow read-only
coverage check:

```text
count CoreSlotConsensusWindow where effectiveFromHeight <= committedBlockHeight
and (effectiveToHeight is null or effectiveToHeight > committedBlockHeight)
```

This check answers only whether any temporal coverage exists at the committed height. It is
not a second attribution join.

## 8. Attribution Statuses

Statuses:

- `attributed`: validator address maps to an active CoreSlot consensus window at committed
  height.
- `absent_no_validator`: `validatorAddress = null` and `blockIdFlagCode = 1`.
- `no_consensus_window`: no temporal windows cover committed height.
- `unmapped_validator`: temporal coverage exists, but this validator address does not map.
- `invalid_validator_address`: Phase 8a invalid-address evidence exists, or Phase 8b can
  prove a malformed address.
- `unknown_shape`: residual malformed input such as null validator address on a non-absent
  vote without an 8a invalid-address failure.

Core invariants:

- unmapped signature does not mean missed signature.
- no consensus window does not mean missed signature.
- absent no-validator does not mean missed signature.
- invalid validator address does not mean missed signature.

## 9. Failure Behavior

Expected attribution gaps are represented as rows, not failures.

Projection failures are reserved for malformed state:

- `invalid_committed_height`
- `missing_required_block_signature_field`
- `malformed_temporal_window`
- `database_write_failure`
- `unknown_operator_signing_evidence_shape`
- `invalid_validator_address`

Failures use deterministic `failureKey` upserts. Reruns do not duplicate unresolved failures.

## 10. Genesis / Backfill Handling

If no `CoreSlotConsensusWindow` covers `committedBlockHeight`, the row is written with
`attributionStatus = no_consensus_window`.

This is a coverage/backfill/genesis gap, not validator failure. Phase 8b does not implement
liveness gating.

TODO for Phase 8c:

- seed genesis windows, or
- declare `coverageStartHeight`, or
- require explicit backfill before enabling liveness.

Recommended later default: `coverageStartHeight = first height where CoreSlot temporal
windows are known`.

## 11. Reset / Rebuild Behavior

`resetOperatorSigningEvidenceProjection` deletes only:

- `OperatorSigningEvidence`
- `ProjectionFailure` where `projectionName = operator_signing_evidence_v1`
- `ProjectionCursor` where `projectionName = operator_signing_evidence_v1`

It preserves generic rows, `BlockSignature`, CoreSlot semantic rows, rewards rows, and
unrelated projection cursors/failures.

## 12. Tests

Added `apps/indexer/test/projections/operator-signing-evidence.test.js` covering:

- successful attribution to historical CoreSlot window.
- `committedBlockHeight` over `sourceBlockHeight`.
- validator-update boundary behavior via temporal windows.
- `no_consensus_window`.
- `unmapped_validator`.
- absent entries as `absent_no_validator`.
- invalid validator-address distinction.
- historical window values over current CoreSlot snapshot values.
- idempotent rerun and attribution refresh.
- scoped reset safety.
- no liveness, missed counts, proposer, API, or web scope.

## 13. Optional Local DB Smoke

Not run. Local Postgres at `localhost:5432` was unavailable during this pass:

```text
Can't reach database server at `localhost:5432`
```

`prisma migrate deploy` and Prisma Client connectivity both failed for the same local DB
availability reason, not because of a schema generation error. `npm run db:generate`
passed.

Expected checks when local Postgres is restarted:

- `OperatorSigningEvidence` count equals projected `BlockSignature` count for the range.
- expected no-window/backfill rows are represented without failures.
- attributed rows appear where temporal window coverage exists.
- unresolved unexpected `operator_signing_evidence_v1` failures are zero.
- cursor is idle at `END_HEIGHT`.

## 14. Known Limitations

- no liveness percentages.
- no missed-signature counts.
- no expected signer-set enumeration.
- no proposer enrichment.
- no API/web pages.
- genesis/backfill coverage decision remains for Phase 8c.
- `unknown_shape` rows indicate malformed residual evidence that should be inspected before
  using attribution for production liveness.

## 15. Explicit Non-Goals

- no liveness percentages.
- no missed-signature counts.
- no proposer enrichment.
- no API routes.
- no web pages.
- no rewards changes.
- no staking/gov/mint/distribution routes.

## 16. Next Recommended Step

Phase 8c: liveness/uptime computation design and implementation, after deciding the
coverage-start/backfill rule and expected signer-set enumeration.
