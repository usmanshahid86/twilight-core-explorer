# Phase 13 — Explorer Hardening & Release Readiness — Plan

Date: 2026-06-28
Status: **DESIGN-ONLY** (planning document for review). No code, schema, or doc-elsewhere changes
are made by this file. Supersedes the single "Phase 13: Deployment and Production Hardening" entry in
`explorer-project-checkpoint.md` §6 by **splitting it into Phase 13 (this doc) + Phase 14 (preview,
§8)**. Nothing here is committed scope until reviewed and accepted.

---

## 1. Framing — why this phase exists

The explorer is functionally broad: full generic indexing, the complete CoreSlot/rewards/liveness
projection stack, the DB-only public API (Phase 9; 32 OpenAPI paths), and the web explorer through
Phase 12 (generic pages, CoreSlot/liveness/network/operator surfaces, read-only rewards/supply
economics). The next risk is **no longer "a missing page."** It is **trust, consistency, production
behavior, and operator usability**: stale copy, inconsistent caveat language, a `Number()` slipping
onto an int64, an endpoint that 500s on a hostile cursor, a page that can't actually be deployed.

Phase 13 makes the explorer **trustworthy, consistent, and release-ready as software.**
Phase 14 (separate, previewed in §8) makes it **deployable and operable as infrastructure.**

This split is deliberate (see §2). Conflating them risks finishing a beautifully-audited explorer
that still cannot be deployed, or burying cheap real hardening behind heavy ops infra.

---

## 2. Scope boundary — Phase 13 vs Phase 14 (the explicit split)

| Concern | Phase 13 (this doc) | Phase 14 (preview, §8) |
|---|---|---|
| Code-correctness fixes (Number() on chain data, DB/RPC in web, raw eager fetch, OpenAPI drift, stale gate refs, `sampled:false`) | ✅ 13b-code | — |
| Navigation / IA / UX / copy / a11y polish | ✅ 13b-ux | — |
| **Cheap, real hardening you build, not just check**: a real linter across all workspaces; API security headers; cache-control/ETag; CORS review; rate limiting; version/build truthfulness; error observability | ✅ 13c | — |
| Release-readiness validation: executable RC checklist, scale/soak run, bundle/perf, a11y verification, env-var contract | ✅ 13d | — |
| **Ops infrastructure**: Docker app containers (web/api/indexer), prod compose, migration/deploy workflow | — | ✅ |
| **Reliability infra**: indexer lag monitoring, gap detection + missing-height repair, retry/backoff, multi-RPC fallback | — | ✅ (some pulled earlier — see §8) |
| DB backup strategy, nginx/TLS, CI/CD pipeline, optional `GrpcChainClient` | — | ✅ |

**Rule of thumb:** if it makes the *running explorer correct or trustworthy*, it is Phase 13. If it
makes the explorer *deployable, monitorable, or recoverable as a service*, it is Phase 14. The one
intentional exception: a few cheap hardening items that are *implementation, not audit* (the linter,
security headers, cache-control, rate limiting) live in Phase 13 — "check rate limiting" is
meaningless when it doesn't exist yet.

---

## 3. Guardrails (apply to ALL of Phase 13)

These are hard constraints; a sub-phase that violates one is out of scope, not "a judgment call."

1. **Hardening, not features.** No new page, endpoint, response field, or projection unless it is the
   *fix* to an audited correctness/consistency defect. New capability is Phase 14+ or a tracked
   follow-up.
2. **Polish, not redesign.** 13b-ux improves clarity/consistency of the *existing* IA. No new visual
   language, no route restructuring beyond fixing a demonstrably broken/inconsistent link.
3. **Preserve every hard invariant** in `CLAUDE.md` (generic rows authoritative; projections
   rebuildable; `ChainClient` the only transport boundary; failed tx → no semantic state; ambiguous
   history → `ProjectionFailure`; `validatorUpdateHeight + 2`; `finalize_block_events`; `EpochReward`
   ≠ claim truth; read-only rewards posture `read_only_no_claim_action`; no
   staking/gov/mint/distribution). A "fix" that breaks one of these is a regression.
4. **Mechanical checks become durable guards, not one-time prose.** Anything grep-able (no `Number()`
   on chain data, no `gated_by_phase_7_2`, no DB/RPC imports in web, no broken internal links, OpenAPI
   drift) ships as a **test or lint rule** extending the existing pattern
   (`apps/web/src/lib/boundary.test.ts`, `apps/web/src/app/theme-tokens.test.ts`, `openapi:check`). A
   markdown audit finds today's issues; a guard prevents tomorrow's regression.
