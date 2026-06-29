# Phase 13d-3 — Soak / Scale + Live RC tier — Report

Date: 2026-06-29
Branch: `feat/13d-rc-checklist` (13d-3 sub-slice)
Plan: `phase-13d-3-soak-plan.md` · `phase-13-explorer-hardening-plan.md` §7
Status: **complete — pipeline validated end-to-end at production scale. The full ~2,500-block soak
ingested clean (0 unresolved `ProjectionFailure`) and `RC_LIVE=1 npm run rc-check` is GREEN (53 checks).**
Localnet only (devnet = documented TODO).

## Scope

13d-3 delivers the **soak fixture** + the **live RC tier** the 13d-1 checklist stubbed (`RC_LIVE=1`):
a reproducible localnet drive that exercises every explorer edge, the ingest+projection rebuild, and
the live gate that asserts data presence + deep-pagination integrity + zero projection failures against
a real DB. Plus the chain-side enabler (bank `tx send` via AutoCLI + the bank `Msg` descriptor) so real
transfers decode.

## What shipped

- **`scripts/soak/drive-localnet.sh`** — height-driven drive: bring-up (4-node localnet, genesis-tuned
  `epoch_length=50`, `timeout_commit=500ms`, REST enabled) → a 3-mechanism filler (`update-payout`
  account breadth, real `tx bank send`, `update-metadata` volume) → P2 rewards (rotating claims +
  committed double-claim + pause/resume) → P3 lifecycle/authority (metadata/payout/params,
  inactivate/activate, suspend, key-rotation+restart, add+remove a 5th CoreSlot) → P4 sparse liveness
  window (node3 down ~1.5× the health window) → stop at target, chain left running for pinned sampling.
- **`scripts/soak/ingest-project.sh`** — ingest the pinned range + rebuild every projection in the
  load-bearing order, auto-detecting `CHAIN_ID` from the node and pinning snapshots to the end height,
  with a psql sanity block.
- **`scripts/rc-check.mjs` `RC_LIVE=1` tier** — boots the real server against the soak DB: core lists
  non-empty, detail ids (derived from the lists), deep cursor-walk integrity (`/blocks`,`/txs` walked
  count == DB count, dup-free), zero unresolved `ProjectionFailure`, indexer freshness/lag present.
- **Descriptor** — `cosmos/bank/v1beta1/tx.proto` added to the chain proto export + mirrored via
  `proto:refresh`; `packages/decoder/test/bank-msgsend.test.js` locks in that `MsgSend` decodes.

## Smoke validation run (202 blocks) — the pipeline proven end-to-end

A scaled-down drive (`TARGET_HEIGHT=200 EPOCH_LENGTH=15 ACCOUNT_POOL=8 BANK_SENDS=4
SPARSE_WINDOW_BLOCKS=30`) exercised **every** phase, then ingest + RC_LIVE. The point was to validate the
whole pipeline cheaply before the 30-minute run — and it earned its keep by surfacing four real issues.

**Fixture truth (all verified in-DB):**

| Signal | Observed | Meaning |
|---|---|---|
| blocks / txs / accounts | 202 / 57 / 11 | contiguous (`t`); full ingest |
| tx status | `failed:2`, `success:55` | the committed double-claim + paused-claim → the `?status=failed` edge |
| genesis windows @ h1 | 4 | the genesis CoreSlot/temporal seed (3 non-funded operators get windows) |
| health snapshots | `degraded:1`, `healthy:3` | slot 4 degraded from the node3 sparse window; others healthy |
| reward epochs / claimed | 13 / 4 | rotating claims across all 4 slots; mixed claimed/unclaimed |
| liveness chain | BlockSignature 800 (=4×200), OperatorSigningEvidence 800, LivenessEvidence 800, LivenessSummary 20, NetworkRisk 1, ProposerAttribution 202 | full 8a→8c stack populated |
| unresolved ProjectionFailure | **0** | (after the rewards-order fix below) |

**`RC_LIVE=1 npm run rc-check` → GREEN, 53 checks**, incl. `cursor-walk /blocks 202==202`,
`cursor-walk /txs 57==57`, `0 unresolved ProjectionFailure`, `freshnessSeconds=323 lagBlocks=2949`
(lag is truthful — the chain ran on past the pinned ingest height).

## Four issues caught + fixed during the smoke

1. **Rewards batch order (the substantive one).** The original `rewards(reset) → rewards-snapshot →
   rewards(replay)` left **4 unresolved `missing_reward_records`** failures. Root cause: the rewards CLI
   is cursor-based, so the "replay" (`RESET_PROJECTION=false`) saw the cursor already at the tip and
   **processed nothing** — claims were never re-reconciled. Fix: reorder to **snapshot → single
   non-reset rewards pass**, so `SlotRewardProjection` rows exist before the semantic pass and each claim
   reconciles on first processing (a reset there would wipe the co-owned snapshot rows). Re-ran → 0
   failures with real claims present.
2. **RC_LIVE freshness path** — the check read top-level `data.freshnessSeconds`/`lagBlocks`; they are
   nested under `data.indexer.*` (the `IndexerStatus` object). Fixed the path.
