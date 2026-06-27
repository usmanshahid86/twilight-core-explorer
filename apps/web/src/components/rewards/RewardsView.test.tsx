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
import { RewardsView } from './RewardsView';

const page = <T,>(data: T[]) => ({ data, page: { limit: 25, nextCursor: null } });

const FIXTURES: Record<string, unknown> = {
  '/api/v1/rewards/epochs': page([
    {
      epochNumber: '5',
      height: '50',
      blockTime: null,
      totalReward: '4161900',
      denom: 'utwlt',
      activeSlotCount: 4,
      cumulativeEmitted: '20809500',
      distributionMethod: 'DISTRIBUTION_METHOD_UNIFORM_ACTIVE_BLOCKS',
      rewardSemantics: 'aggregate_projection',
    },
  ]),
  '/api/v1/rewards/claims': page([
    {
      id: '1',
      slotId: '1',
      claimant: 'twilight1claimantxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      payoutAddress: null,
      startEpoch: '1',
      endEpoch: '1',
      amount: '1040475',
      denom: 'utwlt',
      height: '11',
      txHash: 'ABCDEF1234567890ABCDEF',
      msgIndex: 0,
      productionClaimReadiness: 'read_only_no_claim_action',
      claimSemantics: 'event_history_only',
    },
  ]),
  '/api/v1/rewards/balances': page([
    {
      id: '1',
      sampleKind: 'module_balance',
      source: 'sampled',
      height: '50',
      address: null,
      moduleName: 'fee_pool',
      denom: 'utwlt',
      amount: '0',
    },
  ]),
  '/api/v1/rewards/treasury-payments': page([
    { id: '1', height: '10', recipient: 'twilight1treasuryxxxxxxxx', denom: 'utwlt', amount: '100', purpose: 'community-grant' },
  ]),
  '/api/v1/rewards/params': page([
    { id: '1', height: '5', txHash: 'PARAMTX', msgIndex: 0, authority: 'twilight1authxxxxxxxx', changeType: 'activated', params: { epochLength: '10' } },
  ]),
};

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => apiGet.mockReset());

describe('RewardsView (/rewards hub)', () => {
  it('renders every section with its contract-sourced caveat, the promoted epoch fields, and a non-actionable Claiming card', async () => {
    apiGet.mockImplementation(async (path: string) => {
      const fx = FIXTURES[path];
      if (fx === undefined) throw new Error(`unexpected ${path}`);
      return fx;
    });
    const { container } = renderWithClient(<RewardsView />);

    // Epochs: promoted fields present (post-7.2), aggregate caveat visible.
    expect(await screen.findByText('DISTRIBUTION_METHOD_UNIFORM_ACTIVE_BLOCKS')).toBeInTheDocument();
    expect(screen.getByText('Cumulative emitted')).toBeInTheDocument();
    expect(screen.getByText('aggregate_projection')).toBeInTheDocument();
    // cumulativeEmitted value rendered (raw preserved in the title attr).
    expect(container.querySelector('[title="20809500 utwlt"]')).not.toBeNull();

    // rewardPool / carryOut are NOT first-class — never rendered.
    expect(screen.queryByText('Reward pool')).toBeNull();
    expect(screen.queryByText('Carry out')).toBeNull();
    expect(screen.queryByText(/rewardPool/)).toBeNull();
    expect(screen.queryByText(/carryOut/)).toBeNull();

    // Claims: read-only + history caveat (the post-7.2 readiness literal).
    expect(await screen.findByText('read_only_no_claim_action')).toBeInTheDocument();
    expect(screen.getByText('event_history_only')).toBeInTheDocument();

    // Balances (sampled): the source:"sampled" caveat value is rendered (the 4th locked caveat).
    expect(await screen.findByText('fee_pool')).toBeInTheDocument();
    expect(screen.getByText('sampled')).toBeInTheDocument();
    // Treasury + params sections rendered.
    expect(await screen.findByText('community-grant')).toBeInTheDocument();
    expect(await screen.findByText('activated')).toBeInTheDocument();

    // Non-actionable Claiming card.
    expect(
      screen.getByText(
        'Claiming is not available from this explorer. This page displays observed rewards and historical claim events only. Operators claim externally using the Twilight CLI.',
      ),
    ).toBeInTheDocument();
  });

  it('shows each section empty message + no caveat when there are no rows (caveat is data-sourced)', async () => {
    apiGet.mockImplementation(async () => page([]));
    renderWithClient(<RewardsView />);

    expect(await screen.findByText('No finalized epochs yet.')).toBeInTheDocument();
    expect(await screen.findByText('No claim events recorded.')).toBeInTheDocument();
    expect(await screen.findByText('No balance samples recorded.')).toBeInTheDocument();
    // With zero rows there is no contract field to echo, so no per-section caveat renders.
    expect(screen.queryByText('aggregate_projection')).toBeNull();
    expect(screen.queryByText('read_only_no_claim_action')).toBeNull();
    expect(screen.queryByText('sampled')).toBeNull();
    // ...but the always-present non-actionable Claiming card still states the read-only posture.
    expect(
      screen.getByText(/Claiming is not available from this explorer/),
    ).toBeInTheDocument();
  });

  it('surfaces a section error via ErrorState (branches on error.code, not message)', async () => {
    apiGet.mockImplementation(async () => {
      throw new ApiError('network_unavailable', 'down', 0);
    });
    renderWithClient(<RewardsView />);
    expect((await screen.findAllByText(/API unavailable/i)).length).toBeGreaterThan(0);
  });
});
