# Phase 9d-0 — Account Balance & Supply Snapshot — Implementation Report

**Status: COMPLETE** (implemented, tested, live-validated against the localnet fixture + live REST)

Date: 2026-06-26

Materializes bank **supply** and **current account balances** as observed samples so Phase 9d can
expose `/supply` and account balances from a canonical DB source — never an ad-hoc API derivation and
never a live chain read from the API. Indexer-only; no API routes; no ChainClient changes.

## 1. Files changed

New (`apps/indexer/src/projections/`):
- `balance-snapshot.ts` — projector `projectBalanceSnapshot` (`balance_snapshot_v1`).
- `balance-snapshot-cli.ts` — CLI (advisory lock + height resolution + `EXTRA_BALANCE_ADDRESSES`).
- `reset-balance-snapshot.ts` — scoped reset fn.
- `reset-balance-snapshot-cli.ts` — reset CLI.
- `apps/indexer/test/projections/balance-snapshot.test.js` — 6 mock tests.

Changed:
- `prisma/schema.prisma` — new `AccountBalanceCurrent` model.
- `prisma/migrations/20260626000500_account_balance_current/migration.sql` — table + indexes (gitignored `*.sql` → `git add -f`).
- `apps/indexer/src/projections/types.ts` — `BALANCE_SNAPSHOT_PROJECTION='balance_snapshot_v1'`, `SUPPLY_SAMPLE_KIND='supply'`, failure kind `'balance_snapshot_chain_read_failed'`.
- `apps/indexer/package.json` — `project:balance-snapshot{,:dev,:reset}` scripts.

## 2. Schema / migration summary

`AccountBalanceCurrent` — one current row per `address`+`denom`:
```
id BIGSERIAL pk, balanceKey TEXT @unique ("{address}:{denom}"), address TEXT, denom TEXT,
amount TEXT, sampledAtHeight BIGINT, source TEXT default 'sampled', rawJson JSONB?,
createdAt, updatedAt; indexes: balanceKey (unique), address, sampledAtHeight
```
**Supply reuses `RewardsBalanceSample`** with `sampleKind='supply'` (already reserved by the schema) —
no dedicated `SupplySnapshot` model, no schema change for supply. `amount` is `TEXT` (BigInt-safe).

## 3. Projection behavior (`balance_snapshot_v1`)

Observed-sample projection (the sanctioned ChainClient exception, like `rewards_snapshot_v1`):
1. **Height** = `SAMPLE_HEIGHT ?? END_HEIGHT ?? max(Block.height)`.
2. **Address set** = distinct non-null `CoreSlotProjection.operatorAddress ∪ payoutAddress` (+ optional `EXTRA_BALANCE_ADDRESSES`), sorted.
3. **Read all chain state first** — `getSupply()` once, `getBalances(address)` per address. **No writes yet.**
4. On any read failure → `haltProjectionCursorError` + a `balance_snapshot_chain_read_failed` `ProjectionFailure`, and **return without writing any row** (never a guessed/partial value).
5. On success → **one `$transaction`**: upsert supply rows (`RewardsBalanceSample('supply')`, `sampleKey="{height}:supply:-:-:{denom}"`, all denoms) + upsert `AccountBalanceCurrent` per address+denom (latest wins). Then `updateProjectionCursorSuccess`.
- Zero-balance addresses return no coin → **no row** (absent ≠ fabricated zero). Module/rewards balances are not duplicated here (`rewards_snapshot_v1` owns them). Advisory lock held for the whole run.

**Reset** deletes only `AccountBalanceCurrent`, `RewardsBalanceSample` where `sampleKind='supply'`, and the `balance_snapshot_v1` cursor/failures — preserving module/treasury/cumulative rewards samples, CoreSlot rows, generic rows, and all other projection state.

## 4. Scripts added

```
project:balance-snapshot        node dist/projections/balance-snapshot-cli.js
project:balance-snapshot:dev    build && run
project:balance-snapshot:reset  node dist/projections/reset-balance-snapshot-cli.js
```
Env: `DATABASE_URL` (required), `REST_URL`/`COMET_RPC_URL`, `SAMPLE_HEIGHT`/`END_HEIGHT` (optional), `EXTRA_BALANCE_ADDRESSES` (optional CSV).

## 5. Test output

