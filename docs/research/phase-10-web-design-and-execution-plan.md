# Phase 10 — Web Design and Execution Plan

**Status:** Draft (canonical). **Scope:** Twilight Core Explorer frontend.
**Depends on:** Phase 9 public API (complete — `phase-9-public-api-completion-report.md`, tag
`explorer-phase-9-public-api`). **Date:** 2026-06-27.

This is the organized, reconciled successor to the initial scaffold. It folds in two facts the
scaffold predated: the **visual system is already solved** (reusable from `reference/twilight-explorer`)
and the **API is a frozen, typed contract** (32 endpoints in `docs/reference/openapi.json`). Those
retire the two normally-expensive frontend unknowns — *picking a look* and *discovering the API* — so
the plan concentrates its remaining effort on the one genuinely open thing: the **information
architecture**, which the reference cannot supply because its IA is stamped with the prior
bridge/ZkOS domain.

## 0. Locked decisions

1. **Stack:** Next.js (app-router) + Tailwind, in `apps/web` of this monorepo. Chosen primarily for
   **reference reuse** (`reference/twilight-explorer` is this exact stack with a portable theme +
   components) and because the project **already operates a Node runtime** (API + Postgres via Docker
   Compose), so Next's server adds no new operational category. Deep-link SSR + OG meta is a secondary
   benefit. The honest alternative considered and rejected was a Vite + React SPA — better-*fitted* to a
   read-only API consumer in the abstract, but it would discard the working reference code and gains
   little here (you already run a server). See the stack analysis discussion (2026-06-27).
   - **Rendering posture (implementation discipline):** use app-router **client-leaning** — TanStack
     Query for all data fetching; reserve server components for static shells + SEO/OG meta on detail
     routes. Do **not** use RSC server-fetching, route-segment caching, or server actions; the Phase 9
     API is the data layer. This neutralizes app-router's one real cost (over-engineering) for a
     read-only consumer.
   - **Runtime/deploy:** runs as a Node service alongside the existing API; static export (`output:
     'export'`) is the fallback if a pure-static/CDN target is ever wanted.
2. **Visual language:** extract the reference `auction` theme directly; **do not invent new
   directions.** (Theme details in §2.)
3. **Phasing:** consolidated thick slices, not Phase-9-style micro-phases. One foundation doc, then
   vertical build slices (§4).
4. **Design tool:** optional. Used only for page-layout mockups against the locked theme if useful —
   never to generate alternative looks (§3).
5. **Operator page is first-class:** the north-star operator surface (liveness + economics + authority
   history) is one whole deliverable in Phase 11, not fractured across phases.
6. **DB-only consumer:** the web app consumes the Phase 9 API only — no DB, no chain/RPC/REST, no
   wallet, no mutations. OpenAPI is the contract source (§7).

## 1. Purpose

Phase 9 delivered the complete DB-only public API. Phase 10 converts it into a production-grade
explorer that presents as a **precise, dark, operator-grade network-operations console** for a
privacy-first PoA chain — not a generic Cosmos explorer clone and not a marketing landing page.

The highest-value user is the operator/monitor asking: *"is my CoreSlot active and signing, what
lifecycle/authority actions happened, what have I earned/claimed, and what is the network's
halt/liveness risk."* Every IA decision is judged against serving that question.

## 2. Design direction (visual language — locked, from the reference)