3. **CHAIN_ID mismatch** — `ingest-project.sh` defaulted a chain-id that didn't match the drive's chain
   (which inherits the operator's shell `CHAIN_ID`), so the indexer's chain-id guard aborted ingest (0
   blocks). Fix: **auto-detect `CHAIN_ID` from the node** (`/status` `node_info.network`) — it can no
   longer drift.
4. **Sanity-query `group by 1`** over an aggregate expression (`status||':'||count(*)`) is illegal;
   switched to `group by <column>`. (Cosmetic — the data was always correct.)

Also fixed earlier in 13d-3: bring-up invoked the chain's `init.sh` with the wrong CWD (its `go build`
needs the chain module), the payout key-pool used `keys add -o json` (only `--output json` is accepted),
the tx-outcome counter was lost across `$(...)` subshells (now a file tally), and `COMET_RPC_URL` must be
`http(s)://` (the chain CLI's `tcp://` is normalized).

## Finding (logged) — rewards `applyClaim` never resolves a reconciled failure

`applyClaim` (`apps/indexer/src/projections/rewards-semantic.ts`) **creates** a `missing_reward_records`
`ProjectionFailure` when a claim finds no `SlotRewardProjection` rows, but when it later **does** find
rows it marks them claimed and **never resolves the prior failure**. Harmless for a snapshot-first batch
rebuild (no failure is ever created — §"Four issues" #1). But the **live incremental indexer** processes
claims as blocks arrive, *before* any reward snapshot, so it would create — and permanently retain —
an unresolved failure for every claim. The data is never fabricated (correctness-over-guessing holds),
but the unresolved-count would be a standing false alarm.

**RESOLVED (13d-3b, same branch).** `applyClaim`'s reconciled branch now resolves the matching failure
(`projectionFailure.updateMany({ where: { projectionName, failureKind: 'missing_reward_records',
sourceEventId: event.id, resolved: false }, data: { resolved: true, resolvedAt: new Date() } })`). Verified
three ways: unit test `7b` (records-then-resolves), the full ritual (typecheck/tests/lint), and a **live
16→0** proof on the soak DB — reproducing the bug (`reset+project` before snapshot → 16 unresolved, one
per claim; snapshot alone left them at 16) then the fixed replay drove unresolved to 0. So the live
incremental indexer (claims before snapshots) self-heals on the next reconcile.

## Real (~2,500-block) run — **complete, GREEN**

Run with the script defaults (`TARGET_HEIGHT=2500 EPOCH_LENGTH=50 BANK_SENDS=25
SPARSE_WINDOW_BLOCKS=150`), ingested + `RC_LIVE`. **`RC_LIVE=1 npm run rc-check` → GREEN, 53 checks**
(cursor-walk `/blocks` 2500==2500, `/txs` 676==676; 0 unresolved `ProjectionFailure`;
`freshnessSeconds=1249 lagBlocks=65`).

| Signal | Smoke (202) | Full (2500) |
|---|---|---|
| blocks / txs / accounts | 202 / 57 / 11 | **2500 / 676 / 33** |
| reward epochs / claimed | 13 / 4 | **50 / 16** |
| tx status failed / success | 2 / 55 | **2 / 674** |
| health (at end height) | degraded:1 / healthy:3 | **healthy:4** (sparse window recovered by 2500) |
| unresolved ProjectionFailure | 0 | **0** |
| `RC_LIVE` verdict | GREEN (53) | **GREEN (53)** |

**Depth captured beyond the snapshot (per-height liveness evidence):** 195 total missed signatures —
**slot 4: 171** (node3 sparse window, lifetime uptime 9311 bps), **slot 5: 22** (the no-node 5th CoreSlot
while active, 0 bps), **slot 3: 2** (key-rotation node2 restart, 9991 bps); slots 1/2 a perfect 10000.
So all three down-narratives are in the evidence even though the *final* health snapshot reads all-healthy
(correct temporal model — the snapshot is the recovered present). Slot 5's add→remove window is recorded;
the **25 bank sends decoded cleanly as `cosmos.bank.v1beta1.MsgSend` with 0 bank `DecodeFailure`** — the
descriptor regen validated end-to-end at scale.

## Acceptance

- [x] Drive exercises all phases (smoke: P0–P4 + claims + failed txs + bank sends + lifecycle + rotation
      + add/remove + sparse window).
- [x] Ingest + projections rebuild with **0 unresolved `ProjectionFailure`**.
- [x] `RC_LIVE=1 npm run rc-check` **GREEN**; cursor-walk == DB; freshness present; negative-testable
      (empty DB → RED, observed during the CHAIN_ID-mismatch run; cursor-walk core falsified in CI via
      `--self-test`).
- [x] Full ~2,500-block fixture recorded (table above) — GREEN; cursor-walk 2500/676 == DB; all three
      down-narratives in the liveness evidence; 25 decoded `MsgSend` / 0 bank decode failures.
- Devnet primary run — deferred TODO (localnet-only this pass).