5. **Every code fix ships with a test that fails before the fix.** No silent fixes.
6. **String-safety is non-negotiable.** int64-scale values (amounts, heights, epochs, ids, cursors)
   stay strings end to end; `formatAmount`/`formatHeight` are BigInt-only. Any new code obeys this.
7. **Per sub-phase: report + independent review is a gate.** Each ships
   `docs/research/phase-13X-*.md` and must pass the adversarial-reviewer subagent **and** an external
   (Codex) review before it is considered done — same ritual as Phases 7.2 / 11 / 12. **Decided: this
   applies to every sub-phase (13a–13d), not only the final RC pass** — each slice is reviewed and
   committed on its own before the next starts.
8. **Doc convention:** correction notes on historical docs, never rewrite history; keep the checkpoint
   status/guardrails current.
9. **The full validation ritual passes at every sub-phase boundary** (`typecheck`, `test`, `lint`,
   `apps/indexer test`, `chain-client test`, `apps/api test`, `apps/web test`, `openapi:check`
   api+web, web `build`, the static route guards).

---

## 4. Phase 13a — Full Explorer Audit (find, don't fix)

**Goal:** produce a complete, categorized inventory of every correctness/consistency/usability defect,
each assigned a **fix-home**. 13a writes *no fixes* — it catalogues and routes them.

**Method.** Split every finding into two buckets up front:
- **(M) Mechanical / grep-able** → the fix-home is "convert to a durable guard in 13b-code" (the check
  itself becomes a test/lint rule). Note today's violations so 13b can clear them.
- **(J) Judgment** → catalogue with location + severity + recommended fix + fix-home (13b-code /
  13b-ux / 13c / 14 / follow-up).

**Audit checklist** (each item: *what to check → how → expected*). The first block is your original
list; the second block is the additions from review.

*Correctness (mostly Mechanical):*
- **No `Number()`/`parseInt`/`parseFloat` on chain data** → grep `apps/web` + `apps/api` for those on
  amount/height/epoch/id/cursor paths → expected: none outside the one safe `Number(decimals)` in
  `amount.ts`. (M → boundary-test rule.)
- **No direct DB/RPC/`fetch` in web outside the typed client** → extend `boundary.test.ts` → expected:
  web reaches data only via `apiGet`/`apiGetPath`. (M.)
- **No stale `gated_by_phase_7_2`** anywhere (code/docs/tests); only `read_only_no_claim_action` →
  grep → expected: zero outside historical correction notes. (M → guard.)
- **OpenAPI drift** → `openapi:check` (api + web) → expected: in sync. (M, already a guard — keep.)
- **Stale stale-route guard** → the two `CLAUDE.md` greps → expected: only docs/guard refs. (M, keep.)
- **`sampled:false` / no-sample handling** → audit every balance/supply/rewards surface → expected:
  never renders a fabricated `0`; absence shows a sampled/NoSample/404→NotFound state. (J + targeted
  guard where grep-able.)
- **Raw eager-fetch** → confirm every `?include=raw` is lazy (fetched only on expansion) → expected:
  no raw fetch on initial render. (J/M — assert in component tests.)
- **Route coverage** → every API path in `openapi.json` is reachable from the UI *or* consciously
  internal; every web route resolves and has a real page → expected: no orphan/placeholder route. (J.)

*Consistency & usability (mostly Judgment → 13b-ux):*
- **Stale placeholders** (leftover "TODO"/"coming soon"/lorem) → grep + visual sweep → expected: none.
- **Caveat language consistency** — the same concept (sampled, observed-not-claimable, aggregate,
  read-only) must use the same wording everywhere; and caveat literals that are *contract fields* must
  render verbatim, never be hardcoded → catalogue every caveat string + its source. (J.)
- **Broken internal links** (web `Link`s + markdown doc links) → link-checker → expected: all resolve.
  (M → a doc-link test.)
- **Loading / empty / error state consistency** — every list/detail uses the standard
  `QueryBoundary`/`ErrorState` and branches on `error.code`, not message text → expected: uniform. (J.)

*Additions from review:*
- **Accessibility** — keyboard nav, focus-visible, aria on tables/copy-buttons/the search picker,
  color-contrast on theme tokens. (J → 13b-ux.)
