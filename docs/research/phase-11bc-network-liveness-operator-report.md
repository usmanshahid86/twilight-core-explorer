# Phase 11b+c — Network, Liveness, and Operator Surfaces — Implementation Report

**Status: PASS** (implemented, typechecked, linted, tested, built). Date: 2026-06-27.
Branch: `feat/11bc-network-operator-surfaces` (off merged `main`). Plan:
`docs/research/phase-11bc-network-liveness-operator-plan.md`. **Not merged.**

## 1. Executive summary

Completed Phase 11: the `/liveness`, `/network`, and `/operator/[address]` surfaces — **operator-forward**
(operator = the validator identity), CoreSlot-backed. The riskiest logic (address→slot resolution) and
the reusable identity layer were built as **pure, unit-tested modules first**, then the pages composed
proven parts. The operator page reuses `CoreSlotDetail` wholesale; no new client capability was needed.

## 2. Files changed

**New pure modules:** `lib/operator-metadata.ts` (`parseOperatorMetadata`/`displayName`),
`lib/operator-resolver.ts` (`resolveOperator`).
**Hooks (`lib/api/queries.ts`):** `useOperatorResolution`, `useCoreSlotHealthFanout`,
`useOperatorDirectory`.
**Routes:** `app/liveness/page.tsx` (placeholder→real), `app/network/page.tsx` (new),
`app/operator/[address]/page.tsx` (new).
**Components:** `liveness/{LivenessOverview, PerSlotHealthTable}`, `network/{ValidatorSetSection,
ProposerLeaderboard}`, `operator/{OperatorLink, OperatorProfile, OperatorView}`.
**Cross-link pass:** `Header.tsx` (+Network nav), `blocks/BlocksList.tsx`, `blocks/BlockDetail.tsx`,
`coreslots/CoreSlotDetail.tsx` (proposer/operator → `OperatorLink` + `displayName`).
**Tests:** `operator-metadata.test.ts`, `operator-resolver.test.ts`, `operator/{OperatorLink,
OperatorView}.test.tsx`, `network/Network.test.tsx`, `liveness/Liveness.test.tsx`.

## 3. Endpoints used

`/network/liveness-risk`, `/coreslots` (+ filters, for the resolver), `/coreslots/{slotId}/health`
(bounded fan-out), `/coreslots/{slotId}` (directory enrichment + operator slot detail), `/status`,
`/network/validator-set?height=`, `/network/proposers`. All via existing `apiGet`/`apiGetPath`.

## 4. Operator-forward identity (the model)

- **`displayName(operator) = moniker ?? shorten(operatorAddress)`** is the identity shown everywhere.
- **`parseOperatorMetadata(unknown)`** is defensive (guards null/scalar/array/object), promotes known
  keys (today `moniker`) and preserves the rest as `extras`. **Extension-ready:** future chain fields
  appear in the Operator-profile `extras` (JsonView) with no rewrite, and promote to first-class via one
  line in `KNOWN_KEYS` + one `DataList` row.
- **`OperatorLink`** renders the name linked to `/operator/[operatorAddress]`, **address fallback** so
  the link always works without name enrichment.
- Cross-linked: block proposers (10b list + detail), CoreSlot detail operator row, validator set, and
  proposer leaderboard all link to the operator.

## 5. Operator resolver (riskiest dependency, isolated)

`resolveOperator(address, get = apiGet)` queries `/coreslots` by `operatorAddress → consensusAddress →
payoutAddress`, **stops at the first non-empty `data`**, returns `{ matchedRole, slots }`. **Empty
results are data** (drive the 0-match state); a thrown `ApiError` **propagates** (caller branches on
`error.code`). Pure + dependency-injected → unit-tested without React/network. **One operator = one
CoreSlot (chain rule):** the page renders the single slot; >1 is a **surfaced anomaly note**, not a
picker.

## 6. Pages

- **`/liveness`** — `/network/liveness-risk` summary (**404 = soft "no snapshot"**, not a hard error) +
  per-CoreSlot health via a **bounded, non-blocking** `useCoreSlotHealthFanout` (cap 100; per-slot
  failure → "—"; `nextCursor` ⇒ a capped note that **does not invent a total**).
- **`/network`** — operator-forward validator set (height from `/status`, **never heightless**;
  unavailable state when no height) + proposer leaderboard (sorted desc, `slotId` tie-break); names from
  the non-blocking `useOperatorDirectory`. New **Network** nav entry between Liveness and Rewards.
