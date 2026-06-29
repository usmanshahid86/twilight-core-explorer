# Twilight Core Explorer

A Twilight-native blockchain explorer for **Twilight Core** — a CometBFT chain with a custom
**CoreSlot PoA** validator model and a native **`x/rewards`** module. It indexes chain data
into canonical generic rows and derives rebuildable semantic projections for CoreSlot
ownership/lifecycle, consensus key rotation, the validator-set timeline, rewards/economics,
block signatures, operator signing evidence, CoreSlot liveness, and network health.

It is intentionally **not** a standard Cosmos staking explorer: there is no
staking/governance/mint/distribution support. Native denom is `utwlt` (display `TWLT`).

## Layout

TypeScript monorepo (npm workspaces):

| Path | Purpose |
|---|---|
| `packages/chain-client` | `ChainClient` transport boundary (CometBFT RPC + Cosmos/Twilight REST) |
| `packages/config` | env/config loading |
| `packages/db` | Prisma client |
| `packages/decoder` | descriptor-backed protobuf tx decoding |
| `packages/proto` | Twilight descriptor artifacts |
| `apps/indexer` | ingestion + semantic projections |
| `apps/api` | DB-only public REST/OpenAPI service (Phase 9; 32 paths) |
| `apps/web` | Next.js app-router explorer UI consuming the API (Phases 10–12) |
| `prisma/` | schema + migrations |
| `docs/research/` | one design/report doc per phase; the project checkpoint is the status index |

**Data model:** generic canonical rows (`Block`, `ExplorerTransaction`, `Message`, `Event`,
`Account`, …) are the source of truth; semantic projections are derived and rebuildable from
them.

## Quickstart

Prerequisites: Node ≥ 18, a PostgreSQL instance, and (for live ingestion) a Twilight Core
node exposing CometBFT RPC and REST.

```sh
npm install
npm run db:generate

# point at your database
export DATABASE_URL="postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public"
npm run db:deploy           # apply migrations

# ingest a height range from a node
export CHAIN_ID=twilight-localnet-1
export COMET_RPC_URL=http://127.0.0.1:26657
export REST_URL=http://127.0.0.1:1317
START_HEIGHT=1 END_HEIGHT=500 npm --prefix apps/indexer run start

# build the CoreSlot semantic projections (rebuildable from indexed rows)
RESET_PROJECTION=true npm --prefix apps/indexer run project:coreslot-semantic

# build the rewards semantic projection
RESET_PROJECTION=true npm --prefix apps/indexer run project:rewards

# build operator liveness projections
RESET_PROJECTION=true npm --prefix apps/indexer run project:block-signatures
RESET_PROJECTION=true npm --prefix apps/indexer run project:operator-signing-evidence
RESET_PROJECTION=true npm --prefix apps/indexer run project:coreslot-liveness
RESET_PROJECTION=true npm --prefix apps/indexer run project:coreslot-liveness-summary
RESET_PROJECTION=true npm --prefix apps/indexer run project:coreslot-health
```

Then serve the read-only API and the web UI:

```sh
# DB-only public API (defaults to :8080; reuses DATABASE_URL locally, API_DATABASE_URL in prod)
npm --prefix apps/api run dev

# web explorer (Next.js on :3000) pointed at the API
export NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
npm --prefix apps/web run dev
```

## Development

```sh
npm run typecheck
npm test
npm run lint
npm --prefix apps/indexer test
npm --prefix packages/chain-client test
```

See **[CLAUDE.md](./CLAUDE.md)** for the architecture invariants, conventions, the full
validation ritual, and local-dev details. See
**[docs/research/explorer-project-checkpoint.md](./docs/research/explorer-project-checkpoint.md)**
for current status and the phase history.

## Status

The full stack is built and live-validated: the indexer + all semantic projections (CoreSlot
metadata/lifecycle/payout/params, key rotation, temporal consensus map; rewards semantic + snapshots;
block-signature ingestion → operator signature attribution → CoreSlot liveness evidence/summaries →
health & network halt-risk; proposer attribution), the DB-only public **API** (Phase 9; 32 OpenAPI
paths), and the **web** explorer (Phases 10–12: generic pages, CoreSlot/liveness/network/operator
surfaces, and the read-only rewards/supply economic pages). **Phase 13 (explorer hardening & RC pass)
is complete** — Fastify server hardening, an executable RC checklist (`npm run rc-check`), and a
~2,500-block localnet soak, RC-tagged `explorer-phase-13`. Next up is **deployment & operations
(Phase 14)**.

## Current Scope

Implemented:

- Generic block, transaction, message, event, account, cursor, and decode-failure indexing.
- Descriptor-backed Cosmos SDK raw transaction decoding.
- CoreSlot semantic projections and deterministic rebuild/reset tooling.
- Rewards semantic and observed-snapshot projections.
- Block-signature ingestion, signature-to-CoreSlot attribution, liveness evidence, liveness
  summaries, CoreSlot/network health snapshots, and proposer attribution.
- The DB-only public REST/OpenAPI **API** (Phase 9; 32 paths).
- The **web** explorer (Phase 10 foundation + generic pages; Phase 11 CoreSlot/liveness/network +
  the first-class operator page; Phase 12 read-only rewards/supply economic pages). The rewards
  surface is intentionally read-only — claiming is CLI-only, not an in-app action.
- **Hardening & release readiness (Phase 13):** API security headers / cache-control / in-process
  rate limiting, a real linter + static guards, the executable RC checklist (`npm run rc-check`,
  incl. the `RC_LIVE` live tier), and a ~2,500-block localnet soak (GREEN). See
  `docs/operations/explorer-release-readiness.md`.

Not yet implemented:

- Production deployment packaging + operating runbooks (Phase 14): the rate-limit shared store /
  proxy keying, fail-closed env resolution, the production CORS allow-list, build-metadata injection,
  and indexer lag-monitoring / gap-detection. The primary **devnet** soak is a deferred Phase-13d
  acceptance item (Issue #41).
- Generated gRPC/proto client transport behind `ChainClient`.

Status is tracked in the project checkpoint.

## License

Apache-2.0. See [LICENSE](./LICENSE).