- **Version/build truthfulness** — is explorer version + git SHA surfaced anywhere? (J → 13c.)
- **Error observability** — does the API log structured errors; are `ProjectionFailure`s visible in a
  running system (the `/api` diagnostics page — is it enough)? (J → 13c.)
- **Scale assumptions** — does any code/test silently assume the tiny 4-CoreSlot fixture (hundreds of
  rows)? Flag for the 13d soak run. (J → 13d.)

**Deliverable:** `docs/research/phase-13a-explorer-hardening-audit.md` — a findings table:
`id | severity (blocker/major/minor/nit) | category | location (file:line) | finding | recommended fix
| fix-home | acceptance condition`. Plus a short "convert-to-guard" list (the Mechanical findings that
become tests/lint).

**13a guardrails:**
- The audit **assigns** fix-homes; it does not fix. If a fix is a one-character obvious change, still
  record it and let 13b apply it (keeps the audit reproducible and reviewable).
- **Every finding must carry a concrete fix-home AND a concrete pass/fail acceptance condition** — no
  unactionable "could be better" entries. The acceptance condition is exactly what 13b/13d verify
  against, and is how we know the finding is closed. A finding without a testable accept condition is
  either sharpened until it has one, or dropped.
  - *Good:* `M-03 | major | apps/web/src/… | stale gated_by_phase_7_2 active literal | replace with
    read_only_no_claim_action + add a guard test | 13b-code | accept: grep finds zero active
    occurrences AND the new guard fails on reintroduction.`
  - *Bad:* `UX could be better` (no location, no fix-home, no pass/fail).

---

## 5. Phase 13b — Remediation (fix) — split: 13b-code + 13b-ux

Your original 13b was UX-only; the audit surfaces both **code-correctness** and **UX** findings, so
remediation has two tracks. They can run in parallel (different files), but both gate on 13a.

### 5.1 — 13b-code (correctness)

Fix every Mechanical/correctness finding from 13a, **and convert each grep-able check into a durable
guard** (this is the high-leverage half — the guard outlives the fix):
- stray `Number()` on chain data → fix + extend `boundary.test.ts` to fail on it.
- direct DB/RPC/`fetch` in web → fix + boundary-test rule.
- stale `gated_by_phase_7_2` → purge + a guard test.
- broken internal links → fix + a link-resolution test (web + docs).
- `sampled:false`/no-sample → fix any fabricated-zero path + component-test the absence state.
- raw eager-fetch → fix + assert-lazy in component tests.

**Pull in from the follow-up backlog (correctness, fits the "trust" theme):**
- **FU-1 — temporal-map genesis `ProjectionFailure` durability** (`phase-7.2-followups.md`): the
  genesis per-slot failures stamped at `sourceHeight: 1n` are deleted by the height-1 metadata
  cleanup; apply the same `0n` sentinel fix already used for genesis-identity. This is a known
  correctness bug in a phase whose theme *is* correctness — it belongs here, not in the backlog.
- **FU-2 / FU-3** — pull in **only if cheap** (the `0n`-sentinel empty-`Block` guard; the per-slot
  failureKey discriminator). If they balloon, leave them tracked.

**Deliverable:** the fixes + new guard tests + `docs/research/phase-13b-code-remediation-report.md`.
**Gate:** every fix has a failing-before test; full ritual green; review PASS.

### 5.2 — 13b-ux (clarity/consistency polish — NOT redesign)

Fix the Judgment/usability findings from 13a:
- **Nav grouping** — group the growing nav sensibly (e.g. Explore: blocks/txs/accounts/search;
  Validators: coreslots/liveness/network/operator; Economics: rewards/supply; Diagnostics: api). No
  new routes — grouping only.
- **Breadcrumbs / page titles / descriptions** — every route has a correct `<title>`, an `h1`, and a
  one-line description; detail pages breadcrumb to their list.
- **Cross-link consistency** — the cross-links added in 11/12 use consistent labels + the CardHeader
  `action` slot pattern; no generic "View all →" mislabels.
- **Empty/error/freshness/caveat wording** — one canonical phrasing per concept, applied everywhere;
  caveat *fields* still render verbatim from API rows.
- **Mobile / table overflow sanity** — wide tables scroll/wrap, don't break layout.
- **Copy polish** — operator-facing clarity; no jargon without a tooltip/explainer.
- **Accessibility** — keyboard nav, focus states, aria, contrast (from the 13a a11y findings).

