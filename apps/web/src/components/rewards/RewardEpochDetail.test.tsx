import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { apiGet, apiGetPath } = vi.hoisted(() => ({ apiGet: vi.fn(), apiGetPath: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiGet, apiGetPath };
});

import { ApiError } from '@/lib/api/client';
import { RewardEpochDetail } from './RewardEpochDetail';

const EPOCH = {
  epochNumber: '5',
  height: '50',
  blockTime: null,
  totalReward: '4161900',
  denom: 'utwlt',
  activeSlotCount: 4,
  cumulativeEmitted: '20809500',
  distributionMethod: 'DISTRIBUTION_METHOD_UNIFORM_ACTIVE_BLOCKS',
  rewardSemantics: 'aggregate_projection',
};

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  apiGet.mockReset();
  apiGetPath.mockReset();
});

describe('RewardEpochDetail', () => {
  it('renders all epoch fields + the aggregate caveat on success', async () => {
    apiGetPath.mockImplementation(async (_path: string, _params: unknown, query?: { include?: string }) => {
      if (query?.include === 'raw') return { data: { ...EPOCH, raw: { ok: 1 } } };
      return { data: EPOCH };
    });
    renderWithClient(<RewardEpochDetail epoch="5" />);

    expect(await screen.findByText('Epoch 5')).toBeInTheDocument();
    expect(screen.getByText('Cumulative emitted')).toBeInTheDocument();
    expect(screen.getByText('DISTRIBUTION_METHOD_UNIFORM_ACTIVE_BLOCKS')).toBeInTheDocument();
    expect(screen.getByText('aggregate_projection')).toBeInTheDocument();
    // rewardPool / carryOut never shown.
    expect(screen.queryByText(/rewardPool/)).toBeNull();
    expect(screen.queryByText(/carryOut/)).toBeNull();
  });

  it('rejects a non-integer epoch with InvalidInput and issues no request', () => {
    renderWithClient(<RewardEpochDetail epoch="abc" />);
    expect(screen.getByText(/positive integer/i)).toBeInTheDocument();
    expect(apiGetPath).not.toHaveBeenCalled();
  });

  it('rejects a leading-zero / zero epoch (string-safe, no Number())', () => {
    renderWithClient(<RewardEpochDetail epoch="0" />);
    expect(screen.getByText(/positive integer/i)).toBeInTheDocument();
    expect(apiGetPath).not.toHaveBeenCalled();
  });

  it('maps not_found to the NotFound state', async () => {
    apiGetPath.mockImplementation(async () => {
      throw new ApiError('not_found', 'no such epoch', 404);
    });
    renderWithClient(<RewardEpochDetail epoch="999" />);
    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
  });

  it('fetches include=raw only after the raw panel is expanded', async () => {
    apiGetPath.mockImplementation(async (_path: string, _params: unknown, query?: { include?: string }) => {
      if (query?.include === 'raw') return { data: { ...EPOCH, raw: { ok: 1 } } };
      return { data: EPOCH };
    });
    renderWithClient(<RewardEpochDetail epoch="5" />);
    await screen.findByText('Epoch 5');
    const rawCalled = () =>
      apiGetPath.mock.calls.some((c) => (c[2] as { include?: string } | undefined)?.include === 'raw');
    expect(rawCalled()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /raw/i }));
    await waitFor(() => expect(rawCalled()).toBe(true));
  });
});
