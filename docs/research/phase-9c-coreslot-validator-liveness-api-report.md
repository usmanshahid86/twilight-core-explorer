# Phase 9c — CoreSlot / Validator / Liveness / Health API — Implementation Report

**Status: COMPLETE** (implemented, fully tested, live-validated against the fixture DB)

Date: 2026-06-26

Exposes the Twilight-specific surface — CoreSlot identity/state, the slot histories, consensus
windows, key rotations, proposed blocks, the liveness/health/network-risk layer, validator-set-at-
height, the proposer leaderboard, and CoreSlot search references — entirely from materialized 8c
projections. Strictly DB-only; no raw evidence; all status strings pass through verbatim.

## 1. Endpoints shipped (11 new; OpenAPI now 23 paths)

| Method + path | Purpose |
|---|---|
| `GET /api/v1/coreslots` | List CoreSlots (slotId-ASC keyset; status/operator/consensus/payout filters) |
| `GET /api/v1/coreslots/:slotId` | CoreSlot detail + quick health; `?include=raw` |
| `GET /api/v1/coreslots/:slotId/events` | Unified lifecycle+metadata+payout feed (composite cursor `[height,kind,eventId]`) |
| `GET /api/v1/coreslots/:slotId/windows` | Consensus windows (effectiveFromHeight-DESC keyset) |
| `GET /api/v1/coreslots/:slotId/key-rotations` | Key-rotation history (id-DESC keyset) |
| `GET /api/v1/coreslots/:slotId/proposed-blocks` | Blocks proposed by the slot (height-DESC keyset, + block time) |
| `GET /api/v1/coreslots/:slotId/liveness` | Liveness summaries (all window kinds; `?windowKind`) |
| `GET /api/v1/coreslots/:slotId/health` | Current health snapshot |
| `GET /api/v1/network/proposers` | Proposer leaderboard (attributed blocks per slot) |
| `GET /api/v1/network/validator-set?height=` | Active CoreSlot set at a height |
| `GET /api/v1/network/liveness-risk` | Current network halt-risk snapshot |

Plus: `/api/v1/search` extended with CoreSlot references (slotId / consensus-hex / operator+payout role).

## 2. Files changed

New (`apps/api/src`): `dto/coreslots.ts`, `dto/coreslot-liveness.ts`, `dto/network.ts`,
`repositories/coreslots-repository.ts`, `repositories/coreslot-liveness-repository.ts`,
`repositories/network-repository.ts`, `routes/coreslots.ts`, `routes/network.ts`.

Changed: `src/dto/search.ts` (+`CoreSlotRef`), `src/repositories/search-repository.ts` (+4 CoreSlot
lookups), `src/routes/search.ts` (+digit→coreslot, +40-hex consensus, +operator/payout refs),
`src/server.ts` (register `coreslotsRoutes`, `networkRoutes`), `docs/reference/openapi.json`
(regenerated, tracked).

Tests: new `test/coreslots.test.js`, `test/network.test.js`; extended `test/search.test.js`,
`test/mock-prisma.js` (9c models + factories).

## 3. Contract specifics (per the locks)

- **Search (lock 1):** references only — numeric slotId, 40-hex consensus, `twilight1` operator/payout.
  `twilightvalcons` bech32 **deferred** (no bech32 dependency added).
- **Events (lock 2):** only `lifecycle | metadata | payout`. Key rotations have their own endpoint
  (multi-phase heights); `CoreSlotParameterChange` excluded (network-scoped).
- **Pagination (lock 3):** `/coreslots` keyset; `/network/proposers` and `/network/validator-set`
  bounded (no pagination).
- **Missing rows (lock 4):** `/coreslots/:slotId/health` and `/network/liveness-risk` → `404`.
- **Leaderboard (lock 5):** attributed-only; no meta envelope.
- **Slot existence (lock 6):** non-digit slotId → `400 invalid_slot_id`; well-formed-but-missing slot
  → `404`; existing slot with no sub-resource rows → `200` empty.
- **Events cursor (lock 7):** stable composite `[height, kind, eventId]` (over-fetch + in-memory merge).
- **Preserved (lock 8):** DB-only, no outbound network, no chain-client/config, no projection
  recompute, no raw `BlockSignature`/`OperatorSigningEvidence`/`CoreSlotLivenessEvidence`, query
  defaults applied in handler code, OpenAPI drift test, no-chain guard, stable envelopes, BigInt as
  strings. All status strings (`healthStatus`, `summaryStatus`, `haltRiskLevel`) pass through verbatim.

## 4. Endpoint examples (live, fixture DB @ 3196)

`GET /api/v1/coreslots` → 5 slots; slot 5 `SLOT_STATUS_REMOVED`; slots 1 & 3 `status: null` (verbatim).

