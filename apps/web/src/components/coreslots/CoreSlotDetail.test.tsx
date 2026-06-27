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
import { CoreSlotDetail } from './CoreSlotDetail';

const page = <T,>(data: T[]) => ({ data, page: { limit: 25, nextCursor: null } });

const FIXTURES: Record<string, unknown> = {
  '/api/v1/coreslots/{slotId}': {
    data: {
      slotId: '2', status: 'active', operatorAddress: 'op', payoutAddress: 'pay', consensusAddress: 'cons',
      consensusPower: '10', rewardWeight: '1', createdHeight: '1', updatedHeight: '5', removedHeight: null,
      consensusPubkey: { type: 'ed25519' }, metadata: { moniker: 'node2' },
      health: { healthStatus: 'healthy', healthReason: null, isActiveAtLatest: true, uptimeBps: 9500, currentMissedStreak: 0, summaryStatus: 'healthy' },
    },
  },
  '/api/v1/coreslots/{slotId}/health': {
    data: {
      slotId: '2', healthStatus: 'healthy', healthReason: null, isActiveAtLatest: true, primaryWindowKind: 'recent_100',
      expectedCount: 100, signedCount: 95, missedCount: 5, absentMissedCount: 3, nilMissedCount: 2, uptimeBps: 9500,
      lifetimeUptimeBps: 9000, recent500UptimeBps: 9400, recent1000UptimeBps: 9300, currentSignedStreak: 10,
      currentMissedStreak: 0, latestMissedHeight: '90', firstCommittedHeight: '1', lastCommittedHeight: '100',
      summaryStatus: 'healthy', invalidHeightCount: 0, policyVersion: 'v1',
    },
  },
  '/api/v1/coreslots/{slotId}/liveness': {
    data: [
      { windowKind: 'recent_100', windowSize: 100, operatorAddress: 'op', consensusAddress: 'cons', firstCommittedHeight: '1', lastCommittedHeight: '100', spanHeightCount: '100', evidenceHeightCount: 100, expectedCount: 100, signedCount: 95, missedCount: 5, absentMissedCount: 3, nilMissedCount: 2, uptimeBps: 9500, currentSignedStreak: 10, currentMissedStreak: 0, latestMissedHeight: '90', invalidHeightCount: 0, summaryStatus: 'healthy' },
    ],
  },
  '/api/v1/coreslots/{slotId}/events': page([{ kind: 'lifecycle', height: '1', eventId: 'e1', txHash: 'TXEVT', msgIndex: 0, detail: { action: 'added' } }]),
  '/api/v1/coreslots/{slotId}/key-rotations': page([]),
  '/api/v1/coreslots/{slotId}/windows': page([{ id: 'w1', consensusAddress: 'cons', operatorAddress: 'op', consensusPower: '10', validatorUpdateHeight: '1', effectiveFromHeight: '3', effectiveToHeight: null, status: 'open', openedByKind: 'genesis', closedByKind: null }]),
  '/api/v1/coreslots/{slotId}/proposed-blocks': page([{ height: '50', time: '1970-01-01T00:00:00.000Z', proposerAddress: 'cons', attributionStatus: 'attributed' }]),
  '/api/v1/coreslots/{slotId}/rewards': page([{ epochNumber: '1', amount: '1000000', denom: 'utwlt', claimed: false, claimedAtHeight: null, claimTxHash: null, sampledAtHeight: '100', productionClaimReadiness: 'gated_by_phase_7_2', claimSemantics: 'projection_observed_not_live_claimable' }]),
};

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  apiGet.mockReset();
  apiGetPath.mockReset();
});

describe('CoreSlotDetail', () => {
  it('renders identity, health, liveness, proposed blocks, authority, and a CAVEATED rewards section', async () => {
    apiGetPath.mockImplementation(async (path: string, _params: unknown, query?: { include?: string }) => {
      if (query?.include === 'raw') return { data: { raw: { ok: 1 } } };
      const fx = FIXTURES[path];
      if (fx === undefined) throw new Error(`unexpected ${path}`);
      return fx;
    });
    renderWithClient(<CoreSlotDetail slotId="2" />);

    expect(await screen.findByText('CoreSlot 2')).toBeInTheDocument();
    expect(await screen.findByText('90.00%')).toBeInTheDocument(); // lifetime uptime (health section)
    expect(screen.getByText('lifecycle')).toBeInTheDocument(); // authority event kind
    expect(screen.getByText('50')).toBeInTheDocument(); // proposed block height
    // Rewards caveat sourced from contract fields, visible:
    expect(screen.getByText('gated_by_phase_7_2')).toBeInTheDocument();
    expect(screen.getByText('projection_observed_not_live_claimable')).toBeInTheDocument();
  });

  it('non-numeric slot id -> invalid input, no API call', () => {
    renderWithClient(<CoreSlotDetail slotId="abc" />);
    expect(screen.getByText(/numeric slot id/i)).toBeInTheDocument();
    expect(apiGetPath).not.toHaveBeenCalled();
  });

  it('not_found -> NotFound state', async () => {
    apiGetPath.mockImplementation(async () => {
      throw new ApiError('not_found', 'no such slot', 404);
    });
    renderWithClient(<CoreSlotDetail slotId="999" />);
    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
  });

  it('RawSection lazy-fetches include=raw only after expansion', async () => {
    apiGetPath.mockImplementation(async (path: string, _params: unknown, query?: { include?: string }) => {
      if (query?.include === 'raw') return { data: { raw: { ok: 1 } } };
      const fx = FIXTURES[path];
      if (fx === undefined) throw new Error(`unexpected ${path}`);
      return fx;
    });
    renderWithClient(<CoreSlotDetail slotId="2" />);
    await screen.findByText('CoreSlot 2');
    const rawCalled = () =>
      apiGetPath.mock.calls.some((c) => (c[2] as { include?: string } | undefined)?.include === 'raw');
    expect(rawCalled()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /raw/i }));
    await waitFor(() => expect(rawCalled()).toBe(true));
  });
});
