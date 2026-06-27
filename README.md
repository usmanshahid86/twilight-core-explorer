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
| `apps/web` | Next.js app-router explorer UI consuming the API (Phase 10) |
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

CoreSlot semantic layer (metadata, lifecycle, payout/params, key rotation, temporal consensus
map), rewards semantic projection, rewards snapshots, block-signature ingestion, operator
signature attribution, CoreSlot liveness evidence, liveness summaries, and health/risk snapshots
are implemented.

## Current Scope

Implemented:

- Generic block, transaction, message, event, account, cursor, and decode-failure indexing.
- Descriptor-backed Cosmos SDK raw transaction decoding.
- CoreSlot semantic projections and deterministic rebuild/reset tooling.
- Rewards semantic and observed-snapshot projections.
- Block-signature ingestion, signature-to-CoreSlot attribution, liveness evidence, liveness
  summaries, and CoreSlot/network health snapshots.

Not yet implemented:

- Twilight-specific web pages: CoreSlot, liveness, rewards, and the operator page (Phase 11/12). The
  public API (Phase 9, 32 paths) and the web foundation + generic explorer pages — Overview, blocks,
  transactions, accounts, search (Phase 10a/10b) — are done.
- Production deployment packaging and operating runbooks.
- Generated gRPC/proto client transport behind `ChainClient`.

Status is tracked in the project checkpoint.

## License

Apache-2.0. See [LICENSE](./LICENSE).
