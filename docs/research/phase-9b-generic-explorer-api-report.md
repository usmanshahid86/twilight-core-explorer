# Phase 9b — Generic Explorer API — Implementation Report

**Status: COMPLETE** (implemented, fully tested, live-validated against the fixture DB)

Date: 2026-06-26

Builds on the 9a foundation to add the generic explorer surface: transactions, accounts, search,
decode-failure diagnostics, and per-projection diagnostics. Strictly DB-only — no new transport, no
projection recompute. All endpoints reuse the 9a envelopes, BigInt-as-string serialization, keyset
pagination (with the N+1 lookahead fix), OpenAPI drift test, and no-chain guard.

## 1. Endpoints shipped

| Method + path | Purpose |
|---|---|
| `GET /api/v1/txs` | List transactions, newest-first (composite keyset) |
| `GET /api/v1/txs/:hash` | Tx detail with materialized messages + events + block time; `?include=raw` |
| `GET /api/v1/accounts` | List accounts (address-ASC keyset) |
| `GET /api/v1/accounts/:address` | Account identity/activity; `?include=raw` |
| `GET /api/v1/search?q=` | Resolve a query to typed references (block/tx/account) |
| `GET /api/v1/decode-failures` | Decode-failure diagnostics (id-DESC keyset) |
| `GET /api/v1/projections` | Per-projection cursor + unresolved-failure breakdown by kind |

OpenAPI now documents 12 paths total.

## 2. Files changed

New (`apps/api/src`):

```
dto/transactions.ts        TxListItem, TxDetail, MessageDto, EventDto, queries/params + mappers
dto/accounts.ts            AccountListItem, AccountDetail + mappers
dto/search.ts              SearchResult union (block|transaction|account refs) + query
dto/decode-failures.ts     DecodeFailureItem + query (raw payloads excluded)
dto/projections.ts         ProjectionDiagnostic + mapper
repositories/transactions-repository.ts   listTxs (composite keyset), getTx, getMessages, getEvents, getBlockTime
repositories/accounts-repository.ts       listAccounts (address keyset), getAccount
repositories/search-repository.ts         findBlockByHeight/Hash, findTxByHash, findAccountByAddress
repositories/decode-failures-repository.ts listDecodeFailures (id keyset)
repositories/projections-repository.ts    getProjectionCursors, getFailureKindCounts (groupBy proj+kind)
routes/transactions.ts  routes/accounts.ts  routes/search.ts  routes/decode-failures.ts  routes/projections.ts
```

Changed:

- `apps/api/src/lib/pagination.ts` — added composite-keyset helpers `encodeKeyset` / `decodeKeyset` /
  `decodeBigIntPart` (reusing the single-key `decodeCursor` for blocks/decode-failures).
- `apps/api/src/server.ts` — register the 5 new route groups under `/api/v1`.
- `apps/api/test/mock-prisma.js` — extended with `explorerTransaction`, `message`, `event`,
  `account`, `decodeFailure`; generalized `projectionFailure.groupBy` to multi-key; added fixture
  factories (`tx`, `msg`, `evt`, `account`, `decodeFailure`).
- `docs/reference/openapi.json` — regenerated (gitignored by the `reference/` rule → `git add -f`).

New tests: `transactions.test.js`, `accounts.test.js`, `search.test.js`, `decode-failures.test.js`,
`projections.test.js`.

## 3. Contract specifics (per the locks)

- **Txs:** composite keyset `(height DESC, index DESC)` with N+1 lookahead; filters `height` (exact)
  + `status`; **no address-filtered list** (signers live in JSON, no index). Detail joins `Message`
  (asc `msgIndex`) + `Event` (asc `msgIndex,eventIndex`) + block `time`. `rawTx`/`rawResultJson`/
  message `rawJson` are detail-only via `?include=raw`. Unknown hash → `404`.
- **Accounts:** address-ASC keyset (stable unique id; nullable `lastSeenHeight` deliberately not the
  cursor). Identity/activity only — `address, accountKind, firstSeenHeight, lastSeenHeight, txCount`.
  **No balances, no operator/payout role hints.** `rawAccountJson` detail-only. Unknown address → `404`.
- **Search:** references only. `^\d+$` → block; 64-hex → block hash and/or tx hash (case-normalized,
  both probed); `^twilight1…` → account. Empty `q` → `400 invalid_query`; unresolvable → `{ data: [] }`.
  **Deferred to 9c:** numeric slotId, consensus hex, valcons bech32, operator/payout/CoreSlot refs.
- **Decode-failures:** id-DESC keyset; filters `resolved` (default `false`), `failureKind`, `height`.
  **Raw payloads never exposed**; no `/decode-failures/:id` in 9b.
- **Projections:** all cursors + `unresolvedFailures { count, byKind[] }` (grouped from
  `ProjectionFailure`). Reads only `ProjectionCursor` + `ProjectionFailure` — never `BlockSignature`,
  `OperatorSigningEvidence`, or `CoreSlotLivenessEvidence`.