**Deliverable:** the polish + updated/added component tests (titles, breadcrumbs, a11y roles) +
`docs/research/phase-13b-ux-polish-report.md`. **Guardrail:** no route restructuring, no new visual
system; every change is a clarity/consistency correction with a before/after rationale.

---

## 6. Phase 13c — Cheap-but-real hardening (build) — split into 13c-1…13c-4

Your original 13c was "production readiness *checks*." Splitting per review: the *checks* move to 13d;
**13c builds the cheap, real hardening** that doesn't exist yet (deliverables, not findings).
**Decided (review round 2): 13c is split into four reviewable slices, NOT one giant backend PR** —
rate limiting, cache/ETag semantics, structured logging, and version/status truthfulness can each
raise subtle API-contract or deployment-behavior questions. Each slice ships its own report + review
under the 13c milestone.

### 13c-1 — Workspace linter + static guards

Two distinct things, with **different failure policies** (this is the key refinement):

- **General ESLint baseline (api/indexer/packages) — WARN-ONLY first pass.** Today only `apps/web`
  lints (`next lint`); the others have no lint script (root `lint` is `--workspaces --if-present`, so it
  silently skips them). Wire a TS-aware ESLint config + each `lint` script + make root `npm run lint`
  exercise all workspaces; surface violations without blocking. Promoting general rules to
  error/block-on-CI is a follow-up once the baseline is clean, so a large initial count can't stall 13c.
