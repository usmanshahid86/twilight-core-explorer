import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './concurrency';

describe('mapWithConcurrency', () => {
  it('preserves input order', async () => {
    const r = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(r).toEqual([10, 20, 30, 40]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let max = 0;
    const items = Array.from({ length: 50 }, (_, i) => i);
    await mapWithConcurrency(items, 5, async (n) => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return n;
    });
    expect(max).toBeLessThanOrEqual(5);
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 5, async (n) => n)).toEqual([]);
  });
});
