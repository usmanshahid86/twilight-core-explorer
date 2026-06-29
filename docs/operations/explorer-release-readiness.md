# Twilight Core Explorer — Release Readiness

The RC record for the explorer. The **gate is executable**: `npm run rc-check` recomputes the verdict —
this document describes what it checks, the operational contract, and the known-limitations register. It
is not the source of truth; the script is.

Status: **Phase 13d complete (localnet).** 13d-1 (checklist) + 13d-2 (this doc's contract + register) +
13d-3 (soak, GREEN @ ~2,500 blocks) + 13d-4 (perf/a11y) all done; adversarial + Codex reviewed. The RC
gate (`npm run rc-check`, incl. `RC_LIVE=1`) is GREEN. **Deferred:** the primary **devnet** soak (§3) —
localnet only this pass.

---

## 1. RC checklist (13d-1)

`npm run rc-check` → prints PASS/FAIL per check, exits 0 (green) / 1 (any fail). `--smoke` runs only the
contract smoke. Current: **GREEN, 40 checks** on `main` @ the 13c merge.

- **Static tier** (CI-runnable, no live data): typecheck · lint (0 errors) · all-workspace tests · api +
  web `openapi:check` · static repo guards · web build.
- **API contract smoke**: replays every `openapi.json` path against the in-memory mock Prisma; each must
  return a *declared* status with a valid `{data}`/`{error}` envelope. A coverage guard fails a vacuous
  (empty/broken) contract. Negative-tested: a corrupted contract → RED + exit 1.
- **Live tier** (13d-3, `RC_LIVE=1` + `API_DATABASE_URL`): **implemented** — boots the real server against
  the soak DB and checks core lists non-empty, deep cursor-walk integrity (`/blocks`+`/txs` walked count ==
  DB count, dup-free), zero unresolved `ProjectionFailure`, and indexer freshness/lag present. Off by
  default. Cursor-walk core is falsified in CI via `--self-test`; full RED/GREEN is exercised by the soak run.

---

## 2. Environment-variable contract

### API (`apps/api`)
| Var | Req? | Default | Notes |
|---|---|---|---|
| `API_DATABASE_URL` | prod: **yes** | — | Authoritative Postgres URL. A read-only DB role is recommended. |
| `DATABASE_URL` | local/test only | — | Fallback; **rejected in production** (must use `API_DATABASE_URL`). |
| `API_ENV` / `NODE_ENV` | recommended | `development` | `production`/`development`/`test`. ⚠️ Unknown/unset → `development` (permissive posture) — a prod deploy **must** set `API_ENV=production` (warned loudly at boot). |
| `PORT` / `HOST` | no | `8080` / `0.0.0.0` | |
| `CORS_ORIGINS` | prod: recommended | unset → deny in prod, allow-all in dev | Comma-list of origins, or `*` for allow-all. A stray `*` in a list is dropped. |
| `RATE_LIMIT_ENABLED` | no | `= production` | `true`/`false`/`1`/`0` (strict; unrecognized throws). |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | no | `100` / `60000` | Per-IP budget per window. |
| `APP_VERSION` / `GIT_SHA` / `BUILT_AT` | no | `0.0.0-dev` / null / null | Build/deploy-injected; surfaced at `/api/v1/status` `data.build`. Never a chain read. |

### Indexer (`apps/indexer`)
| Var | Req? | Notes |
|---|---|---|
| `DATABASE_URL` | **yes** | Postgres. |
| `CHAIN_ID` | **yes** | Verified against the node; a **mismatch throws before any write** (loud, fail-safe). |
| `COMET_RPC_URL` | **yes** | CometBFT RPC (usually up). |
| `REST_URL` | for observed samples | Cosmos/Twilight REST (often down locally; snapshot/observed paths need it). |
| `START_HEIGHT` / `END_HEIGHT` | per run | Range ingest. |
| `SAMPLE_HEIGHT` | observed samples | Sampled-at height for live-snapshot data. |
| `RESET_PROJECTION` | rebuild | Re-runs a projection from scratch. |
| `DRY_RUN` / `SLOT_IDS` / `EXTRA_BALANCE_ADDRESSES` | operational | |

### Web (`apps/web`)
| Var | Req? | Default | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | **yes** | — | Base URL of the API the explorer reads. |
| `NEXT_PUBLIC_UI_THEME` | no | `auction` | `auction` (default) or `legacy` (opt-in; see legacy-contrast follow-up). |

**Truthfulness checks (to confirm in 13d-3):** the chain-id-mismatch guard fires (verified: throws);
freshness/health (`/status` `freshnessSeconds`/`lagBlocks`, the `/api` diagnostics page) display truthfully
against aged data.

---

## 3. Soak / scale (13d-3) — **done (localnet); devnet TODO**
Localnet soak via `scripts/soak/{drive-localnet,ingest-project}.sh` (the drive exercises every edge;
ingest rebuilds all projections, snapshot-pinned). Validated end-to-end at production scale: the full
**~2,500-block** fixture ingested clean and `RC_LIVE=1 npm run rc-check` is **GREEN, 53 checks**
(cursor-walk `/blocks` 2500==2500 + `/txs` 676==676 == DB, **0 unresolved `ProjectionFailure`**, freshness
present). Fixture truths: 2500 blocks / 676 txs / 33 accounts, `tx failed:2/success:674`, 50 epochs / 16
claimed, all three down-narratives in the liveness evidence (slot 4 sparse window 171 misses, slot 5
no-node 22, slot 3 rotation 2), 25 decoded `MsgSend` / 0 bank decode failures. Details + the issues caught
along the way (incl. the rewards batch-order fix) in `docs/research/phase-13d-3-soak-report.md`. Devnet
primary run = deferred TODO.

## 4. Bundle / perf + a11y (13d-4) — **done**
Perf audited healthy (no fixes): web bundle lean (87 kB shared / 104–125 kB per route), the `/liveness`
fan-out bounded (`FANOUT_CONCURRENCY=12`, `FANOUT_CAP=100`, graceful per-slot null), no API N+1 (repos batch
via IN-clause). a11y: an **automated axe structural net** (`axe-core` + `src/test/axe.ts` + 5 component
tests) — all pass; a real fix (**every data table now carries an sr-only caption**, enforced by making
`Table.caption` a *required* prop — an unnamed `<table>` is a type error, which the axe net can't catch);
keyboard audit clean (native elements, global `:focus-visible`, operable search picker). jsdom can't do
color-contrast or `duplicate-id-aria` (reports as `incomplete`) — those stay the 13b-ux manual / future
live-browser-axe domain. Detail: `docs/research/phase-13d-4-report.md`.

---

## 5. Known limitations & deferred-issues register

Explicit, linked to the phase that deferred each. **None blocks the RC; all are tracked for Phase 14 or
a later tightening pass.**

**Deploy/ops → Phase 14 (13c + plan §8):**
- Rate-limit **proxy keying** — keys on `request.ip`; behind a proxy without `trustProxy` all traffic
  collapses to one bucket. Set `trustProxy` + an XFF-aware `keyGenerator`, or limit at the edge.
- Rate-limit **shared store (Redis)** — currently in-process (single instance); behind the plugin.
- **Fail-closed env resolution** — require explicit `API_ENV=production` at the deploy boundary so the
  security posture can't be silently disabled by a typo (today: warned at boot, not enforced).
- **Production CORS allow-list** — set `CORS_ORIGINS` to the real web origin(s).
- **Build metadata injection** — wire real `APP_VERSION`/`GIT_SHA`/`BUILT_AT` at build/deploy.
- **Indexer lag monitoring + gap detection / missing-height repair** — plan §8 flags these as arguably
  pre-deploy.

**Indexer correctness (surfaced by the 13d-3 soak):**
- **Forward-only reconcile of `missing_reward_records` — OPEN follow-up.** A rewards claim processed
  before the reward snapshot populates `SlotRewardProjection` records a `missing_reward_records` failure
  (correctly — it never fabricates). **Batch rebuilds self-heal**: the per-height
  `deleteMany({ sourceHeight, resolved:false })` wipes it on any reprocess, and the snapshot-first order
  creates none. But a **forward-only incremental** indexer never revisits the height, so the failure would
  persist. The fix is a **snapshot-side reconcile** (resolve when the snapshot lands the rows), NOT an
  `applyClaim` resolve — a 13d-3b attempt at the latter was dead code (the per-height `deleteMany` runs
  first) and was reverted (adversarial review). Detail: `docs/research/phase-13d-3-soak-report.md`.

**Product follow-ups:**
- **Rewards-side filters** (13b-filters) — claims `txHash`/`fromHeight`/`toHeight`, balances
  `sampleKind`/`denom`/`height`, params `changeType`; adopt the `StatusFilter` pattern.
- **Legacy-theme contrast pass** (13b-ux) — the opt-in `legacy` theme has sub-AA pairs (primary link
  text, info badge, accent-red). Default `auction` theme is AA-clean.
- **Table accessible-name population** — *FIXED (13d-4, completed post-review).* `Table.caption` is now a
  **required** prop, so every data table (list + the ~10 non-list direct `<Table>` sites) carries an
  sr-only `<caption>` — and an unnamed `<table>` is a compile error (stronger than the axe net, which
  can't flag an unnamed table). (`th scope=col` was already met.)
- **Mobile nav disclosure** (13b-ux) — the compact nav is a flat chip-wrap; a hamburger/disclosure is a
  deferred enhancement.

**Guard/infra hardening (later tightening pass):**
- Derive the repo-invariant guard's `SRC_ROOTS` + the RC smoke's workspace coverage from
  `package.json` `workspaces` rather than hand-maintained lists (the proto-exclusion miss).

---

*Maintained across Phase 13d. The RC gate is `npm run rc-check` + independent review (adversarial +
Codex) PASS.*