- **Project-invariant guards — HARD-FAIL, never warn-only.** Warn-only applies to general lint cleanup
  *only*. The Twilight/project invariants Phase 13 exists to make durable must **fail the build** (as
  tests and/or custom lint rules, extending `boundary.test.ts` / `theme-tokens.test.ts` / `openapi:check`):
  - no direct DB/RPC/`fetch` imports in `apps/web` outside the typed client;
  - no stale `gated_by_phase_7_2` in active code;
  - no unsupported/placeholder routes (the two `CLAUDE.md` route guards);
  - no OpenAPI drift (`openapi:check`, api + web);
  - no known-unsafe `Number()`/`parseInt`/`parseFloat` on chain-data (amount/height/epoch/id/cursor) paths.

  A "warn-only" posture must **never** weaken these — that would defeat the point of the phase
  (guardrail #4). These are the same guards 13b-code introduces; 13c-1 ensures they run for *every*
  workspace and are wired into the standard `test`/`lint`/CI path.

### 13c-2 — HTTP hardening: security headers, CORS, cache-control/ETag

- Security headers (helmet-equivalent for Fastify); CORS review for a public read-only API.
- `Cache-Control` + `ETag` for cacheable responses, with two hard constraints: **(a) must NOT change
  response-envelope semantics** (`{data}`/`{data,page}`/`{error}` unchanged — caching is transport-layer
  only); **(b) conservative for mutable list endpoints** — lists that advance as the chain grows get
  short/no caching, while immutable detail (a finalized block/tx) may carry stronger validators. No
  cache policy may serve stale data against the freshness model.

### 13c-3 — Rate limiting

- In-process (single-instance) per-IP limiting, written behind a small interface a shared store (Redis,
  Phase 14) can later implement without touching call sites. Constraints: **a 429 uses the standard
  `{ error }` envelope**; the limiter is **configurable and disable-able** (env/config) so local dev and
  automated tests are never throttled or made flaky by it.

### 13c-4 — Version/status truthfulness + error observability

- Surface explorer version + git SHA (e.g. on `/api/v1/status` or a `/api/v1/version`) + a `CHANGELOG`.
  **Constraint: build/env metadata ONLY — no chain access.** The API and web stay DB-only; version
  truthfulness comes from build-time/env values (git SHA, package version), **never** a chain/RPC call.
  If a `/version` path is added, regenerate + review the OpenAPI.
- Structured API error logging; ensure `ProjectionFailure`s + indexer lag are visible in a running
  system (audit whether the `/api` diagnostics page + `/projections` endpoint suffice; add display
  only — no new ingestion).

**Deliverables:** per-slice code + tests + reports (`phase-13c-1…4-*.md`, or a combined
`phase-13c-hardening-report.md` if a slice is trivial). **Guardrails:** DB-only API stays DB-only (no
chain reads); envelopes unchanged; headers/cache/rate-limit are additive transport-layer concerns; no
contract drift (`openapi:check` green, or the spec is regenerated + reviewed if `/version` is added).

---

## 7. Phase 13d — Release Candidate pass (verify)

**Goal:** a repeatable, *executable* validation that produces a pass/fail RC verdict — not a prose
checklist someone eyeballs.

- **Executable RC checklist** — a script/runbook that runs and reports pass/fail: the full validation
  ritual + routes smoke test (every web route renders) + API endpoint smoke test (every `openapi.json`
  path returns a valid envelope) + `openapi:check` + indexer projection-status check + web `build` +
  the static guards.
- **Scale / soak run** — re-validate against real, non-toy data: cursor/pagination edges, sparse
  `recent_N` windows, large-list rendering, API latency, projection-status at depth. **Decided: two
  complementary runs.** (a) **Primary — the existing devnet** (running for a while → real, aged,
  organically-messy data; the best shake-out for cursor/pagination/sparse-window edges and any
  silent 4-CoreSlot-fixture assumptions). (b) **Complementary — an extended localnet soak** (the
  fixture-reset runbook driven over a long contiguous range → controlled, reproducible, lets us
  *intentionally* create the edge conditions devnet may not have hit). Record both fixtures + results;
  any divergence between them is itself a finding.
- **Bundle / perf sanity** — web bundle size, the bounded `/liveness` fan-out, API N+1 patterns.
- **a11y verification** — automated (axe-style) + a manual keyboard pass.
- **Environment-variable contract** — document every required/optional env for api + web + indexer
  (`DATABASE_URL`/`API_DATABASE_URL`, `CHAIN_ID`, `COMET_RPC_URL`/`REST_URL`,
  `NEXT_PUBLIC_API_BASE_URL`, `PORT`/`HOST`) with prod-vs-local notes; verify chain-id-mismatch
  warnings fire and freshness/health display truthfully.
- **Known-limitations + deferred-issues register** — explicit, linked to the follow-up backlog.

**Deliverables:** `docs/operations/explorer-release-readiness.md` (new `docs/operations/` tree) + the
RC checklist script. **Gate (the RC gate):** RC checklist all-green **and** independent review
(adversarial + Codex) PASS. Only then is the explorer an RC.

---

## 8. Phase 14 — Deployment & Operations (preview, for a later plan)

The infra deliberately *not* in Phase 13. A full Phase 14 plan comes after 13 is accepted; captured
here so the boundary is explicit.

- **Containerization** — Dockerfiles for web/api/indexer; a production `docker-compose` (today only a
  dev-only single-Postgres compose exists, no app containers).
- **Migration / deploy workflow** — `db:deploy` in a release pipeline; ordered projection rebuilds.
- **Reliability (pull some EARLIER than deploy):** indexer **lag monitoring**, **gap detection +
  missing-height repair**, retry/backoff, multi-RPC fallback. *Recommendation:* gap-detection + lag
  monitoring should arguably land before any real public deploy — flag for sequencing when Phase 14 is
  planned.
- **DB backup strategy**, nginx/TLS, **CI/CD** (run the RC checklist on every PR), optional
  `GrpcChainClient` transport behind `ChainClient`.
- **Shared-store (Redis) rate limiting** — the multi-instance limiter behind the small interface 13c
  introduces (13c ships the in-process implementation).

**Phase 15 — Operator Education & Onboarding** is separate again (the originally-listed "How Twilight
Core works" / "Become an Operator" / live-params / register-to-activate content). It is *not* folded
into Phase 14 ops; it lands as its own phase after deployment, and can run in parallel with 14 since it
is mostly static content + live params over the existing API.

---

## 9. Follow-up backlog — reclassification

| Item | Disposition | Rationale |
|---|---|---|
| **FU-1** temporal-map genesis `ProjectionFailure` durability | **→ Phase 13b-code** | Known correctness bug; fits the trust theme; small (reuse the `0n` sentinel). |
| **FU-2** genesis-identity `0n` sentinel on empty `Block` table | → 13b-code **if cheap**, else keep tracked | Guard, low-priority. |
| **FU-3** duplicate malformed-genesis slot failureKey discriminator | → 13b-code **if cheap**, else keep tracked | Edge case. |
| `RewardAmount` → neutral `CoinAmount` | → 13b-ux (optional) or defer | Cleanliness, not correctness; avoid cross-PR churn. |
| `/supply?height=` historical lookup | **Deferred** (post-14 / on demand) | Feature, not hardening. |
| Claims/balances **filter UI** | **Deferred** | Feature. |
| Dedicated rewards **reconcile command** | **Deferred** | Tooling/feature. |

---

## 10. Sequencing, cadence, and definition-of-done

**Order:** `13a (audit) → 13b-code + 13b-ux (parallel) → 13c-1…13c-4 (build hardening; can overlap 13b)
→ 13d (RC verify)`. Linear on the audit→fix dependency; the four 13c slices can start once 13a's
fix-homes are assigned and are independently reviewable (no one giant backend PR). 13c-1 (the static
guards half) pairs naturally with 13b-code, which authors the guards it then wires everywhere.

**Cadence per sub-phase** (the established ritual): plan the slice → implement → full validation ritual
→ write the per-sub-phase report → adversarial-reviewer subagent PASS → external (Codex) PASS → fold
fixes → update the checkpoint → **user commits manually** (no co-author trailer) → tag where a phase
milestone lands (`explorer-phase-13-*`).

**Phase 13 is DONE when:** the 13a audit is fully remediated (13b) or consciously deferred; the cheap
hardening (13c) is built (linter exercises all workspaces, headers/rate-limit/version/observability
in place); the 13d RC checklist is green and review-passed; `docs/operations/explorer-release-
readiness.md` exists; and the checkpoint reflects the 13/14 split. The explorer is then a **release
candidate** — deployable-as-software, with deployment-as-infrastructure scoped to Phase 14.

---

## 11. Resolved decisions (2026-06-28)

The five open questions were resolved with the user; the sections above already reflect these:

1. **Naming + phase map — DECIDED.** Adopt **"Phase 13 — Explorer Hardening & Release Readiness"** +
   **"Phase 14 — Deployment & Operations"**, with **"Phase 15 — Operator Education & Onboarding"** as
   its own later phase (not folded into 14; may run in parallel with 14). The checkpoint §6 was
   **reconciled to this 13/14/15 map (2026-06-28).**
2. **Linter strictness — DECIDED: warn-only baseline, hard-fail invariants** (13c-1). General
   ESLint/TS cleanup is warn-only; the project-invariant guards (DB/RPC-in-web, stale
   `gated_by_phase_7_2`, unsupported routes, OpenAPI drift, unsafe `Number()` on chain paths) are
   **hard-fail** and never weakened by the warn-only posture.
3. **Rate limiting — DECIDED: in-process (single-instance)** for the RC (13c-3), written behind a
   small interface so a shared-store (Redis) limiter can drop in at Phase 14 without touching call
   sites; 429 uses the standard `{ error }` envelope and the limiter is disable-able for local/test.
4. **Scale/soak — DECIDED: both** (13d). Primary run against the **existing devnet** (real, aged data);
   complementary **extended localnet soak** via the fixture-reset runbook for controlled, reproducible
   edge conditions. Divergence between the two is itself a finding.
5. **Review gate — DECIDED: every sub-phase** (guardrail #7). Adversarial + external (Codex) review
   PASS gates **each** of 13a–13d on its own, not just the final RC.

### Review round 2 (2026-06-28) — six refinements, all folded into the sections above

1. **13c split into 13c-1…13c-4** (§6) — linter/guards, HTTP hardening, rate limiting,
   version/observability — so 13c is not one giant backend PR; each slice is independently reviewable.
2. **Warn-only is for the general lint baseline only; project-invariant guards are HARD-FAIL** (13c-1).
   Resolves the latent contradiction with guardrail #4 — warn-only must not weaken the durable checks
   Phase 13 exists to harden.
3. **Every 13a finding needs a fix-home AND a concrete pass/fail acceptance condition** (§4) — no
   unactionable "could be better" entries; the audit deliverable gains an `acceptance condition` column.
4. **Cache-control/ETag must not change envelope semantics and must be conservative on mutable list
   endpoints** (13c-2) — no stale data against the freshness model.
5. **Rate limiting preserves the `{ error }` envelope and is disable-able for local/test** (13c-3).
6. **Version/build truthfulness uses build/env metadata only — no chain access** (13c-4) — protects the
   DB-only hard invariant.

**Remaining to confirm at kickoff (not blockers):** the exact devnet range/height window for the soak;
whether `docs/operations/` also absorbs the env-var contract or keeps it in the release-readiness doc;
and the initial ESLint ruleset (recommend `@typescript-eslint` recommended + the project's existing
web rules as the baseline).
