# Phase 8a — Block Signature Ingestion Foundation Report

Date: 2026-06-25

Status: PASS.

## 1. Summary

Phase 8a adds `block_signatures_v1`, a rebuildable projection from indexed `Block.rawJson`
into durable `BlockSignature` rows.

The projector reads only stored generic block data. It does not query live RPC, mutate
generic rows, attribute signatures to CoreSlot slots, compute liveness percentages, enrich
proposers, or expose API/web surfaces.

## 2. Files Changed

Code and schema:

- `prisma/schema.prisma`
- `prisma/migrations/20260625001000_block_signature_projection/migration.sql`
- `apps/indexer/src/projections/block-signatures.ts`
- `apps/indexer/src/projections/block-signatures-cli.ts`
- `apps/indexer/src/projections/reset-block-signatures.ts`
- `apps/indexer/src/projections/reset-block-signatures-cli.ts`
- `apps/indexer/src/projections/types.ts`
- `apps/indexer/package.json`

Tests and docs:

- `apps/indexer/test/projections/block-signatures.test.js`
- `docs/research/phase-8a-block-signature-ingestion-report.md`
- `docs/research/explorer-project-checkpoint.md`

## 3. Prisma Model / Migration

Migration `20260625001000_block_signature_projection` adds `BlockSignature`:

- deterministic `signatureKey @unique`
- `sourceBlockHeight`
- `committedBlockHeight`
- `signatureIndex`
- normalized `validatorAddress`
- raw and numeric `blockIdFlag`
- `signed`
- timestamp/signature fields
- preserved `rawSignatureJson`

The table is derived and rebuildable from `Block.rawJson`.

## 4. Why This Is A Projection

`Block.rawJson` is canonical generic indexed data. `BlockSignature` rows are a normalized
read model over that raw payload, so they belong in the `ProjectionCursor` /
`ProjectionFailure` pattern as `block_signatures_v1`.

Generic ingestion was not changed. Local DB inspection confirmed stored block raw JSON
preserves `result.block.last_commit.height` and `result.block.last_commit.signatures`.

## 5. Block.rawJson Source Path

Observed localnet shape:

```text
Block.rawJson.result.block.last_commit.height
Block.rawJson.result.block.last_commit.signatures[]
```

Each signature contains:

- `validator_address`
- `block_id_flag`
- `timestamp`
- `signature`

The extractor also tolerates `rawJson.block.last_commit` for alternate fixture shapes.

## 6. CometBFT Height Semantics

Stored fields:

- `sourceBlockHeight`: containing block height `N`.
- `committedBlockHeight`: height being committed/signed.

Rule:

```text
committedBlockHeight = block.rawJson.result.block.last_commit.height
```

Fallback only when the payload omits `last_commit.height`:

```text
committedBlockHeight = sourceBlockHeight - 1
```

Do not confuse this with proposer semantics:

- `header.proposer_address` belongs to block `N`.
- `last_commit.signatures` in block `N` sign committed block `N - 1`.

This phase stores commit-signature evidence only.

## 7. block_id_flag Semantics

The projection preserves both raw and parsed flag values:

- raw: `blockIdFlag`
- numeric: `blockIdFlagCode`

Conservative mapping:

- `1` / absent -> not signed
- `2` / commit / signed -> signed
- `3` / nil -> not signed

`absent` and `nil` are not collapsed. Phase 8c needs that distinction when computing missed
counts.

## 8. Validator Address Normalization

`validator_address` is normalized to lowercase 40-character hex and stored as
`validatorAddress`.

Malformed addresses preserve the raw signature JSON, set `validatorAddress = null`, and
record `ProjectionFailure(invalid_validator_address)`.

## 9. Failure Behavior

Projection name: `block_signatures_v1`.

Failure kinds:

- `missing_block_raw`
- `missing_last_commit`
- `missing_signatures`
- `invalid_signature_payload`
- `invalid_validator_address`
- `invalid_height`
- `unknown_block_signature_shape`

Failures use deterministic `failureKey` upserts. Reruns do not duplicate unresolved
failures. Projection failures do not halt generic indexing; unexpected write errors halt only
the `block_signatures_v1` cursor.

Genesis / first-block behavior:

- `sourceBlockHeight <= 1`: missing `last_commit` or signatures is skipped without failure.
- later heights: missing `last_commit` or signatures creates a projection failure.

## 10. Reset / Rebuild Behavior

`resetBlockSignaturesProjection` deletes only:

- `BlockSignature`
- `ProjectionFailure` where `projectionName = block_signatures_v1`
- `ProjectionCursor` where `projectionName = block_signatures_v1`

It preserves generic rows, CoreSlot semantic rows, rewards rows, and unrelated projection
cursors/failures.

## 11. Tests

Added `apps/indexer/test/projections/block-signatures.test.js` covering:

- extraction from `Block.rawJson.result.block.last_commit.signatures`
- `sourceBlockHeight` vs `committedBlockHeight`
- `last_commit.height` preference and `N - 1` fallback
- lowercase validator address normalization
- raw and numeric `block_id_flag`
- absent / commit / nil distinction
- `signed = true` only for commit
- raw signature preservation
- idempotent rerun
- genesis skip behavior
- missing `last_commit` / signatures failures
- malformed signature and invalid validator failures
- deterministic signature keys
- scoped reset safety
- cursor halt on write failure
- no CoreSlot attribution or liveness calculation

## 12. Optional Local DB Smoke

Local DB smoke passed after applying the migration and resetting prior experimental
`block_signatures_v1` rows:

```text
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public \
START_HEIGHT=119 END_HEIGHT=3585 \
npm --prefix apps/indexer run project:block-signatures:dev
```

Observed:

- `BlockSignature count = 131`
- unresolved `block_signatures_v1` `ProjectionFailure` count = `0`
- `block_signatures_v1` cursor idle at height `3585`
- sample row: `sourceBlockHeight = 119`, `committedBlockHeight = 118`
- sample `validatorAddress = a071ac8728912dab4405b9e7e106294cb27f0b15`
- sample `blockIdFlag = 2`, `blockIdFlagCode = 2`, `signed = true`
- `rawSignatureJson` preserved

## 13. Known Limitations

- no CoreSlot attribution yet.
- no uptime/liveness percentages yet.
- no proposer enrichment yet.
- genesis-window/backfill issue remains for Phase 8b.
- missed counts require expected-set logic and are not computed here.
- malformed signature payloads are recorded as projection failures but do not halt the
  projection.

## 14. Explicit Non-Goals

- no CoreSlot attribution.
- no genesis window seeding.
- no liveness percentages.
- no rolling uptime summaries.
- no missed-signature counts.
- no proposer enrichment.
- no API routes.
- no web pages.
- no rewards changes.
- no staking/gov/mint/distribution routes.

## 15. Forward Guardrails For Phase 8b / 8c

Phase 8b must reuse `findConsensusWindowAtHeight` /
`findSlotConsensusWindowAtHeight` from `coreslot-temporal-map.ts` rather than reimplementing
temporal joins.

Phase 8b must decide genesis-window seeding/backfill before treating unmapped signatures as
meaningful.

Invariant:

```text
unmapped signature != missed signature
```

Unmapped means coverage/backfill gap until expected-set attribution is complete.

Phase 8c missed-count calculation must use:

```text
expected signers at committed height
minus observed commit signatures at committed height
```

Do not compute missed counts in Phase 8a.

## 16. Next Recommended Step

Phase 8b: CoreSlot signature attribution over the temporal consensus map.

Do not start liveness percentages until attribution, expected signer sets, and genesis/backfill
semantics are explicit.
