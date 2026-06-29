# CLAUDE.md — Twilight Core Explorer

Operating manual for working in this repo. Read this first, then
`docs/research/explorer-project-checkpoint.md` for current status.

## What this is

A Twilight-native blockchain explorer for **Twilight Core**, a CometBFT chain with a custom
**CoreSlot PoA** validator model and a native **`x/rewards`** module. It is NOT a standard
Cosmos staking chain. Native denom is `utwlt` (display `TWLT`).

Highest-value user: an operator/monitor asking "is my CoreSlot active and signing, what
lifecycle/authority actions happened, what rewards have I earned/claimed, what is the
network's halt/liveness risk."

## Architecture

TypeScript monorepo (npm workspaces):

```
packages/
  chain-client/  ChainClient transport boundary (CometBFT RPC + Cosmos/Twilight REST)
  config/        env/config loading
  db/            Prisma client export
  decoder/       descriptor-backed protobuf tx decoding
  proto/         Twilight descriptor artifacts
apps/
  indexer/       ingestion + semantic projections
  api/           DB-only public REST/OpenAPI service (Phase 9; 32 paths)
  web/           Next.js app-router explorer UI consuming the API (Phase 10)
prisma/          schema + migrations
docs/research/   one report per phase; checkpoint is the index/source of truth
```

Data model: **generic canonical rows** (`Block`, `ExplorerTransaction`, `Message`, `Event`,
`Account`, `DecodeFailure`, `IndexerCursor`) are ingested from chain data and are the single
source of truth. **Semantic projections** (CoreSlot lifecycle/metadata/payout/params/key-
rotation, temporal consensus map, rewards, block signatures, operator signing evidence,
liveness, and health) are *derived* and *rebuildable* from those rows.

## Hard invariants (do not violate)

- Generic canonical rows are authoritative; semantic projectors never mutate or delete them.
- Semantic projections must be **rebuildable** from generic rows + preserved raw payloads.
  Live-snapshot data (e.g. `getSlotRewards`, module balances) is an **observed sample** tied
  to a sampled height, NOT a rebuildable projection — keep the two categories separate.
- `ChainClient` is the only transport boundary. Indexers/projectors never call REST/RPC
  directly; add methods behind `ChainClient`.
- Failed transactions never create semantic state. Only successful tx + effect event do.
- **Ambiguous or inconsistent history becomes a `ProjectionFailure`, never a guessed value.**
- `ProjectionFailure` writes use a deterministic `failureKey` upsert (idempotent reruns).
- Block-height validator-set membership uses `validatorUpdateHeight + 2` (live-confirmed in
  Phase 6b-3/6b-4). Do not use `H+1` for proposer/liveness attribution.
- `EpochReward` / `epoch_finalized` is aggregate context, NOT current claim truth.
- Block-level events live under CometBFT `finalize_block_events` on this chain version
  (ABCI++); begin/end are empty. Projectors load such events by type with no `txHash` filter.
- Do NOT add or call `/cosmos/staking|gov|mint|distribution/*`. Do NOT reintroduce the stale
  route `/twilight/coreslot/v1/slots/active`. No staking/gov/mint/distribution models.

## Conventions

- A projection is a quartet: `X.ts` (projector: `projectXRange`/`projectXHeight` + a
  `XProjectionPrisma` interface), `X-cli.ts` (env + advisory lock + cursor), `reset-X.ts`
  (scoped reset function), `reset-coreslot-X.ts` / `*-cli.ts` (reset CLI). Projection names
  are versioned strings (`coreslot_lifecycle_v1`, `rewards_semantic_v1`, ...).
- Use `ProjectionCursor` + `ProjectionFailure`; never reuse `IndexerCursor` for projections.
- Migrations: `prisma/migrations/YYYYMMDDNNNNNN_name/migration.sql`, additive where possible.
- Tests: `apps/indexer/test/projections/*.test.js` using an in-memory mock-Prisma object and
  `node --test`. Normal tests must not require a live chain.
- Each phase ships `docs/research/phase-*-report.md`. Update old reports with **correction
  notes**, do not rewrite history. Keep the checkpoint's status/guardrails current.

## Validation ritual (run before declaring a phase done)

```sh
npm install
npm run db:generate
npm run typecheck
npm test
npm run lint
npm --prefix apps/indexer test
npm --prefix packages/chain-client test
# if a migration was added and local Postgres is up:
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public npm run db:deploy
```

Static guards (expect no stale/unsupported route *implementations*, only docs/guard refs):

```sh
grep -R "/twilight/coreslot/v1/slots/active" apps packages prisma docs scripts --exclude-dir=node_modules || true
grep -R "/cosmos/staking\|/cosmos/gov\|/cosmos/mint\|/cosmos/distribution" apps packages prisma docs scripts --exclude-dir=node_modules || true
```

## Local dev

- Postgres: `DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public`
- Localnet: `COMET_RPC_URL=http://127.0.0.1:26657`, `REST_URL=http://127.0.0.1:1317`
  (RPC is usually up; REST is sometimes down — snapshot/observed paths need REST).
- Ingest a range: `START_HEIGHT=.. END_HEIGHT=.. npm --prefix apps/indexer run start`
- Rebuild CoreSlot semantics: `... RESET_PROJECTION=true npm --prefix apps/indexer run project:coreslot-semantic`
  (order: metadata → lifecycle → payout → params → key_rotation → temporal_map).
- Combined reset replays globally — when correcting boundaries, reset + replay over the FULL
  indexed range, never a partial slice (a partial combined reset drops earlier history).

## Status

`docs/research/explorer-project-checkpoint.md` is the canonical status index. As of the latest work:
the full backend (CoreSlot semantics 6a/6b, rewards 7/7.2, liveness 8a–8c, proposer attribution), the
DB-only public API (Phase 9, 32 paths), the web explorer (Phases 10–12), and **Phase 13 — explorer
hardening & RC pass (13a–13d) — are complete**: the RC gate (`npm run rc-check`, incl. `RC_LIVE=1`) is
green, the ~2,500-block localnet soak ran GREEN (53 checks), adversarial + Codex reviewed PASS, tagged
`explorer-phase-13`. The one deferred acceptance item is the primary **devnet** soak (Issue #41 — localnet
only this pass). Next major work is **Phase 14 (deployment & operations)**; the generated gRPC/proto
clients remain a preserved later `ChainClient` transport.
