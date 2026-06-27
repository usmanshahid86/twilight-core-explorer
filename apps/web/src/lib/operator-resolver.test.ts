import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api/client';
import { resolveOperator } from './operator-resolver';

const slot = (slotId: string, extra: Record<string, unknown> = {}) => ({
  slotId,
  status: 'active',
  operatorAddress: 'op',
  payoutAddress: null,
  consensusAddress: 'cons',
  consensusPower: '1',
  rewardWeight: '1',
  createdHeight: '1',
  updatedHeight: '2',
  removedHeight: null,
  ...extra,
});
const pageOf = (slots: ReturnType<typeof slot>[]) => ({ data: slots, page: { limit: 100, nextCursor: null } });

afterEach(() => vi.clearAllMocks());

describe('resolveOperator (fallback operator -> consensus -> payout)', () => {
  it('matches by operatorAddress and STOPS (no further queries)', async () => {
    const get = vi.fn(async () => pageOf([slot('1')]));
    const r = await resolveOperator('addr', get as never);
    expect(r.matchedRole).toBe('operator');
    expect(r.slots).toHaveLength(1);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/api/v1/coreslots', { operatorAddress: 'addr', limit: 100 });
  });

  it('falls back to consensusAddress when operator is empty', async () => {
    const get = vi.fn(async (_p: string, q: Record<string, unknown>) =>
      'consensusAddress' in q ? pageOf([slot('2')]) : pageOf([]),
    );
    const r = await resolveOperator('addr', get as never);
    expect(r.matchedRole).toBe('consensus');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('falls back to payoutAddress when operator and consensus are empty', async () => {
    const get = vi.fn(async (_p: string, q: Record<string, unknown>) =>
      'payoutAddress' in q ? pageOf([slot('3')]) : pageOf([]),
    );
    const r = await resolveOperator('addr', get as never);
    expect(r.matchedRole).toBe('payout');
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('returns matchedRole=null with no slots when all three are empty (empty != error)', async () => {
    const get = vi.fn(async () => pageOf([]));
    const r = await resolveOperator('addr', get as never);
    expect(r).toEqual({ matchedRole: null, slots: [] });
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('propagates an ApiError (does not swallow it as a no-match)', async () => {
    const get = vi.fn(async () => {
      throw new ApiError('network_unavailable', 'down', 0);
    });
    await expect(resolveOperator('addr', get as never)).rejects.toBeInstanceOf(ApiError);
  });
});
