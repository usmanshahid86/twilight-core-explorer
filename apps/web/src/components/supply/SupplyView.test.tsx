import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiGet };
});

import { ApiError } from '@/lib/api/client';
import { SupplyView } from './SupplyView';

const status = (lastIndexedHeight: string | null) => ({ data: { indexer: { lastIndexedHeight } } });

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => apiGet.mockReset());

describe('SupplyView (/supply)', () => {
  it('renders the sampled denom->amount table (multi-denom) + source caveat + freshness; raw preserved; no invented economics', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/api/v1/supply') {
        return {
          data: {
            sampledAtHeight: '50',
            source: 'sampled',
            supply: [
              { denom: 'utwlt', amount: '2000020809500' },
              { denom: 'ufoo', amount: '500' },
            ],
          },
        };
      }
      if (path === '/api/v1/status') return status('50');
      throw new Error(`unexpected ${path}`);
    });
    const { container } = renderWithClient(<SupplyView />);

    // Every denom row renders (the .map over supply).
    expect(await screen.findByText('utwlt')).toBeInTheDocument();
    expect(screen.getByText('ufoo')).toBeInTheDocument();
    // raw base-denom value preserved in the title (string-safe, no Number()).
    expect(container.querySelector('[title="2000020809500 utwlt"]')).not.toBeNull();
    expect(container.querySelector('[title="500 ufoo"]')).not.toBeNull();
    // source:"sampled" caveat + freshness (sample is current at the indexed height).
    expect(screen.getByText('sampled')).toBeInTheDocument();
    expect(screen.getByText(/sampled at height/i)).toBeInTheDocument();
    expect(screen.getByText('sample current')).toBeInTheDocument();

    // No invented economics: no circulating/bonded/cap/halving/emission labels.
    for (const banned of [/circulating/i, /bonded/i, /halving/i, /\bcap\b/i, /emission schedule/i, /inflation/i]) {
      expect(screen.queryByText(banned)).toBeNull();
    }
  });

  it('renders the NotFound surface (never 0/blank) when the chain has no supply sample (404)', async () => {
    // The real no-sample case is a 404 (the contract types sampledAtHeight as non-nullable and
    // returns 404 when there is no sample), surfaced via QueryBoundary -> ErrorState -> NotFound.
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/api/v1/supply') throw new ApiError('not_found', 'no supply sample', 404);
      if (path === '/api/v1/status') return status('50');
      throw new Error(`unexpected ${path}`);
    });
    renderWithClient(<SupplyView />);
    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
  });

  it('surfaces a chain-read error via ErrorState (error.code)', async () => {
    apiGet.mockImplementation(async () => {
      throw new ApiError('network_unavailable', 'down', 0);
    });
    renderWithClient(<SupplyView />);
    expect(await screen.findByText(/API unavailable/i)).toBeInTheDocument();
  });
});
