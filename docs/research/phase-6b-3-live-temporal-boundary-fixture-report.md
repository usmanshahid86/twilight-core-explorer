# Twilight Core Explorer Phase 6b-3 Live Temporal Boundary Fixture Report

Date: 2026-06-25

Status: PASS — live evidence collected; Phase 6b-2 boundary assumption contradicted.

## 1. Summary

Phase 6b-3 ran a live temporal-boundary fixture against the already-running 4-node
Twilight localnet.

The current Phase 6b-2 temporal map assumes:

```text
validator-set effect emitted at height H -> consensus identity applies at H + 1
unless the event explicitly provides effective_height
```

Live evidence does not support that assumption for block-height validator-set membership.

Observed rule from this fixture:

```text
validator update emitted/applied at height H
next_validators_hash changes at H + 1
validators_hash and /validators?height membership change at H + 2
```

For key rotation, the chain emitted `effective_height=3582`, but the new consensus address
appeared in `/validators?height` at height 3584. For activation, the activation event landed
at 3567 and the reactivated consensus address appeared in `/validators?height` at height
3569.

No projector code was changed in this phase. A follow-up implementation patch is required.

## 2. Localnet Environment

- Chain repo: `<path-to-nyks-core>`
- Explorer repo: `<path-to-twilight-core-explorer>`
- Localnet home: `<twilight-localnet-home>`
- Chain ID: `twilight-localnet-1`
- RPC: `http://127.0.0.1:26657`
- REST: `http://127.0.0.1:1317`
- Topology: 4 local validator nodes
- Binary: `<path-to-nyks-core>/build/twilightd`

Baseline status:

- node0 RPC reported chain `twilight-localnet-1`.
- initial height at discovery was around 3544.
- four active CoreSlot slots were present.
- baseline `/validators` contained four consensus addresses:
  - `A071AC8728912DAB4405B9E7E106294CB27F0B15`
  - `AFF2293E38E4F3D308B9601B74829DAEF1E98B1A`
  - `F060BF2347C76488A0390285E3B9EF3A44EC7D23`
  - `F355E56B8F475280E5FC84E71AC57CB018FA8411`

Slot 4 was used for the fixture:

- operator: `twilight10c2jwy9vnhvtznflfr9urt87l34vrat7hfqsqq`
- old consensus address: `F060BF2347C76488A0390285E3B9EF3A44EC7D23`

## 3. Baseline State

The localnet already had the Phase 6a-1 smoke metadata update on slot 1 at height 120.
At this fixture's start, all four genesis slots were active.

The explorer DB was then extended by ingesting the live fixture range:

```text
START_HEIGHT=3553
END_HEIGHT=3585
```

CoreSlot semantic rebuild was run over the same range without resetting earlier semantic
state.

## 4. Fixture Commands Executed

Lifecycle closure:

```text
twilightd coreslot inactivate 4 phase-6b-3-boundary \
  --from operator0 --keyring-backend test --home <twilight-localnet-home>/node0 \
  --chain-id twilight-localnet-1 --node tcp://127.0.0.1:26657 \
  --gas 600000 --fees 0utwlt --broadcast-mode sync --output json -y
```

Lifecycle activation:

```text
twilightd coreslot activate 4 \
  --from operator0 --keyring-backend test --home <twilight-localnet-home>/node0 \
  --chain-id twilight-localnet-1 --node tcp://127.0.0.1:26657 \
  --gas 600000 --fees 0utwlt --broadcast-mode sync --output json -y
```

Key rotation:

```text
<path-to-nyks-core>/scripts/localnet/gen-consensus-key.sh phase-6b-3-slot4-rotation

twilightd coreslot rotate-key 4 <new-consensus-pubkey-base64> \
  --from operator0 --keyring-backend test --home <twilight-localnet-home>/node0 \
  --chain-id twilight-localnet-1 --node tcp://127.0.0.1:26657 \
  --gas 600000 --fees 0utwlt --broadcast-mode sync --output json -y
```

After the key rotation, node3 was restarted with the generated key file so the localnet
remained healthy:

```text
cp <twilight-localnet-home>/keys/phase-6b-3-slot4-rotation/config/priv_validator_key.json \
  <twilight-localnet-home>/node3/config/priv_validator_key.json
```

## 5. Lifecycle Boundary Evidence

### Inactivation