Source of truth: `reference/twilight-explorer/packages/web` (`tailwind.config.js` +
`src/app/globals.css`, `data-theme='auction'`, which is the reference app's default). Extract, don't
reinvent. The theme is a **CSS-variable theme bridge** with semantic tokens, so lifting it is
mechanical and the components re-skin cleanly.

- **Palette (auction):** primary gold `#E89E28` (light `#F6B46C`, dark `#C67F1A`); page/background
  `#050505`; cards `#0A0A0C` with `#1F1F23` borders; semantic accents green `#18C37D` (success),
  red `#FF4A4A` (error), amber. Restrained accent, high-contrast dark surfaces.
- **Typography:** sans **Inter**, serif **Instrument Serif**, mono **Roboto Mono** (via `next/font`,
  bound to `--font-sans/serif/mono`). Mono for heights/hashes/amounts.
- **Tokens:** `background.{secondary,tertiary}`, `card.{hover,border}`, `text.{secondary,muted}`,
  `border.light`; radii `2xl`/`3xl`; `shadow-card`/`card-hover`/`glow`/`glow-green`; `bg-gradient-gold`;
  `shimmer` skeleton animation; custom scrollbar.
- **Shell:** centered max-width ~`1432px`, generous gutters, sticky header + footer.

Design qualities to preserve: dark-first, calm high-contrast surfaces, operator-grade data density,
precise typography, clear tables and status cards, no casino/DeFi decoration.

The explorer must communicate at a glance: chain health, CoreSlot validator state, liveness/network
risk, recent block/tx activity, sampled supply/rewards context, and API/indexer freshness.

**Reference extraction boundary.** Lift only the *visual* layer from `reference/twilight-explorer`;
never the prior domain.

- **Copy/adapt:** theme tokens, CSS variables, font setup, shell spacing, card/table primitives where
  useful, dark layout patterns, skeleton/loading patterns.
- **Do NOT copy:** bridge/ZkOS information architecture, old labels, old mock data, wallet actions,
  claim/mutation/admin actions, old business logic, any API assumptions not present in the Phase 9
  OpenAPI.

Any copied component must be **renamed and reshaped around Phase 9 OpenAPI-generated types** before use.

## 3. Tooling strategy

| Tool | Responsibility |
|---|---|
| **Claude Code** | Repo audit, integration, `apps/web` scaffolding, typed API client, implementation, tests, build. Owns correctness + repo integration. |
| **Claude Design (optional)** | Page-layout mockups / composition exploration **against the locked theme only**. Must not invent API fields or alternative palettes. Skippable — the reference components already give us the look. |
| **Codex** | Frontend architecture review, API-contract/OpenAPI-drift checks, a11y + testing gaps, package/security review, PR validation. Uses `docs/research/codex-reviewer-profile.md` as its standing profile, plus the local `adversarial-reviewer` subagent before each slice. The Phase-10 frontend-specific checklist is in §12. |

## 4. Phase structure (consolidated)

### Phase 10-0 — Web foundation plan (no code)
One planning doc that locks architecture before building. Deliverables: frontend integration plan
(how `apps/web` joins the monorepo build/tsconfig/workspaces); typed-API-client strategy (§7 —
generator, output location, commit policy, drift command, envelope integration, fallback); full route
map + IA (§5); the reference-extraction checklist (§2 boundary); testing strategy;
deployment assumptions; the Phase 10a implementation plan; explicit deferrals; a Codex review prompt
for the plan.

### Phase 10a — Foundation, API client, shell, home
`apps/web` scaffold + build wiring; API base-URL config; **typed client generated from `openapi.json`**;
envelope helpers (`{data}`, `{data,page}`, `{error}`); keyset-pagination helper; shared formatters
(height/hash/amount, `utwlt`→`TWLT` preserving raw); layout/nav shell (extracted theme + primitives);
the **Overview/home page** (§6); the standard states (loading/empty/error/not-found — §8); tests.

**Deferred from 10a:** charts/visualizations unless trivial — 10a uses cards, tables, badges, and
trend *placeholders*; the charting-library choice must not block the foundation. CoreSlot/rewards
charts are introduced later, once the page data model is stable.

### Phase 10b — Generic explorer pages
Blocks list + detail; Transactions list + detail; Accounts list + detail (+ sampled balances subview);
Search results. These are repetitive variations on the 10a-proven pattern → fast to grind.

### Phase 11 — Twilight surfaces + the Operator page (north-star)
CoreSlot list + detail (detail aggregates events/windows/key-rotations/liveness/health/proposed-blocks/
rewards); validator-set-at-height; proposer leaderboard; network liveness-risk; **and the first-class
Operator page** (§11) combining liveness + economics + authority history. The Operator page is the
phase's anchor deliverable, reachable by searching an operator/consensus address.

### Phase 12 — Rewards economics pages
Supply detail; rewards epochs; slot rewards; claims history; rewards balances; treasury/params history.
**Read-only rewards pages may be built before Phase 7.2** — they consume existing Phase 9 data. But
until **Phase 7.2 (live-claim fixture)** lands they must keep the `gated_by_phase_7_2` and
`claimSemantics` caveats visible (§8) and must not be presented as production-ready claim truth.
**Phase 7.2 must land before production-grade claim/economics UX.**

### Phase 13 — Production hardening
Absorbs the **deferred Phase-9 API hardening** (rate limiting, security headers/helmet,
cache-control/ETag, a real linter — `npm run lint` is a no-op today), plus frontend CSP, error
reporting/observability, deployment scripts, caching, performance, and a full accessibility pass.

## 5. Information architecture

Top-level nav (anticipates the full Phase 9 surface; early versions may collapse some):

`Overview · Blocks · Transactions · Accounts · CoreSlots · Liveness · Rewards · Supply · API`

The **Operator page** is reached by searching an operator/consensus address (per
`operator-experience-milestone-design.md`), not a top-nav tab; **Authority Actions** (the PoA audit
log) lives under CoreSlots and on the Operator page. Route → endpoint map:

| Route | Endpoints |
|---|---|
| `/` Overview | `/status`, `/projections`, `/blocks`, `/txs`, `/coreslots`, `/network/validator-set`, `/network/proposers`, `/network/liveness-risk`, `/supply` |
| `/blocks`, `/blocks/[height]` | `/blocks`, `/blocks/{height}` |
| `/txs`, `/txs/[hash]` | `/txs`, `/txs/{hash}` |
| `/accounts`, `/accounts/[address]` | `/accounts`, `/accounts/{address}`, `/accounts/{address}/balances` |
| `/search` | `/search` |
| `/coreslots`, `/coreslots/[slotId]` | `/coreslots`, `/coreslots/{slotId}` + `/events` `/windows` `/key-rotations` `/liveness` `/health` `/proposed-blocks` `/rewards` |
| `/liveness` | `/network/liveness-risk`, `/coreslots` (health overview); per-slot under CoreSlot detail |
| `/network` | `/network/validator-set`, `/network/proposers` |
| `/rewards` | `/rewards/epochs`, `/rewards/epochs/{epoch}`, `/rewards/claims`, `/rewards/balances`, `/rewards/params`, `/rewards/treasury-payments` |
| `/supply` | `/supply` |
| `/operator/[address]` (via search) | CoreSlot-by-operator detail + `/liveness` `/health` `/rewards` + lifecycle/authority events |
| `/api` (diagnostics) | `/status`, `/projections`, `/decode-failures`, OpenAPI/API status |

## 6. Homepage direction

The Overview page answers the first-10-second question: *"Is the Twilight network healthy, current,
and producing blocks?"* Recommended sections (operational summary, not every field — each links into
detail):

