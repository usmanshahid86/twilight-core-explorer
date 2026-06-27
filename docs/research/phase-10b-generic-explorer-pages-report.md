# Phase 10b — Generic Explorer Pages — Implementation Report

**Status: COMPLETE** (implemented, typechecked, linted, tested, built). Date: 2026-06-27.
Branch: `feat/10b-generic-explorer-pages` (off merged `main`). Plan:
`docs/research/phase-10b-generic-explorer-pages-plan.md`.

Blocks, Transactions, and Accounts generic explorer pages (lists + details + sampled balances),
built on a keystone client enhancement (`apiGetPath`) and the first keyset-pagination pattern. Scope
held to 10b: no CoreSlot/liveness/network/rewards/supply/operator pages, no charts, no mutations, no
account tx history.

## 1. Files changed

**Foundation (modified):** `lib/api/client.ts` (+`apiGetPath`, extracted `request` core,
`missing_path_param` code), `lib/api/queries.ts` (+10 hooks, +list/detail response types).

**New components:** `list/PaginatedTable.tsx`; `detail/{DataList,DetailShell,JsonView,RawSection}.tsx`;
`blocks/{BlocksList,BlockDetail,BlockTxsSection}.tsx`; `txs/{TxsList,TxDetail}.tsx`;
`accounts/{AccountsList,AccountDetail,BalancesSection}.tsx`.

**Routes:** `blocks/page.tsx`, `txs/page.tsx`, `accounts/page.tsx` (placeholders → real lists);
`blocks/[height]/page.tsx`, `txs/[hash]/page.tsx`, `accounts/[address]/page.tsx` (new detail routes).

**Tests (new):** `client.test.ts` (+apiGetPath), `pagination.test.ts`, `search.test.ts`,
`list/PaginatedTable.test.tsx`, `blocks/BlockDetail.test.tsx`, `txs/TxDetail.test.tsx`,
`accounts/AccountDetail.test.tsx`. Web test files: 11 → **17**.

## 2. Routes implemented

`/blocks`, `/blocks/[height]`, `/txs`, `/txs/[hash]`, `/accounts`, `/accounts/[address]` (+ a sampled
balances section on account detail). Lists build static (`○`); details render on demand (`ƒ`, dynamic
params) — shells static, data fetched client-side.

## 3. Endpoint / field decisions (from generated OpenAPI types)

Only contract-exposed fields are rendered (verified at the type level — typecheck is green).

| Surface | Endpoint | Rendered fields | Omitted (present in contract) |
|---|---|---|---|
| Blocks list | `/blocks` | height, time, txCount, proposer (`operatorAddress→address→rawAddress`) | hash, chainId |
| Block detail | `/blocks/{height}` | height, hash, time, chainId, txCount, proposer{operator/address/raw, attributionStatus}, appHash, lastBlockHash | validatorsHash, nextValidatorsHash, createdAt, proposer.slotId (low operational value) |
| Block txs | `/txs?height=` | hash, index, messageTypes[0], status | gas/memo/signers (shown on tx detail) |
| Txs list | `/txs` | hash, height, index, messageTypes[0], status | code/gas/memo |
| Tx detail | `/txs/{hash}` | hash, height, index, status, code, time, gasUsed, gasWanted, memo, signerAddresses, fee (JsonView), messages[], events[] | — |
| Accounts list | `/accounts` | address, accountKind, firstSeenHeight, lastSeenHeight, txCount | — |
| Account detail | `/accounts/{address}` | address, accountKind, firstSeenHeight, lastSeenHeight, txCount | — |
| Balances | `/accounts/{address}/balances` | sampled, sampledAtHeight, source, balances[denom, amount] | — |

No field was invented or derived. Heights/ids/amounts/cursors stay strings throughout (no `Number()`).

## 4. Pagination behavior

First real keyset pagination: `useInfiniteQuery` + `nextPageParam` (limit 25). Cursors are **opaque**
— the hook passes the API's `nextCursor` back as `pageParam`; the UI never parses or synthesizes one.
`nextCursor: null` ⇒ `getNextPageParam` returns `undefined` ⇒ paging stops (no "Load more").
`PaginatedTable` flattens pages and offers a "Load more" button (no sorting/filtering framework).