`GET /api/v1/coreslots/2/windows` → two windows revealing the key rotation:
```json
{ "data": [
  { "effectiveFromHeight": "3192", "effectiveToHeight": null,  "status": "ACTIVE", "openedByKind": "key_rotation" },
  { "effectiveFromHeight": "1",    "effectiveToHeight": "3189", "status": "ACTIVE", "closedByKind": "key_rotation" }
] }
```

`GET /api/v1/coreslots/4/liveness` →
```
lifetime = 9871 bps / 41 missed   recent_100 = 10000 / 0   recent_500 = 10000 / 0   recent_1000 = 10000 / 0
```

`GET /api/v1/coreslots/4/health` →
```json
{ "data": { "slotId": "4", "healthStatus": "healthy", "healthReason": "complete_no_recent_misses",
  "isActiveAtLatest": true, "primaryWindowKind": "recent_100", "uptimeBps": 10000,
  "lifetimeUptimeBps": 9871, "recent500UptimeBps": 10000, "recent1000UptimeBps": 10000,
  "firstCommittedHeight": "3096", "lastCommittedHeight": "3195", "summaryStatus": "complete",
  "policyVersion": "coreslot_health_policy_v1" } }
```

`GET /api/v1/network/proposers` → `[{slotId:"1",blocksProposed:814}, {"2":800}, {"3":796}, {"4":786}]` (≈3196 total).

`GET /api/v1/network/validator-set?height=3196` → 4 members `{1,2,3,4}` (slot 5 removed → excluded).

`GET /api/v1/network/liveness-risk` → `{ haltRiskLevel:"normal", haltRiskReason:"all_healthy", activeSlotCount:4, healthySlotCount:4, availablePowerBps:10000, policyVersion:"coreslot_health_policy_v1" }`.

`GET /api/v1/coreslots/2/proposed-blocks?limit=2` → heights `3196, 3185` with block time + lowercase proposer hex; working `nextCursor`.

`GET /api/v1/search?q=2` → `[{type:"block",height:"2",...},{type:"coreslot",slotId:"2"}]`.

## 5. Tests added & validation

`apps/api` suite: **81 tests / 81 pass / 0 fail** (was 56 in 9b; +25). New coverage: coreslots
list/keyset/filters; detail + health quick-fields + `include=raw`; `invalid_slot_id` 400 + missing 404;
events 3-table merge ordering + `kind` filter + composite-cursor round-trip + slot-missing 404 +
empty-200; windows/key-rotations/proposed-blocks ordering; liveness window kinds + filter + 404/empty;
health verbatim status + 404; proposer leaderboard groupBy + attributed-only; validator-set boundary
(`effectiveTo` null vs `> height` vs `== height` exclusion) + missing/invalid height 400; network-risk
verbatim + 404; search digit→block+coreslot, 40-hex→consensus ref, operator bech32→account+coreslot.

Hardening added during review: the tx composite cursor rejects an `index > Number.MAX_SAFE_INTEGER`
(`invalid_cursor`, guarding `Number()` precision loss), and search rejects a whitespace-only `q`
(`invalid_query`) — each with a regression test.

Ritual (all green): `db:generate`, `typecheck` (all workspaces), `build`, `npm --prefix apps/api test`
81/81, `openapi:check` "up to date" (23 paths), `npm run lint`, `indexer` 250 pass, `chain-client`
16/16, `git diff --check` clean. NUL scan over `apps/api` clean. No-chain guard covers the new files.

## 6. Known limitations & data observations

- **`twilightvalcons` search deferred** (no bech32 dependency in 9c); numeric slotId / consensus-hex /
  operator+payout refs are supported.
- **`CoreSlotParameterChange` (network params) not surfaced** — network-scoped; a future `/network/params`
  endpoint can expose it.
- **Key rotations excluded from `/events`** by design (multi-phase heights) — use `/key-rotations`.
- **Health / network-risk are current snapshots**, not historical series (series deferred).
- **Data observations (faithfully passed through):** the fixture has **5 CoreSlots** (slot 5
  `SLOT_STATUS_REMOVED`; slots 1 & 3 carry `status: null`); status strings use the full enum form
  (`SLOT_STATUS_ACTIVE`). The API surfaces these verbatim and does not normalize them.
- **Proposed-blocks** returns attribution rows for the slot (height + time + status); the full block
  payload is via `/blocks/:height`.

## 7. Next steps

- Commit the 9c additions (`docs/reference/openapi.json` is already tracked → plain `git add`).
- 9d: rewards (epochs, slot rewards, claim history gated by 7.2, sampled balances). Account balances
  and `/supply` still wait on the pre-9d snapshot indexer phase. `twilightvalcons` search and
  `/network/params` are candidate later additions.

**Phase 9c CoreSlot / Validator / Liveness / Health API: COMPLETE**
