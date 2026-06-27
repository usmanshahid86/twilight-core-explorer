import { describe, expect, it } from 'vitest';
import { hasMore, nextPageParam } from './pagination';

describe('keyset pagination helpers', () => {
  it('returns the opaque cursor as the next page param', () => {
    expect(nextPageParam({ data: [], page: { limit: 25, nextCursor: 'opaque-abc' } })).toBe('opaque-abc');
  });

  it('stops (undefined) when nextCursor is null — end of list', () => {
    expect(nextPageParam({ data: [], page: { limit: 25, nextCursor: null } })).toBeUndefined();
  });

  it('hasMore reflects nextCursor presence', () => {
    expect(hasMore({ limit: 25, nextCursor: 'x' })).toBe(true);
    expect(hasMore({ limit: 25, nextCursor: null })).toBe(false);
  });
});
