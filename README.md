# Twilight Core Explorer

A Twilight-native blockchain explorer for **Twilight Core** — a CometBFT chain with a custom
**CoreSlot PoA** validator model and a native **`x/rewards`** module. It indexes chain data
into canonical generic rows and derives rebuildable semantic projections for CoreSlot
ownership/lifecycle, consensus key rotation, the validator-set timeline, and rewards/economics.

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
| `apps/indexer` | ingestion + semantic projections (`api/`, `web/` are future) |
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
map) and rewards semantic projection are implemented. Block-signature ingestion + liveness,
the HTTP API, and the web UI are upcoming. Status is tracked in the project checkpoint.
