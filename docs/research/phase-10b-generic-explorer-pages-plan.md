# Phase 10b — Generic Explorer Pages — Implementation Plan

**Status:** Plan (no code). **Scope:** Blocks, Transactions, Accounts generic explorer pages.
**Depends on:** Phase 10a (merged, PR #17). **Date:** 2026-06-27.
**Branch (to create):** `feat/10b-generic-explorer-pages` off `main`.

Grounded in the actual repo + the frozen Phase 9 contract (`docs/reference/openapi.json`). The original
Phase 10b prompt is used as a guardrail reference; the field-level "if available" hedges are resolved
here against the spec.

## 0. Audit findings (ground truth)

**Repo:** 10a is merged to `main` (`3d2dc3d`). 10b branches off fresh `main`.

**Two foundation realities that shape the plan:**
1. **`apiGet` has no path-param support.** It does `buildUrl(path as string, query)`, so
   `/api/v1/blocks/{height}` would be fetched literally. **All three detail pages are blocked on a
   client enhancement** — the keystone task (§1).
2. **`useInfiniteQuery` is unused in 10a.** Overview panels use fixed-limit `useQuery`; the
   `nextPageParam`/`hasMore` helpers exist but were never wired. List pages introduce the **first real
   keyset pagination** (§2).

**Reusable inventory (all reused):** `Card`/`CardHeader`/`CardBody`, `Badge`, `StatCard`,
`Table`/`Th`/`Tr`/`Td`, `Skeleton`/`SkeletonRows`, `CopyButton`, `MonoCopy`, `QueryBoundary`, states
(`Loading`/`Empty`/`Error`/`NotFound`/`InvalidInput`/`PaginationLoader`), freshness
(`SampledAtNote`/`NoSampleLabel`/…), formatters (`height`/`amount`/`address`/`bps`/`time`/`status`),
`search.ts`. `ErrorState` already branches on `error.code`.

**Contract facts (verified):**

| Endpoint | Query params | Response codes | Notes |
|---|---|---|---|
| `/blocks` | `limit, cursor` | 200, 400 | keyset list |
| `/blocks/{height}` | `include` | 200, **400, 404** | malformed→`invalid_height`(400); missing→`not_found`(404) |
| `/txs` | `limit, cursor, height, status` | 200, 400 | **`height` filter ⇒ block→txs feasible** |
| `/txs/{hash}` | `include` | 200, **404** | unknown→404; detail has `messages[]`, `events[]` |
| `/accounts` | `limit, cursor, accountKind` | 200, 400 | list has `firstSeenHeight/lastSeenHeight/txCount/accountKind` |
| `/accounts/{address}` | `include` | 200, **404** | unknown address→404 |
| `/accounts/{address}/balances` | — | **200 only** | unknown→`sampled:false` (never 404) |

Two "if available" hedges settled definitively:
- ✅ **Block → txs: build it** via `GET /txs?height={height}`.
- ❌ **Account → txs: do not build it** — `/txs` has no address/signer filter ("do not invent
  address-tx search" ⇒ hard no).

## 1. Foundation — path-param support in the client (keystone, do first)

Refactor `apps/web/src/lib/api/client.ts` **additively** (no churn to 10a's 9 `apiGet` call sites):
- Extract the fetch/parse/error core into a private `request(concretePath, query)`.
- Keep `apiGet(path, query?)` **signature unchanged** (lists keep working).
- Add `apiGetPath<P>(path: P, params: Record<string,string>, query?)` — substitutes `{name}` tokens
  (`encodeURIComponent` each) then calls `request`; response typed via `JsonOf<P>`.

Rationale: respects the "don't refactor unrelated files" guardrail (migrating working call sites is
churn); the sibling helper shares the core. Unit-tested: builds `…/blocks/3196`, params URL-encoded.

## 2. Pagination — first `useInfiniteQuery` usage

- `useInfiniteQuery({ queryFn: ({pageParam}) => apiGet(path, { limit, cursor: pageParam }),
  initialPageParam: undefined, getNextPageParam: nextPageParam })`.
- `PaginatedTable<T>` flattens `data.pages`, renders rows via a `columns` config + the existing
  `Table`, with a **"Load more"** button gated on `hasNextPage` (`PaginationLoader` while
  `isFetchingNextPage`); `isPending`→Loading, `isError`→Error, empty→Empty.
- Cursors stay opaque; `nextCursor:null` stops paging. Never parsed/synthesized.

## 3. New query hooks (`queries.ts`)

| Hook | Endpoint | Kind |
|---|---|---|
| `useBlocksList()` | `/blocks` | infinite |
| `useBlock(height)` / `useBlockRaw(height, enabled)` | `/blocks/{height}` (+`include=raw`) | detail / lazy |
| `useTxsList()` | `/txs` | infinite |
| `useTxsByHeight(height)` | `/txs?height=` | infinite (block→txs) |
| `useTx(hash)` / `useTxRaw(hash, enabled)` | `/txs/{hash}` (+`include=raw`) | detail / lazy |
| `useAccountsList()` | `/accounts` | infinite |
| `useAccount(address)` | `/accounts/{address}` | detail |
| `useAccountBalances(address)` | `/accounts/{address}/balances` | detail (always 200) |

Detail/balances hooks use `apiGetPath`; list/by-height hooks use `apiGet` with a query.

## 4. New shared components

- `components/list/PaginatedTable.tsx` — the list workhorse (§2).
- `components/detail/DataList.tsx` (`KeyValue`) — label→value detail rows.
- `components/detail/JsonView.tsx` — safe renderer for `unknown` JSON (`decodedJson`,
  `events.attributes`, `fee`, `raw`): `<pre>{JSON.stringify(v, null, 2)}</pre>` with null guards; never
  assumes shape.
- `components/detail/RawSection.tsx` — collapsible that **lazily** fires the `include=raw` hook on
  expand (keeps default payloads lean).
- `DetailError` helper — maps a detail query error to `NotFound` (`not_found`) / `InvalidInput`
  (`invalid_height`) / generic via `ErrorState`.

## 5. Per-page plans

- **`/blocks` (list):** PaginatedTable — height (link), age, txCount, proposer (`MonoCopy`, prefer
  `operatorAddress→address→rawAddress`).
- **`/blocks/[height]`:** thin server page → `<BlockDetail height={params.height}>` (client). DataList:
  height, hash, time, chainId, appHash/validatorsHash/lastBlockHash, proposer block
  (operator/slotId/attributionStatus). **Block-txs section** via `useTxsByHeight`. `RawSection`.
  Branch 400→InvalidInput, 404→NotFound.
- **`/txs` (list):** hash (link, copy), height (link), index, first `messageTypes`, status `Badge`.
- **`/txs/[hash]`:** DataList (hash, height link, index, status, code, gas used/wanted, memo, time, fee
  via JsonView). **Messages** (`typeUrl/module/typeName` + `decodedJson` via JsonView, or `decodeError`
  Badge). **Events** grouped by `phase` (type + `attributes` via JsonView). `RawSection`. 404→NotFound.
- **`/accounts` (list):** address (link, copy), accountKind Badge, firstSeen/lastSeen height, txCount.
- **`/accounts/[address]`:** gate on `useAccount` (404→NotFound). DataList (address, accountKind,
  firstSeen/lastSeen, txCount). **Balances section** via `useAccountBalances` (always 200):
  `sampled:true`→Table of denom/amount (`formatAmount`, raw `utwlt` preserved) + `SampledAtNote`;
  **`sampled:false`→`NoSampleLabel` ("no sample"), never `0`**. **No related-tx list** (unsupported).

## 6. Contract-grounded decisions
1. Block→txs built. 2. Account→txs omitted. 3. `include=raw` on all three details → one lazy
`RawSection`. 4. Unknown JSON via `JsonView`, `decodeError` surfaced. 5. List filters (`/txs`
height+status, `/accounts` accountKind) **deferred** (explicit decision). 6. Detail errors branch the
specific codes.

## 7. Search integration
`searchResultHref` already targets the new routes; once the pages exist, navigation resolves
(coreslot stays placeholder until 11). No search code change — add one integration test (block result
→ navigates → detail renders); keep the ambiguity picker as-is.

## 8. Routes / files
Replace 3 placeholders (`/blocks`, `/txs`, `/accounts`) with real list pages; add `[height]`,
`[hash]`, `[address]` detail routes. New components under `list/`, `detail/`, `blocks/`, `txs/`,
`accounts/`. Extend `client.ts` (+`apiGetPath`) and `queries.ts` (+~10 hooks).

## 9. Testing plan
`apiGetPath` substitution+encoding; list pagination (append + stop on null); detail success;
**404→NotFound / 400→InvalidInput** branching; tx messages/events + `decodeError`; **balances sampled
vs `sampled:false`→"no sample" not zero**; block→txs; search→detail navigation; no `Number()` in new
helpers; boundary + theme guards still pass; `openapi:check`.

## 10. Risks & mitigations
| Risk | Mitigation |
|---|---|
| `apiGet` change breaks 10a | Additive (`apiGetPath` + extracted core); 40 tests + typecheck |
| First `useInfiniteQuery` (`initialPageParam` required in v5) | One reviewed wrapper + pagination test |
| Path params unencoded | `encodeURIComponent` in `apiGetPath` + test |
| `unknown` JSON rendering | `JsonView`, no shape assumptions |
| Large `raw` payloads | Lazy fetch on expand only |
| Account detail 404 vs balances 200 | Gate page on identity; balances independent |

## 11. Deferred to Phase 11/12
CoreSlot/liveness/network/rewards/supply/operator pages; list-filter UIs; account tx-history (needs a
new API capability); charts.

## 12. PR shape
One thick 10b PR, internally ordered: client enhancement + tests → list/detail primitives → blocks →
txs → accounts → tests + report (`docs/research/phase-10b-generic-explorer-pages-report.md`).
Codex + Copilot review before merge.
