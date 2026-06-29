# Phase 13d-3 — Soak / Scale Plan (localnet) + Live RC tier

Date: 2026-06-29
Plan: `phase-13-explorer-hardening-plan.md` §7 (Phase 13d — RC pass), 13d-3 sub-slice
Status: **complete.** Parameters locked; drive + ingest scripts shipped; live RC tier added; the full
~2,500-block soak ran **GREEN (RC_LIVE, 53 checks)**. Run results: `phase-13d-3-soak-report.md`. (This is
the *plan*; the report is the record of what actually ran.)

Predecessors: 13d-1 (`scripts/rc-check.mjs` static + contract tiers) + 13d-2
(`docs/operations/explorer-release-readiness.md`). This slice adds the **live tier** that 13d-1
stubbed (`RC_LIVE=1`) and the **fixture** it runs against.

> Scope decision (locked with the user, 2026-06-29): **localnet only** this pass; the primary devnet
> run is a documented TODO (§7). Depth target **~2,500 blocks**. **I script the drive** — the CLI was
> reverse-engineered from the chain repo (`twilight-core/scripts/localnet/*`), not guessed.

---

## 0. Activity-generation: a hybrid of three mechanisms

A mid-plan finding + its fix shaped this. The `twilightd` CLI *originally* exposed only the custom tx
families (`coreslot`/`rewards`) — no `tx bank send` — because the app's `root.go` wired commands by hand
and never added the standard tx/query trees. That was **fixed chain-side** (PR #3 `feat/autocli-default-cli`,
AutoCLI `EnhanceRootCommand`), so **`twilightd tx bank send [from] [to] [amount]`** now exists. The soak
therefore uses **three** complementary generators, each chosen for what it cheaply produces:

1. **Account breadth → `coreslot update-payout 1 <addr>`.** `account-extraction.ts` upserts an `Account`
   for any bech32 address under a key matching `/(address|operator|signer|sender|recipient|authority|payout)$/i`
   in a tx payload or event attr — **no balance required**. One free, authority-signed tx per address ⇒
   ~80 accounts cheaply.
2. **Funded accounts + transfers + a decodable `MsgSend` → real `tx bank send`** (operator0 → a subset of
   the pool, `BANK_SENDS≈25`). Emits `transfer`/`coin_received`/`coin_spent` events (sender/recipient ⇒
   Accounts with real balances) and a standard `cosmos.bank.v1beta1.MsgSend` message — a non-Twilight
   message type through the decoder. **Decodes cleanly only if the explorer descriptor carries the bank
   `Msg` types** (see §3.5; proven: adding `cosmos/bank/v1beta1/tx.proto` to the chain export ⇒ protobufjs
   resolves `MsgSend`). Otherwise it lands as a `DecodeFailure` (still useful coverage).
3. **Balances depth → `rewards claim <slot> <ep> <ep>`** directs a slot's reward to its current payout
   address (the observed-sample paths).

Net: the deep-cursor edge is carried by **~2,500 blocks + hundreds of txs**; accounts come from (1) breadth
+ (2) funded; (2) also adds standard-message-type + bank-event variety the coreslot/rewards txs can't.

---

## 1. Chain bring-up + genesis/config tuning

4-node localnet via the chain repo's `scripts/localnet/{init,start,stop}.sh` (genesis-funds operator0 +
operator1 1e12 `utwlt` each; 4 ACTIVE genesis CoreSlots; authority = operator0, emergency = operator1).
Two tuned knobs, applied to every node before start (same technique the dev `rewards-soak.sh` uses):

| Knob | Where | Value | Why |
|---|---|---|---|
| `epoch_length_blocks` | `genesis.json` `app_state.rewards.params` + `.current_epoch_config` | **50** | ~50 finalized epochs over 2,500 blocks — enough to paginate `/rewards/epochs` (2 web pages) and to claim a mixed subset, without hundreds of rows. Emission/epoch = 50 × 416190 = 20,809,500 `utwlt`; per-slot = /4 = 5,202,375. |
| `timeout_commit` | each `config.toml` | **500ms** (knob `BLOCK_TIME`) | default is `5s` → 2,500 blocks would take ~3.5 h. At ~0.6–0.8 s/block the run is ~25–35 min. |

Premine stays **on** — the claim signer (operator1) and authority (operator0) need on-chain accounts.

---

## 2. Drive timeline — `scripts/soak/drive-localnet.sh`

One height-driven orchestrator. A continuous **filler** plus one-shot drills fired at height thresholds
(percent of `TARGET_HEIGHT`, so they scale if the target changes). Every tx uses `--gas 600000 --fees
0utwlt --broadcast-mode sync` and is waited-for via `/tx?hash` (the localnet kv-index is reliable for our
own broadcasts; the explorer remains block-results-authoritative).

