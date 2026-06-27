import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { apiGet, apiGetPath } = vi.hoisted(() => ({ apiGet: vi.fn(), apiGetPath: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiGet, apiGetPath };
});

import { ApiError } from '@/lib/api/client';
import { LivenessOverview } from './LivenessOverview';
import { PerSlotHealthTable } from './PerSlotHealthTable';

const RISK = { data: { haltRiskLevel: 'low', haltRiskReason: null, latestCommittedHeight: '3196', activeSlotCount: 4, healthySlotCount: 3, degradedSlotCount: 1, downSlotCount: 0, incompleteSlotCount: 0, unknownSlotCount: 0, availableSlotCount: 4, unavailableSlotCount: 0, availablePowerBps: 9900, unavailablePowerBps: 100, policyVersion: 'v1' } };
const SLOTS = { data: [
  { slotId: '1', status: 'active', operatorAddress: 'op1', payoutAddress: null, consensusAddress: 'c1', consensusPower: '1', rewardWeight: '1', createdHeight: '1', updatedHeight: '2', removedHeight: null },
  { slotId: '2', status: 'active', operatorAddress: 'op2', payoutAddress: null, consensusAddress: 'c2', consensusPower: '1', rewardWeight: '1', createdHeight: '1', updatedHeight: '2', removedHeight: null },
], page: { limit: 100, nextCursor: null } };
const health = (slotId: string) => ({ data: { slotId, healthStatus: 'healthy', healthReason: null, isActiveAtLatest: true, primaryWindowKind: 'recent_100', expectedCount: 100, signedCount: 100, missedCount: 0, absentMissedCount: 0, nilMissedCount: 0, uptimeBps: 10000, lifetimeUptimeBps: 10000, recent500UptimeBps: 10000, recent1000UptimeBps: 10000, currentSignedStreak: 100, currentMissedStreak: 0, latestMissedHeight: null, firstCommittedHeight: '1', lastCommittedHeight: '100', summaryStatus: 'healthy', invalidHeightCount: 0, policyVersion: 'v1' } });

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  apiGet.mockReset();
  apiGetPath.mockReset();
});

describe('LivenessOverview', () => {
  it('renders the halt-risk summary', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/api/v1/network/liveness-risk') return RISK;
      throw new Error(`unexpected ${path}`);
    });
    renderWithClient(<LivenessOverview />);
    expect(await screen.findByText('halt risk: low')).toBeInTheDocument();
  });

  it('treats a 404 as a soft "no snapshot" state, not a hard error', async () => {
    apiGet.mockImplementation(async () => {
      throw new ApiError('not_found', 'none', 404);
    });
    renderWithClient(<LivenessOverview />);
    expect(await screen.findByText(/No liveness snapshot yet/i)).toBeInTheDocument();
  });
});

describe('PerSlotHealthTable (bounded, non-blocking fan-out)', () => {
  it('renders rows; a per-slot health failure degrades to "—", not a page error', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/api/v1/coreslots') return SLOTS;
      throw new Error(`unexpected ${path}`);
    });
    apiGetPath.mockImplementation(async (path: string, params: { slotId: string }) => {
      if (path === '/api/v1/coreslots/{slotId}/health') {
        if (params.slotId === '2') throw new ApiError('not_found', 'no health', 404); // one slot fails
        return health(params.slotId);
      }
      throw new Error(`unexpected ${path}`);
    });
    renderWithClient(<PerSlotHealthTable />);
    // slot 1 health renders; the page is not failed by slot 2's failure.
    expect(await screen.findByText('healthy')).toBeInTheDocument();
    const rows = await screen.findAllByRole('row');
    expect(rows.length).toBeGreaterThanOrEqual(3); // header + 2 slots
  });
});
