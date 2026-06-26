import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiGet };
});

import { CoreSlotHealthPanel } from './NetworkPanels';

const statusAt = (lastIndexedHeight: string | null) => ({
  data: {
    chainId: 'twilight-localnet-1',
    indexer:
      lastIndexedHeight === null
        ? null
        : {
            lastIndexedHeight,
            latestChainHeight: lastIndexedHeight,
            lagBlocks: '0',
            status: 'idle',
            lastIndexedHash: 'H',
            updatedAt: '',
            freshnessSeconds: 1,
            error: null,
          },
    projections: [],
    projectionFailures: { unresolvedCount: 0, byProjection: [] },
  },
});

const slot = (slotId: string, status: string, removedHeight: string | null) => ({
  slotId,
  status,
  operatorAddress: 'op',
  payoutAddress: null,
  consensusAddress: `C${slotId}`,
  consensusPower: '1',
  rewardWeight: null,
  createdHeight: '1',
  updatedHeight: '2',
  removedHeight,
});

// Registry: 1 active + 2 non-removed-but-not-active (pending/inactive) + 1 removed = 3 "not removed".
const SLOTS = {
  data: [
    slot('1', 'active', null),
    slot('2', 'pending', null),
    slot('3', 'inactive', null),
    slot('4', 'removed', '5'),
  ],
};
// The ACTIVE validator set at the latest height has exactly 1 member.
const VSET = { data: [{ slotId: '1', consensusAddress: 'C1', operatorAddress: 'op', consensusPower: '1', effectiveFromHeight: '1', effectiveToHeight: null }] };
const PROPOSERS = { data: [{ slotId: '1', operatorAddress: 'op', blocksProposed: 10 }, { slotId: '2', operatorAddress: 'op2', blocksProposed: 3 }] };

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => apiGet.mockReset());

describe('CoreSlotHealthPanel active count (Codex blocker 2)', () => {
  it('reports the active validator set (not the non-removed registry count) and relabels the registry', async () => {
    apiGet.mockImplementation(async (path: string, query?: { height?: string }) => {
      switch (path) {
        case '/api/v1/status':
          return statusAt('3196');
        case '/api/v1/coreslots':
          return SLOTS;
        case '/api/v1/network/proposers':
          return PROPOSERS;
        case '/api/v1/network/validator-set':
          expect(query).toEqual({ height: '3196' });
          return VSET;
        default:
          throw new Error(`unexpected path ${path}`);
      }
    });

    renderWithClient(<CoreSlotHealthPanel />);

    expect(await screen.findByText('Active validator set')).toBeInTheDocument();
    expect(screen.getByText('Registered CoreSlots')).toBeInTheDocument();
    // Active = 1 (validator set), Registered = 4. The "not removed" count (3) must NOT be shown.
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.queryByText('3')).not.toBeInTheDocument();
  });

  it('shows an explicit unavailable state and never calls validator-set when latest height is missing', async () => {
    apiGet.mockImplementation(async (path: string) => {
      switch (path) {
        case '/api/v1/status':
          return statusAt(null); // indexer null -> no derivable height
        case '/api/v1/coreslots':
          return SLOTS;
        case '/api/v1/network/proposers':
          return PROPOSERS;
        case '/api/v1/network/validator-set':
          throw new Error('validator-set must not be called without a height');
        default:
          throw new Error(`unexpected path ${path}`);
      }
    });

    renderWithClient(<CoreSlotHealthPanel />);

    expect(await screen.findByText('Registered CoreSlots')).toBeInTheDocument();
    expect(screen.getByText(/awaiting height|unavailable/i)).toBeInTheDocument();
    const calledValidatorSet = apiGet.mock.calls.some((c) => c[0] === '/api/v1/network/validator-set');
    expect(calledValidatorSet).toBe(false);
  });
});