`apps/indexer` balance-snapshot suite: **7/7 pass** —
- supply writes `RewardsBalanceSample('supply')` per denom with correct `sampleKey`/`amount`/`height`;
- malformed supply coins (empty denom/amount) are skipped (no junk/trailing-colon `sampleKey` rows);
- supply rerun idempotent (upsert by `sampleKey`, amount refreshed);
- `AccountBalanceCurrent` upsert per address+denom, **bounded to distinct operator/payout** (dupes collapse, nulls ignored), **multi-denom stored**, amounts strings;
- latest account sample wins (rerun at higher height refreshes `amount`+`sampledAtHeight`);
- **chain read failure → 0 rows written + `ProjectionFailure` recorded + cursor `halted_error`**;
- reset deletes only the scoped rows (module_balance sample + other projections' cursor/failure preserved).

Full ritual (all green): `db:generate`, `typecheck` (all workspaces), `build`, **`apps/indexer` 257 pass / 0 fail**, `lint`, `git diff --check` clean, static guards (no staking/gov/mint/distribution), `db:deploy` applied `20260626000500_account_balance_current`.

## 6. Live validation output (localnet, height 3196, REST up)

Run: `[balance-snapshot] sampled at height 3196: 1 supply rows, 2 account balance rows across 5 addresses`.

- **Supply** `RewardsBalanceSample('supply')`: `utwlt = 2000000000000` @ height 3196 — **matches** `/cosmos/bank/v1beta1/supply` exactly.
- **AccountBalanceCurrent** (2 rows, `source=sampled`, `sampledAtHeight=3196`):
  - `twilight1cp3frfu…` `utwlt=1000000000000` — **✓ matches** `/balances/{address}`
  - `twilight1m7674p4…` `utwlt=1000000000000` — **✓ matches**
  - The other 3 of 5 distinct operator/payout addresses hold zero `utwlt` → cosmos omits them → **no rows** (correct; supply `2e12` = the two funded accounts).
- **REST-down drill** (REST pointed at a dead port): `cursor=halted_error`, 1 unresolved `balance_snapshot_chain_read_failed` failure, prior good rows preserved, **no partial/guessed writes**.
- **Reset CLI drill**: reset → re-sample restored `cursor=idle`, `supply=1`, `accountBalances=2`, `unresolvedFailures=0`.

## 7. Exact rows written / sample counts (height 3196)

| Output | Rows |
|---|---|
| `RewardsBalanceSample` (`sampleKind='supply'`) | **1** (`utwlt` = 2000000000000) |
| `AccountBalanceCurrent` | **2** (two funded operators, `utwlt` 1e12 each) |
| Addresses sampled (distinct operator∪payout) | 5 (3 with zero balance → no rows) |
| ChainClient calls | 1 × `getSupply` + 5 × `getBalances` |

## 8. Known limitations

- **Observed samples, not rebuildable** — a balance/supply is `x/bank` current state read live at `sampledAtHeight`; only the *latest* sample is reproducible (a pruned node can't reproduce old heights). Supply history is an append-only record of past observations.
- **Bounded address set** — operator/payout addresses only (the economically meaningful set). Sampling *all* `Account` rows is deferred (needs rate-limiting / on-activity sampling).
- **Zero balances are absent, not zero rows** — consumers must treat "no row" as "unknown/zero at last sample," not "explicitly zero."
- **`getBalances` pagination not handled** — a single page per address (wallets here hold 1–2 denoms); fine for this chain, revisit if an address ever holds >100 denoms.
- **Manual/CLI trigger** — no scheduler yet; periodic sampling (cron) is Phase 13 ops.
- **No API exposure** — `/supply` and account-balance endpoints land in Phase 9d (this phase is indexer/model only).
- Module-balance preservation on reset is covered by the unit test; the live fixture had **0** `module_balance` rows (rewards-snapshot wasn't run there), so live preservation was vacuously true.

## 9. Next steps

- Force-add the migration (`git add -f prisma/migrations/20260626000500_account_balance_current/migration.sql`) and commit the 9d-0 indexer additions.
- Phase **9d** (rewards API) can now expose `/api/v1/supply` (from `RewardsBalanceSample('supply')`) and account balances (from `AccountBalanceCurrent`), DB-only, marked `source:"sampled"` + `sampledAtHeight`; claims remain history-only until Phase 7.2.

**Phase 9d-0 Account Balance & Supply Snapshot: COMPLETE**
