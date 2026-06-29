import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getTwilightProtoRoot,
  lookupMessageByTypeUrl,
  typeUrlToModule,
  typeUrlToTypeName,
} from '../dist/index.js';

// Phase 13d-3: bank `tx.proto` was added to the chain proto export (so the descriptor carries
// cosmos.bank.v1beta1.Msg*) and mirrored into packages/proto via `proto:refresh`. This locks in
// that a real `tx bank send` MsgSend decodes cleanly through the explorer decoder (vs landing as a
// DecodeFailure). The decoder resolves purely against the descriptor — no manifest gate.
describe('cosmos.bank MsgSend decoding (descriptor includes bank tx types)', () => {
  it('resolves cosmos.bank.v1beta1.MsgSend from the descriptor root', () => {
    const root = getTwilightProtoRoot();
    assert.ok(
      root.lookupType('cosmos.bank.v1beta1.MsgSend'),
      'MsgSend must be in the descriptor — add cosmos/bank/v1beta1/tx.proto to the chain export + run proto:refresh',
    );
  });

  it('looks up MsgSend by Any type URL (both leading-slash and type.googleapis.com forms)', () => {
    assert.ok(lookupMessageByTypeUrl('/cosmos.bank.v1beta1.MsgSend'));
    assert.ok(lookupMessageByTypeUrl('type.googleapis.com/cosmos.bank.v1beta1.MsgSend'));
    assert.equal(typeUrlToModule('/cosmos.bank.v1beta1.MsgSend'), 'bank');
    assert.equal(typeUrlToTypeName('/cosmos.bank.v1beta1.MsgSend'), 'MsgSend');
  });

  it('round-trips a MsgSend payload (fields wire up against the descriptor)', () => {
    const MsgSend = getTwilightProtoRoot().lookupType('cosmos.bank.v1beta1.MsgSend');
    const bytes = MsgSend.encode(
      MsgSend.create({ amount: [{ denom: 'utwlt', amount: '1000000' }] }),
    ).finish();
    const decoded = MsgSend.toObject(MsgSend.decode(bytes));
    assert.deepEqual(decoded.amount, [{ denom: 'utwlt', amount: '1000000' }]);
  });
});
