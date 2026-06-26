import { describe, expect, it } from 'vitest';
import { formatHeight, groupDigits } from './height';
import { formatAmount } from './amount';
import { shortenMiddle } from './address';

describe('height formatting preserves strings (never Number())', () => {
  it('groups thousands', () => {
    expect(groupDigits('1000000')).toBe('1,000,000');
    expect(groupDigits('999')).toBe('999');
  });

  it('keeps full precision well beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = '92233720368547758079223372';
    expect(formatHeight(huge).replace(/,/g, '')).toBe(huge);
  });

  it('placeholders null/empty', () => {
    expect(formatHeight(null)).toBe('—');
    expect(formatHeight('')).toBe('—');
  });
});

describe('utwlt -> TWLT conversion preserves raw (BigInt only)', () => {
  it('converts whole TWLT and keeps the raw utwlt', () => {
    const a = formatAmount('2000000000000', 'utwlt');
    expect(a.display).toBe('2,000,000');
    expect(a.symbol).toBe('TWLT');
    expect(a.raw).toBe('2000000000000');
    expect(a.rawDenom).toBe('utwlt');
  });

  it('keeps fractional precision', () => {
    expect(formatAmount('1234567', 'utwlt').display).toBe('1.234567');
    expect(formatAmount('1000000', 'utwlt').display).toBe('1');
    expect(formatAmount('500000', 'utwlt').display).toBe('0.5');
  });

  it('does not lose precision on int64-scale amounts', () => {
    const raw = '90071992547409910000001';
    const a = formatAmount(raw, 'utwlt');
    expect(a.raw).toBe(raw);
    expect(a.display).not.toContain('e');
  });

  it('renders an unknown denom verbatim, never guessing', () => {
    const a = formatAmount('5', 'uother');
    expect(a.display).toBe('5');
    expect(a.symbol).toBe('uother');
    expect(a.raw).toBe('5');
  });
});

describe('address/hash shortening', () => {
  it('shortens long values but is reversible from the title', () => {
    expect(shortenMiddle('twilight1abcdefghijklmnopqrstuvwxyz', 8, 4)).toBe('twilight…wxyz');
  });
  it('leaves short values intact', () => {
    expect(shortenMiddle('short')).toBe('short');
  });
});
