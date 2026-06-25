import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  decodeRawTxBase64,
  decodeRawTxBytes,
  getTwilightProtoRoot,
  lookupMessageByTypeUrl,
} from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8'));
}

describe('Twilight descriptor-backed raw tx decoder', () => {
  it('loads descriptor into a protobuf root', () => {
    const root = getTwilightProtoRoot();
    assert.ok(root.lookupType('cosmos.tx.v1beta1.TxRaw'));
    assert.ok(root.lookupType('cosmos.tx.v1beta1.TxBody'));
    assert.ok(root.lookupType('twilight.coreslot.v1.MsgUpdateOperatorMetadata'));
    assert.ok(root.lookupType('twilight.rewards.v1.MsgClaimRewards'));
  });

  it('looks up message types by Any type URL', () => {
    assert.ok(lookupMessageByTypeUrl('/twilight.coreslot.v1.MsgUpdateOperatorMetadata'));
    assert.ok(lookupMessageByTypeUrl('type.googleapis.com/twilight.rewards.v1.MsgClaimRewards'));
    assert.equal(lookupMessageByTypeUrl('/twilight.unknown.v1.MsgNope'), undefined);
  });

  it('returns structured error records for invalid raw tx bytes', () => {
    const decoded = decodeRawTxBytes(Uint8Array.from([1, 2, 3, 4]));

    assert.equal(decoded.messages.length, 0);
    assert.equal(decoded.failures[0].failureKind, 'tx_raw_decode');
    assert.match(decoded.decodeError ?? '', /index out of range|invalid|wire/i);
  });

  it('decodes the A/B-4 CoreSlot metadata update raw tx fixture', () => {
    const fixture = loadFixture('coreslot-update-metadata-tx.json');
    const decoded = decodeRawTxBase64(fixture.rawTxBase64);

    assert.equal(decoded.decodeError, undefined);
    assert.equal(decoded.messages.length >= 1, true);
    assert.equal(decoded.messages[0].typeUrl, fixture.expectedTypeUrl);
    assert.equal(decoded.messages[0].module, 'coreslot');
    assert.equal(decoded.messages[0].typeName, 'MsgUpdateOperatorMetadata');
    assert.ok(decoded.messages[0].decodedJson);
    assert.equal(decoded.failures.length, 0);
  });
});