1. **Chain status** — `/api/v1/status`
2. **Indexer freshness** — `/api/v1/status`, `/api/v1/projections`
3. **Latest blocks** — `/api/v1/blocks`
4. **Recent transactions** — `/api/v1/txs`
5. **CoreSlot active-set health** — `/api/v1/coreslots`, `/api/v1/network/validator-set`, `/api/v1/network/proposers`
6. **Network liveness risk** — `/api/v1/network/liveness-risk`
7. **Supply snapshot** — `/api/v1/supply`

## 7. API client requirements

The frontend consumes the **Phase 9 API only**. Hard rules: no direct DB access; no chain/RPC/REST
calls from web; no wallet integration; no claim actions; no admin/operator mutations; no invented API
fields. **OpenAPI is the contract source** — generate the typed client from `openapi.json` so any API
change becomes a web-side type error.

Model the existing envelopes exactly:

```
{ data: T }
{ data: T[], page: { limit: number; nextCursor: string | null } }
{ error: { code: string; message: string; details?: unknown } }
```

Preserve and surface semantic caveats from the API wherever they affect interpretation:
`source:"sampled"`, `sampledAtHeight`, `sampled:false`, `rewardSemantics:"aggregate_projection"`,
`claimSemantics:"event_history_only"`, `claimSemantics:"projection_observed_not_live_claimable"`,
`productionClaimReadiness:"gated_by_phase_7_2"`. Pagination is keyset: pass `page.nextCursor` back
opaquely; `null` means end-of-list; never synthesize cursors. Branch error handling on `error.code`
(e.g. `invalid_cursor`, `invalid_epoch`, `invalid_slot_id`, `not_found`), not message text.

