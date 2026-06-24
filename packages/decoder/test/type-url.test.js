import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isTwilightMsgTypeUrl,
  normalizeTypeUrl,
  typeUrlToLookupName,
  typeUrlToModule,
  typeUrlToTypeName,
} from '../dist/index.js';

describe('type URL helpers', () => {
  it('normalizes slash and type.googleapis.com forms', () => {
    assert.equal(
      normalizeTypeUrl('/twilight.coreslot.v1.MsgUpdateOperatorMetadata'),
      '/twilight.coreslot.v1.MsgUpdateOperatorMetadata',
    );
    assert.equal(
      normalizeTypeUrl('type.googleapis.com/twilight.coreslot.v1.MsgUpdateOperatorMetadata'),
      '/twilight.coreslot.v1.MsgUpdateOperatorMetadata',
    );
    assert.equal(
      typeUrlToLookupName('/cosmos.bank.v1beta1.MsgSend'),
      'cosmos.bank.v1beta1.MsgSend',
    );
  });

  it('classifies known module/type names', () => {
    assert.equal(typeUrlToModule('/twilight.coreslot.v1.MsgUpdateOperatorMetadata'), 'coreslot');
    assert.equal(typeUrlToModule('/twilight.rewards.v1.MsgClaimRewards'), 'rewards');
    assert.equal(typeUrlToModule('/cosmos.bank.v1beta1.MsgSend'), 'bank');
    assert.equal(typeUrlToModule('/cosmos.auth.v1beta1.BaseAccount'), 'auth');
    assert.equal(typeUrlToTypeName('/twilight.rewards.v1.MsgClaimRewards'), 'MsgClaimRewards');
    assert.equal(isTwilightMsgTypeUrl('/twilight.coreslot.v1.MsgUpdateOperatorMetadata'), true);
    assert.equal(isTwilightMsgTypeUrl('/cosmos.bank.v1beta1.MsgSend'), false);
  });
});