- tx hash: `7E25F9E12E3FD6547571F6F3A74622088DE87482AAB5D9A1924D114C88A62190`
- tx height: `3554`
- event: `coreslot_inactivated`
- validator update event: `coreslot_validator_update_emitted`
- update consensus address: `f060bf2347c76488a0390285e3b9ef3a44ec7d23`
- update power: `0`
- update event height attr: `3554`

Validator set observation:

| Height | `/validators` count | Slot 4 old address present? | Header note |
|---:|---:|---|---|
| 3553 | 4 | yes | baseline |
| 3554 | 4 | yes | tx/event height |
| 3555 | 4 | yes | `next_validators_hash` changed |
| 3556 | 3 | no | `validators_hash` changed |

Conclusion: inactivation emitted at 3554 affects `/validators?height` membership at 3556.

### Reactivation

- tx hash: `6F96F34DB584E905B4046777C4D3F81A582B075BEC3898E6C6596745C37B2892`
- tx height: `3567`
- event: `coreslot_activated`
- validator update event: `coreslot_validator_update_emitted`
- update consensus address: `f060bf2347c76488a0390285e3b9ef3a44ec7d23`
- update power: `1`
- update event height attr: `3567`

Validator set observation:

| Height | `/validators` count | Slot 4 old address present? | Header note |
|---:|---:|---|---|
| 3566 | 3 | no | baseline after inactivation |
| 3567 | 3 | no | tx/event height |
| 3568 | 3 | no | `next_validators_hash` changed |
| 3569 | 4 | yes | `validators_hash` changed |
| 3570 | 4 | yes | stable |

Conclusion: activation emitted at 3567 affects `/validators?height` membership at 3569.

## 6. Key-Rotation Boundary Evidence

Key rotation request:

- tx hash: `2EAD74E3F815753D6E0729CA9BD18A4440940BA3E5A510788C04D06847D611E0`
- tx height: `3581`
- tx event: `coreslot_key_rotation_requested`
- slot id: `4`
- old consensus address: `f060bf2347c76488a0390285e3b9ef3a44ec7d23`
- new consensus address: `fa90d27eb73b75fed0fc7587d95da6537dc76f23`
- event `effective_height`: `3582`
- `msg_index`: `0`

Delayed application:

- apply event height: `3582`
- event: `coreslot_key_rotated`
- old consensus address: `f060bf2347c76488a0390285e3b9ef3a44ec7d23`
- new consensus address: `fa90d27eb73b75fed0fc7587d95da6537dc76f23`
- event `effective_height`: `3582`
- paired validator updates at 3582:
  - old address power `0`
  - new address power `1`

Validator set observation:

| Height | Old address present? | New address present? | Header note |
|---:|---|---|---|
| 3580 | yes | no | baseline |
| 3581 | yes | no | request tx height |
| 3582 | yes | no | `coreslot_key_rotated`, `effective_height=3582` |
| 3583 | yes | no | `next_validators_hash` changed |
| 3584 | no | yes | `validators_hash` changed |
| 3585 | no | yes | stable |

Conclusion: a rotation application event at 3582 with explicit `effective_height=3582`
affects `/validators?height` membership at 3584.

## 7. Validator-Set Comparison

Observed pattern across lifecycle and key rotation:

| Case | Event / update height | Event effective_height | `/validators` membership changes at | Current 6b-2 map would use | Match? |
|---|---:|---:|---:|---:|---|
| inactivate slot 4 | 3554 | none | 3556 | 3555 | no |
| reactivate slot 4 | 3567 | none | 3569 | 3568 | no |
| rotate slot 4 | 3582 | 3582 | 3584 | 3582 | no |

The evidence supports separate meanings:

- update emitted/applied height: event height or event `effective_height`
- next validator hash boundary: update height + 1
- validator set used by block height / `/validators?height`: update height + 2

The Phase 6b-2 map is intended for proposer/liveness attribution by block height, so it
should align with the validator set used at block height.

## 8. Explorer Semantic Projection Comparison

Explorer ingestion:

```text
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public \
CHAIN_ID=twilight-localnet-1 \
COMET_RPC_URL=http://127.0.0.1:26657 \
REST_URL=http://127.0.0.1:1317 \
START_HEIGHT=3553 END_HEIGHT=3585 \
npm --prefix apps/indexer run dev
```

Semantic rebuild:

