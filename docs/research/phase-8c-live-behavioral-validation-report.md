# Live Behavioral Validation — CoreSlot Transactions End-to-End

Date: 2026-06-26

Status: **PASS (all 7 categories).** Zero unresolved `ProjectionFailure` across the entire run.

This report documents an end-to-end behavioral test of the explorer's CoreSlot semantic + liveness
projection stack, driven entirely by **real `twilightd` transactions** against the live 4-CoreSlot
localnet (no DB manipulation, no simulation). For each category we broadcast a real tx, observed the
actual chain reaction (validator-set transitions via `/validators`), then ingested the new blocks and
verified the indexer's derived rows. It closes checkpoint **Open Question #1** (lifecycle close / the
`validatorUpdateHeight + 2` membership boundary — previously "corrected by consistency, not yet
live-proven") on live data.

## Method

- **Philosophy:** all semantic state changes come from real chain txs; the DB is only ever reset, never
  hand-edited. Everything verified is rebuildable from generic rows + genesis.
- **Per category:** broadcast tx → confirm on-chain effect (`/validators`, `coreslot-query`) → ingest
  the new height range → run the affected projections (incremental, cursor-based — real-time indexer
  behavior) → query the derived rows.
- **Verification source of truth = the indexer**, not `twilightd query tx` (the localnet's tx index is
  unreliable; the explorer reads `/block` + `/block_results`, so it is authoritative here).
- **Environment:** chain repo `nyks-core` (`build/twilightd`, `scripts/localnet/`), localnet home
  `/tmp/twilight-localnet`, explorer DB `twilight_explorer`. Authority = `operator0` (node0),
  emergency authority = `operator1` (node1); slot N owner = `operator(N-1)`. Baseline before the test:
  4 active CoreSlots, contiguous blocks 1..2688, all healthy, network `normal`, 0 failures.

tx command shape (all categories):

```
twilightd coreslot <subcmd> <args> --from <operator> --keyring-backend test \
  --home /tmp/twilight-localnet/<node> --chain-id twilight-localnet-1 --node tcp://127.0.0.1:26657 \
  --gas 600000 --fees 0utwlt --broadcast-mode sync --output json -y
```

## Results

### A — metadata (`update-metadata 1 "explorer-live-test"`, operator0)
- Landed at heights 2906 + 2916 (two broadcasts), event `coreslot_metadata_updated`.
- Indexer: decoded `MsgUpdateOperatorMetadata` (slot 1, moniker, operator), wrote `CoreSlotMetadataChange`
  rows with full provenance (sourceMessageId/EventId, raw payloads), and updated
  `CoreSlotProjection.metadataJson`. **PASS.**

### B — payout (`update-payout 1 <addr>`, operator0)
- Landed at ~2967. Indexer updated `CoreSlotProjection.payoutAddress` from empty → the new address.
  **PASS.**

### C — params (`update-params <file>`, operator0)
- Landed at 2998, event `coreslot_params_updated`; on-chain `max_active_slots` 100 → 101; indexer wrote
  `CoreSlotParameterChange`. **PASS.** (Gotcha: int64 params fields must be JSON numbers, not the strings
  `coreslot-query params` returns.)

### D — lifecycle inactivate → reactivate (slot 4, operator0)
- `inactivate 4` landed @3010 → validator set dropped **4→3 at 3012** (= +2); `activate 4` @3017 →
  **3→4 at 3019** (= +2), observed live on `/validators`.
- Indexer: lifecycle events `coreslot_inactivated`@3010 / `coreslot_activated`@3017; genesis
  `CoreSlotConsensusWindow` for slot 4 **closed at effectiveToHeight=3012**, new window **opened at
  effectiveFromHeight=3019**. During 3012–3018 slot 4 had **zero liveness rows** — window-closed =
  not-expected, so inactive is **not** counted as missed. **PASS.** (First live proof of the
  genesis-window close path.)