**Client generation strategy — decided in Phase 10-0, not locked here.** The repo audit must choose:
the **generator package**; the **generated-output location**; **whether generated files are committed**;
the **regeneration/drift-check command**; **how generated types integrate with the envelope helpers**
(`{data}` / `{data,page}` / `{error}` wrap the generated payload types); and a **fallback to a small
hand-written typed `fetch` wrapper** if generator output is poor. `openapi-typescript` (types only) +
a thin fetch wrapper is the likely candidate, but must be confirmed against `docs/reference/openapi.json`
during the audit.

## 8. Production UX requirements

Standard states from day one: loading; empty; stale/freshness indicators; API error; not-found;
invalid search; pagination loading; copied-to-clipboard; truncated address/hash expansion.

Data-presentation rules (these are correctness, not polish):

- Heights/IDs/amounts are **strings** — keep them strings; format at render, never `Number()` them.
- Amounts: format `utwlt` → `TWLT` where appropriate **while preserving the raw `utwlt`**.
- Addresses/hashes: shortened but copyable.
- Status strings: passed through unless explicitly mapped.
- **Sampled balances must never render as a confirmed `0`** — `sampled:false` is "no sample," not zero.
- **Claim/reward caveats must never be hidden** — surface `gated_by_phase_7_2` / `aggregate_projection`
  / history-only semantics where the user reads the number.

These two honesty rules are the one piece of Phase-9 rigor carried into the UI: getting them wrong
relocates the "fabricated zero / gated-claim-shown-as-live" problem to the presentation layer.

## 9. Data freshness model

Twilight Explorer is an **operational console**, so freshness is **product-critical, not polish** — a
stale, lagging, or unavailable surface must be visibly distinguishable from a healthy one, never
silently rendered as current. The UI must distinguish five states:

| State | Signal | UI treatment |
|---|---|---|
| **API unavailable** | request fails / `/health` down | global banner; pages show the API-error state, not an empty list |
| **API up, indexer lagging** | `/api/v1/status` (latest indexed height / time since last block vs chain tip) | "indexer N blocks / Ns behind" freshness chip |
| **Projection unavailable/failing** | `/api/v1/projections` (cursor + `ProjectionFailure`) | per-surface "projection stale/failing" badge; the affected page flags partial data |
| **Sample present but old** | `sampledAtHeight` vs latest indexed height | "sampled at height H (Δ behind)" on supply / balances / rewards |
| **No sample exists** | `sampled:false` / empty sample | "no sample" — never `0`, never blank (per §8) |

Freshness sources: **`/api/v1/status`** for chain/indexer freshness; **`/api/v1/projections`** for
projection freshness/failures; **`sampledAtHeight`** on supply/balances/rewards for observed-sample
freshness. Signals surface on the Overview page (§6) and inline on each affected page.