- **`/operator/[address]`** — resolve → operator header (`displayName`, matched-role badge, searched +
  operator addresses) + `OperatorProfile` + **reuse `CoreSlotDetail`** for the resolved slot (the detail
  query is shared/deduped). Zero-match → non-error empty; >1 → anomaly note.

## 7. Non-blocking enrichment (discipline)

`useOperatorDirectory` and `useCoreSlotHealthFanout` are bounded (cap 100) and **never page-fatal**: a
per-slot fetch failure is omitted/`null`, and the row falls back to its operator **address link** /
"—". `/network` renders immediately with address links and upgrades to names when the directory
resolves. Droppable wholesale if the API later adds `operatorMetadata` to list/network responses.

## 8. Data correctness

slotId/heights/amounts/addresses/cursors stay **strings (no `Number()`)**; bps via `bpsToPercent`;
opaque cursors; `error.code` branching; only contract-exposed fields; `metadata` parsed defensively (no
invented fields); the capped note states only `nextCursor`-backed truth (no fabricated "of N").

## 9. Tests added (27; web 67 → 94)

`parseOperatorMetadata`/`displayName` (moniker present/absent/null/scalar/array; extras preserved);
`resolveOperator` (operator/consensus/payout match, **stops after first non-empty**, zero=empty≠error,
ApiError propagation); `OperatorLink` (name link / address fallback / null); `OperatorView` (single +
role badge + reuses CoreSlotDetail; consensus fallback; zero empty; **>1 anomaly note**); Network
(derives height; **never calls validator-set without height**; leaderboard sort + operator link +
directory enrichment); Liveness (risk summary; **404 soft state**; per-slot fan-out with a **non-blocking
per-slot failure**).

## 10. Validation (all green)

- `npm run typecheck` (root) — exit 0
- `npm --prefix apps/web run build` — ✓ 14 routes (`/liveness`,`/network` static; `/operator/[address]`
  dynamic)
- `npm test` (root) — exit 0: `apps/api` 114, `apps/web` **94** (26 files)
- `openapi:check` — up to date (no API change) · `lint` — clean · `git diff --check` — clean; no
  `.next`/`dist` tracked

## 11. Known limitations / follow-ups

- Operator names in the network tables depend on a bounded directory fan-out (the moniker is not on the
  list/network responses). A future API change adding `operatorMetadata` there would let the directory
  be removed.
- `CoreSlotProposedBlocksSection` proposer is the slot's own consensus address (self-referential), so it
  is not operator-linked — the operator is already the page subject.
- Optional later: a `role==="operator"` search → `/operator/{q}` secondary link (deferred by decision).

## 12. Final recommendation

**Ready for Codex review.** Phase 11 is feature-complete (CoreSlot + Liveness + Network + Operator).
Operator-forward and extension-ready; the resolver + metadata adapter are pure and isolated; all locked
invariants honored (string-safe, opaque cursors, `error.code`, contract-only fields, non-blocking
enrichment, no invented totals, `/liveness` 404 soft). Do not merge yet.

## 13. Codex PASS + Copilot PR #23 fixes (2026-06-27)

Codex returned **PASS**. Copilot flagged four issues; all fixed (scope unchanged):

- **Fan-out concurrency (1):** `useCoreSlotHealthFanout`/`useOperatorDirectory` used `Promise.all` over up
  to 100 slots → up to 100 concurrent browser requests. Added a bounded worker-pool helper
  (`lib/concurrency.ts` `mapWithConcurrency`, concurrency 12, order-preserving) and routed both fan-outs
  through it — same cap + per-slot failure isolation, no connection saturation. Unit-tested (order,
  bound ≤ limit, empty).
- **`OperatorLink` name prop (2–4):** components passed `displayName` (which *always* returns a value) as
  `name`, short-circuiting `OperatorLink`'s own fallback so a shortened address rendered as a "name"
  (wrong, non-mono). Now pass **`moniker`** (which may be `undefined`) in `ValidatorSetSection`,
  `ProposerLeaderboard`, and `CoreSlotDetail`; `OperatorLink` applies its address fallback + mono styling
  when there is no moniker. Removed the now-unnecessary `operatorName`/`displayName` use in
  `CoreSlotDetail`.

Validation (all green): root typecheck/test exit 0 (`apps/api` 114, `apps/web` **94**, 26 files); web
build 14 routes; `openapi:check` up to date; `lint` clean; `git diff --check` clean.

**Phase 11b+c Network/Liveness/Operator Surfaces: COMPLETE (Codex PASS; Copilot PR fixes applied) — ready to merge.**