### E — key rotation (slot 3, operator0 + node2 key swap/restart)
- `rotate-key 3 <newpub>` applied @3049 (KeyRotationDelayBlocks=1); node2's `priv_validator_key.json`
  swapped to the new key and restarted (state file left in place — no double-sign). New key `e0253f`
  signing by 3056.
- Indexer: `CoreSlotConsensusKeyRotation` slot 3 `applied` (`82b06c`→`e0253f`); window switched —
  old `82b06c` closed @3051, new `e0253f` opened @3051 (= applied +2); attribution **followed the same
  slotId** across the address change (`82b06c`→slot 3 ≤3050, `e0253f`→slot 3 ≥3056). The 3051–3055
  rotation gap (new window open, node still catching up) was correctly attributed as 5 slot-3 misses →
  `degraded`. The `observed_attributed_slot_not_expected` guard did **not** misfire. **PASS.**

### F — add + remove operator (slot 5)
- `register` (new operator + new consensus key no node holds) → PENDING; `activate 5` → validator set
  **4→5 at 3082**. Slot 5 is an active validator that never signs (chain stays live on 4/5).
- Indexer: window opened @3082; slot 5 accumulated **11 `absent` misses** (anonymous-absent
  set-difference correctly attributed them) → health **`down`** / `sustained_miss_streak`; network
  `warning`, availablePowerBps 8000 (4/5).
- `inactivate 5` → 5→4 at 3104; `remove 5` → `SLOT_STATUS_REMOVED`. Indexer: full lifecycle
  (registered@3079→activated@3080→inactivated@3102→removed@3105); window closed @3104; slot 5 **dropped
  from health** (8c-3 emits only active slots); network back to 4 active. **PASS.**

### G — suspend → reactivate (slot 2, emergency operator1)
- `suspend 2` (emergency) @3187 → validator set **4→3 at 3189** (= +2); `activate 2` @3190 → **3→4 at
  3192** (= +2).
- Indexer: `coreslot_suspended`@3187 (ACTIVE→SUSPENDED) / `coreslot_activated`@3190; window closed
  @3189, reopened @3192. **PASS.**

## Key findings

1. **The `+2` membership boundary is empirically proven** for inactivate, reactivate, suspend, and key
   rotation — every validator-set transition matched `txHeight + 2` block-for-block against
   `/validators`.
2. **Inactive/suspended ≠ missed.** A window-closed slot is not in the expected set, so it produces no
   missed rows — a real outage and a planned inactivation are correctly distinguished.
3. **Attribution follows the slot across a key rotation** — the consensus address changes, the slotId
   (operator identity) does not.
4. **The anonymous-absent set-difference generalizes to a freshly-added operator** — slot 5's misses
   were attributed with no address to read, purely from "expected minus signed".
5. **Health/halt-risk react correctly to real events** — a down operator → `warning` with the right
   available-power math; recovery self-heals as misses age out of recent_100.

## Operational gotchas (carried into the runbook)

- `twilightd query tx <hash>` often returns "not found" even for committed txs on this localnet —
  verify landing via the indexer (Message/Event rows), not `query tx`.
- `coreslot update-params` wants int64 params fields as JSON **numbers**; `coreslot-query params`
  returns them as **strings** → convert (`jq '... |= tonumber'`) or it errors `cannot unmarshal string`.
- All projections share **one global Postgres advisory lock**; running them back-to-back in a tight
  loop can transiently fail with a lock error — put a small gap between runs.
- A consensus key swap must copy only `priv_validator_key.json` and **leave `priv_validator_state.json`**
  in place (prevents height regression / double-sign on restart).

## Final state

4 active CoreSlots (slot 3 on its rotated key `e0253f`; slot 5 removed); blocks ingested contiguously
to ~3196; all 4 slots `healthy`; network `normal`/`all_healthy`; 0 unresolved `ProjectionFailure`. The
explorer's CoreSlot semantic, temporal-map, liveness, summary, and health layers are now live-proven
against real chain behavior end-to-end — a sound foundation for Phase 9 (API).