| Phase | When (≈height) | Drives | Edge covered |
|---|---|---|---|
| **P0 baseline** | genesis | 4 ACTIVE genesis CoreSlots; operator0/1 funded | genesis-seed gap (3 non-funded operators get windows via the temporal-map genesis seed) |
| **P1 filler** | whole run | `update-payout 1 <addr_k>` over ~80 keys, interleaved `update-metadata 1 "soak-tick-N"`, throttled to spread across the range | ~80 accounts; hundreds of **success** txs; deep cursor on `/accounts`, `/transactions` |
| **P2 rewards** | each epoch boundary | claim a **subset** of finalized epochs across slots 1–4; one **multi-epoch range** claim; leave some unclaimed → **mixed** claimed state. **Failed txs:** one **double-claim** (committed, `code≠0`) + `pause --claims` → claim (fails) → `resume --claims` | rewards pagination; `claimed:true/false` mix; `?status=failed`; "failed never creates state" |
| **P3 lifecycle/authority** | ~30–55% | `update-metadata/payout/params` (slot 1); `inactivate 4`→`activate 4` (set close/reopen at +2); `suspend 4` (emergency)→`activate 4`; `rotate-key 3` + node2 key-swap & restart; `register`+`activate` a **5th** CoreSlot | lifecycle/authority depth; temporal windows close/reopen; key-rotation attribution switch |
| **P4 sparse window** | ~60–72% | stop **node3** for ~1.5× the health window (`SPARSE_WINDOW_BLOCKS`, default 150 committed heights), then restart → recover | sparse liveness: slot 4 miss streak → degraded/**down**; network → **warning**; recovery |
| **P5 remove** | ~80% | `inactivate 5`→`remove 5` (irreversible) | slot 5 drops from health; network back to 4-of-4 |
| **stop** | `TARGET_HEIGHT` | stop the chain **before sampling** (7.2 D5) so observed samples reflect a pinned height | sampled-height correctness |

Failed-tx provenance note (from the dev harness): this app runs message handlers at **DeliverTx**, not
CheckTx, so a rejected claim is **committed into a block with `code≠0`** — a genuine failed-but-included
tx, exactly what the explorer's `status=failed` filter and the "failed tx never creates semantic state"
invariant need.

Slot/authority map (held throughout): slot N owner = `operator(N-1)`; authority msgs → operator0;
`suspend` → operator1 (emergency). Confirmed against `scripts/localnet/lib/drill-common.sh`.

---

## 2.5 Prerequisite — regenerate the explorer descriptor (BEFORE ingest)

Decoding happens at **ingest** (`mapper.ts` → `decode-raw-tx` → the descriptor), so for the §0(2) bank
sends to render as decoded `MsgSend` (not `DecodeFailure`), the descriptor must include the bank `Msg`
types **before** `ingest-project.sh` runs. The decoder resolves purely against the `.pb` (no manifest
gate — verified), and the fix is **one proto root**:

- **Chain side** — add `cosmos/bank/v1beta1/tx.proto` to `COSMOS_PROTOS` in
  `scripts/export-proto-descriptor.sh` (it already lists bank `bank.proto`/`query.proto`, just not `tx`),
  re-run the export → rewrites `docs/proto/twilight-descriptors.pb` with `MsgSend`. *(Proven locally:
  protoc + that one root ⇒ `MsgSend` count 0→4, and protobufjs `lookupType('cosmos.bank.v1beta1.MsgSend')`
  resolves + round-trips.)*
- **Explorer side** — `CHAIN_REPO_PATH=<chain> npm run proto:refresh` copies it into
  `packages/proto/descriptors/`; add a decoder unit test asserting a `MsgSend` decodes. (Skip this whole
  step to keep bank sends as `DecodeFailure` coverage instead — a valid, simpler choice.)

---

## 3. Ingest + project — `scripts/soak/ingest-project.sh`

Ingest the full range, then rebuild **every** projection in the load-bearing order (runbook Part D, with
the rewards ordering corrected per the 13d-3 finding). Run from the explorer repo against the soak DB.

```
ingest START_HEIGHT=1 END_HEIGHT=<tip>
coreslot-semantic        # metadata(+genesis CoreSlot identity seed)→lifecycle→payout→params→key_rotation→temporal_map(+genesis window seed)
block-signatures → operator-signing-evidence → coreslot-liveness → coreslot-liveness-summary → coreslot-health → proposer-attribution
rewards-snapshot → rewards (single, NON-reset pass)   # snapshot populates SlotRewardProjection FIRST, so claims reconcile on first processing
balance-snapshot          # observed sample at the pinned tip
```

The coreslot-semantic + block/liveness/proposer steps each rebuild with `RESET_PROJECTION=true`. **Rewards
is the exception** — claim reconciliation is snapshot-dependent (`applyClaim` marks claims against the
*observed* `SlotRewardProjection` rows), so the snapshot must run **before** the rewards semantic pass, and
that pass must **not** reset (a rewards reset wipes the co-owned `SlotRewardProjection`). On a fresh DB a
single non-reset rewards pass then reconciles every claim on first processing → **zero
`missing_reward_records`**. *(The earlier `rewards(reset) → snapshot → rewards(replay)` order drafted here
was wrong: the rewards CLI is cursor-based, so the "replay" was a no-op — see the 13d-3 soak report's
"Four issues" §1.)* Final assertion: **zero unresolved `ProjectionFailure`** for every `*_v1` projection.

---

## 4. Live RC tier — `RC_LIVE=1` in `scripts/rc-check.mjs` ✅ implemented

Gated behind `RC_LIVE=1` + a real `API_DATABASE_URL` (or `DATABASE_URL` — the soak DB). Boots `buildServer`
with a **real** `PrismaClient` (not `MockPrisma`, reusing the permissive `testConfig`) and checks only what
the static/contract tier *cannot* — things that need real, aged, multi-page data — keeping timing-dependent
exact numbers out (those live in §5 psql). Off by default so the static gate stays CI-runnable. Checks:

1. **Real-data smoke** — the core lists (`/blocks`,`/txs`,`/accounts`,`/coreslots`,`/rewards/epochs`)
   return 200 + **non-empty** `data`; a detail id derived from each list (`/blocks/{height}`,`/txs/{hash}`,
   `/coreslots/{slotId}`,`/accounts/{address}`) returns 200. (Ids derived from the live lists — no model-name guessing.)
2. **Cursor-walk integrity** — page `/blocks` (key `height`) + `/txs` (key `hash`) to exhaustion via
   `page.nextCursor`: dup-free, terminates, walked count **== DB count** (`prisma.block.count` /
   `prisma.explorerTransaction.count`). The deep-pagination truth check.
3. **Zero unresolved `ProjectionFailure`** — `/api/v1/status` `data.projectionFailures.unresolvedCount === 0`.
4. **Freshness truthfulness** — `/status` `data.indexer` present + `freshnessSeconds`/`lagBlocks` fields exist.

The verdict stays **recomputed, not asserted** — a green `RC_LIVE=1 npm run rc-check` *is* the live gate.
**Negative-test sequencing** (a gate's failure mode is silence): run it against the *empty* soak DB first
(before ingest) → expect **RED** (non-empty + cursor-count checks fail), then post-ingest → **GREEN**. The
cursor-walk core (dedup + termination) is *also* falsified in CI without a DB via `node scripts/rc-check.mjs
--self-test` (a mock two-page walk asserts the count; a duplicate id across pages must throw). Deeper
semantic truths (slot-4 miss streak, claimed/unclaimed mix, `/supply == 2e12 + cumulative`) live in §5 psql,
not the gate, because they depend on exact drill timing.

---

## 5. What to record (psql spot-checks + report)

The exact-number assertions (timing-dependent) go in the run report, not the gate — mirroring the runbook
Part F shapes: block contiguity; 4 genesis windows at `effectiveFromHeight=1`; slot-4 miss streak across
the P4 window with `signed+missed == 4×committed-heights`; mixed `claimed`/unclaimed epochs;
`/supply == 2e12 + cumulative`; **zero** unresolved `ProjectionFailure`. Deliverables:

- `docs/research/phase-13d-3-soak-report.md` — fixture params + observed counts + RC_LIVE result + any
  divergence from the expected shapes (divergence is a finding, not a footnote).
- `docs/operations/explorer-release-readiness.md` §3 — fill in the localnet run; mark devnet TODO.

---

## 6. Acceptance (13d-3 done when) — ✓ all met (recorded in `phase-13d-3-soak-report.md`)

- `scripts/soak/drive-localnet.sh` brings the chain to ~2,500 blocks with all phases driven (verified by
  its own end summary: accounts touched, txs success/failed counts, epochs finalized, sparse window
  height range, slots added/removed).
- `scripts/soak/ingest-project.sh` rebuilds all projections with **zero** unresolved `ProjectionFailure`.
- `RC_LIVE=1 npm run rc-check` → **GREEN**, negative-tested to go RED on an empty/un-ingested DB.
- Report + readiness §3 recorded.

## 7. Deferred (documented, not blocking the RC)

- **Primary devnet soak** — the real, aged-data run. Localnet-only this pass (user decision). The drive
  script is localnet-shaped (4 known nodes, PID files); a devnet run is observe-and-ingest only (no
  node-stop drill), recorded separately when devnet access is wired.
- Exact `epoch_length`/`BLOCK_TIME` may need a nudge after the first run if the epoch count or wall-clock
  is off target — both are env knobs.
