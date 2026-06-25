# Contributing

Thanks for helping make Twilight Core Explorer sturdier. This project is intentionally
Twilight-native: it models CoreSlot PoA, rewards, and operator liveness without pretending the
chain exposes standard Cosmos staking/governance/mint/distribution modules.

## Ground Rules

- Keep generic indexed rows canonical. Semantic projections must be derived and rebuildable.
- Put chain transport behind `packages/chain-client`; projectors should not call raw REST/RPC
  routes directly.
- Do not add `/cosmos/staking`, `/cosmos/gov`, `/cosmos/mint`, or `/cosmos/distribution`
  dependencies.
- Preserve raw source payloads for audit/debug when adding new persistence.
- Use deterministic failure keys for projection failures.
- Keep normal tests live-chain-free.

## Development

```sh
npm install
npm run db:generate
npm run typecheck
npm test
npm run lint
```

For local Postgres-backed checks:

```sh
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public npm run db:deploy
```

## Pull Requests

- Keep changes scoped to one phase or concern.
- Include or update tests for behavior changes.
- Update `docs/research/explorer-project-checkpoint.md` when a phase/status changes.
- Add a phase report under `docs/research/` for substantial indexer/projection work.
- Run the validation commands above before requesting review.

## Architecture Notes

Read [CLAUDE.md](./CLAUDE.md) before making larger changes. It is public on purpose: it captures
the project invariants that keep humans and coding agents aligned.
