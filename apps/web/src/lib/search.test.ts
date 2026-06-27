import { describe, expect, it } from 'vitest';
import { searchResultHref } from './search';

// Confirms search navigation reaches the new Phase 10b generic detail routes.
describe('search result routing', () => {
  it('maps typed results to block/tx/account routes', () => {
    expect(searchResultHref({ type: 'block', height: '5', hash: null })).toBe('/blocks/5');
    expect(searchResultHref({ type: 'transaction', hash: 'AB12', height: '5' })).toBe('/txs/AB12');
    expect(searchResultHref({ type: 'account', address: 'twilight1abc' })).toBe('/accounts/twilight1abc');
  });

  it('URL-encodes result identifiers', () => {
    expect(searchResultHref({ type: 'account', address: 'twi/x' })).toBe('/accounts/twi%2Fx');
  });
});