## 10. Search behavior

One global search box in the header, backed **only by `/api/v1/search`** — do not invent client-side
search semantics beyond what the API returns.

Accepted input shapes: block height, block hash, tx hash, account address, CoreSlot `slotId`,
consensus hex, operator/payout address.

Resolution rules:

- If `/search` returns **multiple typed references**, show a **typed result picker** (grouped by kind) —
  never auto-navigate.
- If it returns **exactly one strong result**, direct navigation is allowed.
- **Operator/consensus** results route to `/operator/[address]` or CoreSlot detail depending on the
  result type; an account-role result routes to `/accounts/[address]`.
- Empty/invalid input gets a structured empty/error state (per §8), not a blank page.

**Ambiguity is expected and must be surfaced, not hidden:** `q=2` may resolve *both* a block height and
a CoreSlot `slotId`; an operator address may resolve *both* an account and a CoreSlot role. In both
cases show the typed picker so the user chooses.

## 11. Operator page (first-class — the north-star surface)

One page, reached by searching an operator (`twilight…`) or consensus address, combining what an
operator needs in a single view (per `operator-experience-milestone-design.md`):

- **Identity & state:** CoreSlot-by-operator (active/inactive, metadata, payout address, key).
- **Liveness section:** uptime% over windows, missed/expected signatures, health label — from
  `/coreslots/{slotId}/liveness` + `/health`.
- **Economics section:** earned / observed-claimed / payout context — from `/coreslots/{slotId}/rewards`,
  rendered with the `gated_by_phase_7_2` + `claimSemantics` caveats until Phase 7.2 lands.
- **Authority history:** lifecycle/metadata/payout/params/key-rotation events — the PoA trust surface,
  from `/coreslots/{slotId}/events`.

## 12. Phase 10 frontend Codex review checklist

`docs/research/codex-reviewer-profile.md` remains the standing reviewer profile; this is the Phase-10
frontend-specific addendum. Every frontend PR is checked for:

- no invented API fields outside the OpenAPI / generated types;
- no direct DB / chain / RPC usage from web;
- no hardcoded `localhost` except documented env defaults;
- no `Number()` conversion of heights, amounts, ids, or cursor parts;
- loading / empty / error / not-found states present;
- sampled / rewards caveats visible where they affect interpretation (§7/§8);
- search ambiguity handled (§10);
- keyboard / a11y basics for nav, search, and tables;
- mobile minimum does not break tables;
- generated-client / OpenAPI drift checked;
- no generated junk / `dist` artifacts committed.

## 13. Phase 10-0 acceptance criteria

Complete when we have: frontend integration plan; typed-API-client strategy (§7); the design-tool
workflow (optional mockups against the locked theme); page hierarchy + route map; visual-direction
brief (pointing at the extracted auction theme); the Phase 10a implementation plan; explicit deferrals;
and a Codex review prompt for the plan. **No code in 10-0.**

## 14. Document lock criteria

This design doc is **lockable** (ready to freeze and enter Phase 10-0) when it contains all of:

- stack decision (§0);
- visual extraction source (§2);
- reference extraction boundary (§2);
- IA + route map (§5);
- data freshness model (§9);
- search behavior (§10);
- OpenAPI client-generation strategy requirements (§7);
- Phase 10a scope (§4);
- Phase 10 frontend Codex checklist (§12);
- explicit deferrals (charts §4; design tool §0/§3; Phase-7.2-gated production claim/economics UX §4/§8).

All ten are present — the document is lockable.

## 15. Immediate next step

Run the **Phase 10-0 foundation plan** with Claude Code (audit + IA + reference-extraction checklist +
10a plan). Then: review → lock IA → (optional) design-tool mockups against the locked theme → convert
to the 10a implementation plan → build 10a. Read-only rewards pages may precede **Phase 7.2**, but
production-grade claim/economics UX must wait for it (with caveats visible in the interim).
