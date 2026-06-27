import { describe, expect, it } from 'vitest';
import { displayName, parseOperatorMetadata } from './operator-metadata';

describe('parseOperatorMetadata (open-ended, defensive)', () => {
  it('promotes moniker and preserves unknown keys as extras', () => {
    const r = parseOperatorMetadata({ moniker: 'core5', website: 'https://x', details: { a: 1 } });
    expect(r.moniker).toBe('core5');
    expect(r.extras).toEqual({ website: 'https://x', details: { a: 1 } });
  });

  it('returns empty extras for null / scalar / array (never throws)', () => {
    expect(parseOperatorMetadata(null)).toEqual({ extras: {} });
    expect(parseOperatorMetadata('moniker')).toEqual({ extras: {} });
    expect(parseOperatorMetadata(42)).toEqual({ extras: {} });
    expect(parseOperatorMetadata(['a'])).toEqual({ extras: {} });
    expect(parseOperatorMetadata(undefined)).toEqual({ extras: {} });
  });

  it('ignores a non-string / empty moniker', () => {
    expect(parseOperatorMetadata({ moniker: 123 }).moniker).toBeUndefined();
    expect(parseOperatorMetadata({ moniker: '' }).moniker).toBeUndefined();
  });
});

describe('displayName', () => {
  it('prefers the moniker', () => {
    expect(displayName({ moniker: 'core5', operatorAddress: 'twilight1abcdefghijklmnop' })).toBe('core5');
  });
  it('falls back to a shortened operator address', () => {
    expect(displayName({ operatorAddress: 'twilight1abcdefghijklmnopqrstuv' })).toBe('twilight1a…qrstuv');
  });
  it('falls back to em dash when nothing is known', () => {
    expect(displayName({ operatorAddress: null })).toBe('—');
    expect(displayName({})).toBe('—');
  });
});
