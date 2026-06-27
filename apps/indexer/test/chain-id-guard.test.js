import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertChainIdMatches } from '../dist/chain-id-guard.js';

describe('assertChainIdMatches (CHAIN_ID mislabel guard)', () => {
  it('throws when the node reports a different chain-id than configured', () => {
    assert.throws(
      () => assertChainIdMatches('twilight-localnet-1', 'twilight-rewards-fixture-1'),
      /CHAIN_ID mismatch.*twilight-localnet-1.*twilight-rewards-fixture-1/s,
    );
  });

  it('is a no-op when configured and reported chain-ids agree', () => {
    assert.doesNotThrow(() =>
      assertChainIdMatches('twilight-rewards-fixture-1', 'twilight-rewards-fixture-1'));
  });

  it('is a no-op when the node does not report a chain-id (cannot reconcile)', () => {
    assert.doesNotThrow(() => assertChainIdMatches('twilight-localnet-1', undefined));
  });
});
