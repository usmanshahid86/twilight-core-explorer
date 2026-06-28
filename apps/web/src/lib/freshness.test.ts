import { describe, expect, it } from 'vitest';
import { deriveIndexerFreshness, deriveProjectionHealth, deriveSampleAge } from './freshness';

const indexer = (lagBlocks: string | null) => ({
  lastIndexedHeight: '10',
  latestChainHeight: '10',
  lagBlocks,
  status: 'synced',
  lastIndexedHash: null,
  updatedAt: '',
  freshnessSeconds: 1,
  error: null,
});

describe('indexer freshness', () => {
  it('unknown when indexer is null', () => {
    expect(deriveIndexerFreshness(null).kind).toBe('unknown');
  });
  it('unknown when lagBlocks is null', () => {
    expect(deriveIndexerFreshness(indexer(null)).kind).toBe('unknown');
  });
  it('fresh under threshold', () => {
    expect(deriveIndexerFreshness(indexer('0')).kind).toBe('fresh');
  });
  it('lagging over threshold', () => {
    expect(deriveIndexerFreshness(indexer('110')).kind).toBe('lagging');
  });
});

describe('projection health', () => {
  it('clean when no unresolved failures', () => {
    expect(deriveProjectionHealth({ unresolvedCount: 0, byProjection: [] }).failing).toBe(false);
  });
  it('failing when unresolved failures exist', () => {
    expect(deriveProjectionHealth({ unresolvedCount: 3, byProjection: [] }).failing).toBe(true);
  });
});

describe('sample age (BigInt height math, no Number())', () => {
  it('none when there is no sample', () => {
    expect(deriveSampleAge(null, '100').kind).toBe('none');
  });
  it('unknown (never a false "fresh") when the latest indexed height is null', () => {
    // Regression M-003: previously returned {kind:'fresh', deltaBlocks:'0'} -> a false "sample current".
    expect(deriveSampleAge('100', null)).toEqual({ kind: 'unknown' });
  });
  it('unknown when the latest indexed height is non-numeric', () => {
    expect(deriveSampleAge('100', 'abc')).toEqual({ kind: 'unknown' });
  });
  it('fresh on small delta', () => {
    expect(deriveSampleAge('100', '120')).toEqual({ kind: 'fresh', deltaBlocks: '20' });
  });
  it('old on large delta', () => {
    expect(deriveSampleAge('100', '200')).toEqual({ kind: 'old', deltaBlocks: '100' });
  });
  it('clamps a negative delta to 0', () => {
    expect(deriveSampleAge('100', '90')).toEqual({ kind: 'fresh', deltaBlocks: '0' });
  });
  it('is precise beyond Number.MAX_SAFE_INTEGER', () => {
    expect(deriveSampleAge('9007199254740990', '9007199254740993')).toEqual({
      kind: 'fresh',
      deltaBlocks: '3',
    });
  });
});
