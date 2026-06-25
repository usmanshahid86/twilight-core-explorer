import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  getDescriptorBytes,
  loadTwilightMsgTypeUrls,
  TWILIGHT_DESCRIPTOR_PATH,
  TWILIGHT_MSG_TYPE_URLS_PATH,
} from '../dist/index.js';

describe('Twilight proto artifacts', () => {
  it('ships descriptor and manifest files', () => {
    assert.equal(existsSync(TWILIGHT_DESCRIPTOR_PATH), true);
    assert.equal(existsSync(TWILIGHT_MSG_TYPE_URLS_PATH), true);
    assert.ok(getDescriptorBytes().byteLength > 0);
  });

  it('contains expected Twilight message type URLs', () => {
    const manifest = loadTwilightMsgTypeUrls();
    const serialized = JSON.stringify(manifest);

    assert.match(serialized, /\/twilight\.coreslot\.v1\.MsgUpdateOperatorMetadata/);
    assert.match(serialized, /\/twilight\.rewards\.v1\.MsgClaimRewards/);
  });
});