## 4. Endpoint examples (live, fixture DB @ height 3196)

`GET /api/v1/txs?limit=2`
```json
{ "data": [
  { "hash": "F1577D5F…81E4", "height": "3190", "index": 0, "status": "success", "code": 0,
    "gasUsed": "44379", "gasWanted": "600000", "memo": null,
    "messageTypes": ["/twilight.coreslot.v1.MsgActivateCoreSlot"], "signerAddresses": [] },
  { "hash": "B9924C1E…25E4", "height": "3187", "index": 0, "status": "success",
    "messageTypes": ["/twilight.coreslot.v1.MsgSuspendCoreSlot"], "signerAddresses": [] }
],
  "page": { "limit": 2, "nextCursor": "MzE4Nzow" } }   // base64url("3187:0")
```

`GET /api/v1/accounts?limit=2`
```json
{ "data": [
  { "address": "twilight17haluqyem49q9rsf3w5ezfz8z86vzn8ny4ekd5", "accountKind": "unknown",
    "firstSeenHeight": "3079", "lastSeenHeight": "3105", "txCount": 1 },
  { "address": "twilight1arvvjf2v3h2snpsa7r2yrj700mu54pjmhusp5u", "accountKind": "unknown",
    "firstSeenHeight": "3010", "lastSeenHeight": "3017", "txCount": 1 }
],
  "page": { "limit": 2, "nextCursor": "dHdpbGlnaHQxYXJ2…" } }
```

`GET /api/v1/search?q=3196` → `{ "data": [ { "type": "block", "height": "3196", "hash": "E3D7317F…4E1B" } ] }`

`GET /api/v1/decode-failures?limit=2` → `{ "data": [], "page": { "limit": 2, "nextCursor": null } }` (clean fixture).

`GET /api/v1/projections` → 12 projections, each `unresolvedFailures.count: 0`
(`block_signatures_v1, coreslot_health_v1, …, proposer_attribution_v1`).

## 5. Tests added & validation

`apps/api` suite: **52 tests / 52 pass / 0 fail** (was 25 in 9a; +27 across 5 new suites). Coverage:
- txs: composite-cursor pagination + N+1 boundary, exact-height filter, bad limit/cursor → 400, raw
  excluded on list, BigInt-as-string, detail with messages/events/time, `include=raw`, 404.
- accounts: address-keyset pagination + N+1, accountKind filter, detail identity-only (asserts **no
  balance key**), `include=raw`, 404.
- search: each `q` shape → correct ref, 64-hex case-insensitive, block+tx both, empty `q` → 400,
  unresolvable → `[]`.
- decode-failures: default-unresolved + id-DESC + cursor, `failureKind`/`resolved` filters, **raw never
  present**, bad cursor → 400.
- projections: per-projection failure-kind breakdown, zero-failure case.
- preserved: all 9a tests, OpenAPI drift test (now 12 paths), **no-chain guard** (auto-covers the new
  files).

Ritual (all green): `db:generate`, `typecheck` (all workspaces), `build`, `npm --prefix apps/api test`,
`npm --prefix apps/api run openapi:check` ("up to date"), `npm run lint` (no-op), `git diff --check`
(clean).

## 6. Notable implementation finding

**Schema `default` values are inert under `TypeBoxValidatorCompiler`.** The TypeBox compiler validates
but does not fill defaults, so a query param relying on a schema `default` arrives as `undefined`. 9a
already side-stepped this for `limit` (defaulted in code via `?? DEFAULT_LIMIT`); the `resolved` filter
initially leaned on the schema `default: false` and therefore returned resolved rows too. Fixed by
defaulting in the handler (`request.query.resolved ?? false`). Lesson for 9c/9d: **always default query
params in code, not via schema `default`.**

## 7. Known limitations & deferrals

- **`signerAddresses` is whatever the indexer materialized** in `signerAddressesJson`; it is empty for
  the fixture's CoreSlot txs. The API maps it faithfully and does not derive signers.
- **No address-filtered tx list** — signers are in JSON with no index (a materialized tx↔account link
  would be a future indexer item).
- **Accounts:** no balances (no materialized balance model — pre-9d snapshot work), no operator/payout
  role hints (9c).
- **Search:** numeric slotId, consensus-hex, valcons bech32, and CoreSlot/operator role refs are
  deferred to 9c (valcons additionally needs a pure bech32 dependency).
- **Decode-failures:** raw payloads not exposed; no per-id detail endpoint in 9b.
- **Account list ordering** is address-ASC (stable), not most-recently-active; a `sort` option is a
  later enhancement.

## 8. Next steps

- Force-add `docs/reference/openapi.json` and commit the 9b workspace additions.
- 9c: CoreSlot / validator / liveness / health / network-risk API (incl. proposer leaderboard,
  validator-set-at-height, and the deferred search keys). 9d: rewards. Account balances / `/supply`
  wait on the pre-9d snapshot indexer phase.

**Phase 9b Generic Explorer API: COMPLETE**
