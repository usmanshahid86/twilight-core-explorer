import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Mock the API client so the panel renders against fixture data (no network).
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  const fixtures: Record<string, unknown> = {
    '/api/v1/status': {
      data: {
        chainId: 'twilight-localnet-1',
        indexer: {
          lastIndexedHeight: '3196',
          latestChainHeight: '3196',
          lagBlocks: '0',
          status: 'synced',
          lastIndexedHash: 'HASH',
          updatedAt: '1970-01-01T00:00:00.000Z',
          freshnessSeconds: 2,
          error: null,
        },
        projections: [],
        projectionFailures: { unresolvedCount: 0, byProjection: [] },
      },
    },
  };
  return {
    ...actual,
    apiGet: vi.fn(async (path: string) => fixtures[path]),
  };
});

import { ChainStatusPanel } from './StatusPanels';

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('Overview renders mock API data', () => {
  it('shows chain id and formatted indexed height', async () => {
    renderWithClient(<ChainStatusPanel />);
    expect(await screen.findByText('twilight-localnet-1')).toBeInTheDocument();
    expect(screen.getAllByText('3,196').length).toBeGreaterThan(0);
  });
});