```text
DATABASE_URL=postgresql://twilight:twilight@localhost:5432/twilight_explorer?schema=public \
CHAIN_ID=twilight-localnet-1 \
START_HEIGHT=3553 END_HEIGHT=3585 RESET_PROJECTION=false \
npm --prefix apps/indexer run project:coreslot-semantic:dev
```

Indexed generic rows for the three fixture txs:

- `MsgInactivateCoreSlot` at 3554
- `MsgActivateCoreSlot` at 3567
- `MsgRotateConsensusKey` at 3581

Projected semantic rows:

- `CoreSlotLifecycleEvent` captured inactivation at 3554.
- `CoreSlotLifecycleEvent` captured activation at 3567.
- `CoreSlotConsensusKeyRotation` captured the request at 3581.
- `CoreSlotConsensusWindow` opened slot 4 at `effectiveFromHeight=3568`.

Mismatch:

- live `/validators?height` shows slot 4 reactivated at 3569, not 3568.
- live rotation shows new consensus at 3584, but the current temporal map logic would use
  `effective_height=3582` once the delayed apply event is indexed.

Additional ingestion gap:

- raw CometBFT `block_results?height=3582` includes `finalize_block_events` with
  `coreslot_key_rotated` and two `coreslot_validator_update_emitted` events.
- the explorer `Event` table had no rows for height 3582 after ingestion.
- current chain-client/indexer mapping reads `begin_block_events` and `end_block_events`,
  but the local CometBFT response uses `finalize_block_events`.

That ingestion gap prevents the current key-rotation semantic projector from seeing the
delayed EndBlock apply event.

## 9. Effective-Height Conclusion

The current Phase 6b-2 rule is not correct for block-height validator-set membership.

Recommended implementation change, not applied in this phase:

1. First fix generic block-results ingestion to include CometBFT `finalize_block_events`.
2. Preserve the chain event `effective_height` as the validator-update application height.
3. For `CoreSlotConsensusWindow.effectiveFromHeight`, use the height where the address
   appears in `/validators?height`, which this fixture shows as:

```text
validatorSetMembershipHeight = validatorUpdateHeight + 2
```

4. For lifecycle events without explicit `effective_height`, derive:

```text
validatorUpdateHeight = event.height
effectiveFromHeight = event.height + 2
```

5. For key rotation:

```text
validatorUpdateHeight = event.effective_height
effectiveFromHeight = event.effective_height + 2
```

6. Update temporal-map tests to distinguish:

- event/update height
- next validator hash height (`+1`)
- block validator-set membership height (`+2`)

## 10. Projector Changes Made

No projector changes were made.

This phase found a concrete mismatch and stopped at documentation/evidence, as requested.

## 11. Known Limitations

- The fixture exercised inactivation, reactivation, and delayed key rotation for slot 4.
- Suspension/removal were not exercised to avoid extra disruption; they should follow the
  same validator-update path but remain unconfirmed by this fixture.
- The explorer semantic comparison for delayed key rotation is incomplete until
  `finalize_block_events` are indexed.
- The localnet was already running and had prior Phase 6a smoke state; this report documents
  the exact observed heights rather than assuming a pristine genesis-only chain.

## 12. Artifacts / Raw Evidence Paths

Artifacts are under:

```text
docs/research/artifacts/phase-6b-3/
```

Key files:

- `inactivate-slot4.json`
- `inactivate-slot4/summary.json`
- `inactivate-slot4/block-results-3554.json`
- `reactivate-slot4.json`
- `reactivate-slot4/summary.json`
- `reactivate-slot4/block-results-3567.json`
- `rotate-slot4.json`
- `rotate-slot4/summary.json`
- `rotate-slot4/tx-3581.json`
- `rotate-slot4/block-results-3582.json`
- `explorer-db-comparison.json`
- `node3-restart.json`

## 13. Next Recommended Step

Implement a narrow Phase 6b-3 follow-up patch:

1. update `RestRpcChainClient.getBlockResults` / indexer mapping to include
   `finalize_block_events`.
2. adjust temporal map effective-height logic from `H + 1` / raw `effective_height` to
   block-membership height `validatorUpdateHeight + 2`.
3. update tests for lifecycle and key-rotation windows using the live fixture numbers above.
4. rerun ingestion/rebuild over 3553..3585 and confirm:
   - slot 4 old window closes at 3556 for inactivation.
   - slot 4 old address reopens at 3569 for activation.
   - slot 4 old address closes and new address opens at 3584 for rotation.