## 5. Raw include behavior

`RawSection` is implemented only for the three detail endpoints whose generated `include` query type is
`enum: ['raw']` (blocks/{height}, txs/{hash}, accounts/{address}). It is **lazy**: the parent holds an
`expanded` flag and the `useXRaw(…, enabled)` hook is disabled until expand, so the `include=raw`
request fires only after the user opens the section. The `raw` payload is rendered via `JsonView`
(shape-agnostic). Verified by test (`BlockDetail`: no `include=raw` call until "Show" is clicked).

## 6. Account balance semantics

Balances come only from `/accounts/{address}/balances` (always HTTP 200). `sampled:true` renders a
denom/amount table — `utwlt → TWLT` via BigInt with the raw `utwlt` shown alongside — plus a
`sampledAtHeight` + freshness note. **`sampled:false` renders "no sample"**, never `0` and never blank;
`sampled:true` with an empty array renders "Sampled — no balances held." (also not a fabricated zero).

## 7. Explicitly omitted: account transaction history

The Phase 9 `/txs` endpoint exposes only `limit, cursor, height, status` — **no address/signer
filter**. Per the contract-grounding rule, account-related transaction history is **not implemented**
(no invented address-tx search). The block → txs relationship *is* implemented because `/txs?height=`
genuinely exists. Asserted by test (`AccountDetail`: `/txs` is never called; only `/status`).

## 8. Tests added/updated

`apiGetPath` substitution + URL-encoding + missing-param rejection (no fetch); pagination helpers
(stop on `nextCursor:null`); `PaginatedTable` rows/Load-more/stop/empty; block detail success +
invalid_height (client-side, no call) + not_found + block→txs (`/txs?height`) + lazy raw; tx detail
messages/events/decodeError + not_found; accounts list type; account detail success + not_found +
balances sampled:true (TWLT + raw) + sampled:false ("no sample" not 0) + no tx history; search→route
mapping. Existing boundary + theme guards still pass.

## 9. Validation output (all green)

- `npm run typecheck` (root) — exit 0
- `npm run build` (web) — ✓ 13 routes (lists static, details dynamic-on-demand)
- `npm test` (root) — exit 0: `apps/api` 114, `apps/web` **62** (17 files)
- `npm --prefix apps/web run openapi:check` — up to date (no API change)
- `npm --prefix apps/web run lint` — clean
- `git diff --check` — clean; no `.next`/`dist` tracked

## 10. Known limitations

- Detail pages are client-fetched shells (no SSR data) — consistent with the client-leaning posture.
- No list filters (`/txs` height+status, `/accounts` accountKind) — deferred (not omitted by accident).
- Some block header hashes (validators/next-validators) not surfaced — low operational value.
- Account tx history absent by contract (see §7), pending a future API capability.
- Raw payloads can be large; mitigated by lazy fetch on expand only.

## 11. Deferred to Phase 11 / 12

CoreSlot list/detail, liveness, network (validator-set/proposers), the operator page (Phase 11);
rewards epochs/claims/balances/params/treasury, supply detail (Phase 12); list-filter UIs; charts.

## 12. Codex PASS + Copilot PR #19 fix (2026-06-27)

Codex reviewed the committed diff and returned **PASS, no blockers** (one non-blocking note:
`apiGetPath` ignores extra params — safe, since all callers are type-checked; deferred).

Copilot flagged one issue: BlockDetail's client-side height check used `^\d+$`, which accepts `"0"`
and leading-zero forms (e.g. `"007"`) despite the "positive integer" message. Fixed to `^[1-9]\d*$`
(rejects `0`, leading zeros, empty); legit heights from the API/search are always canonical, so
nothing real breaks. Added a regression test (`"0"` and `"007"` → InvalidInput, no API call). Web
tests: 61 → **62**.

**Phase 10b Generic Explorer Pages: COMPLETE (Codex PASS; Copilot PR fix applied) — ready to merge.**
