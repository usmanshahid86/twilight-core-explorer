import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { apiGet, apiGetPath } = vi.hoisted(() => ({ apiGet: vi.fn(), apiGetPath: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiGet, apiGetPath };
});

import { ValidatorSetSection } from './ValidatorSetSection';
import { ProposerLeaderboard } from './ProposerLeaderboard';

const statusAt = (h: string | null) => ({
  data: { chainId: 'c', indexer: h === null ? null : { lastIndexedHeight: h, latestChainHeight: h, lagBlocks: '0', status: 'idle', lastIndexedHash: 'x', updatedAt: '', freshnessSeconds: 1, error: null }, projections: [], projectionFailures: { unresolvedCount: 0, byProjection: [] } },
});
const VSET = { data: [{ slotId: '2', consensusAddress: 'cons2', operatorAddress: 'op2', consensusPower: '10', effectiveFromHeight: '1', effectiveToHeight: null }] };
const PROPOSERS = { data: [{ slotId: '1', operatorAddress: 'op1', blocksProposed: 5 }, { slotId: '2', operatorAddress: 'op2', blocksProposed: 10 }] };
const slotDetail = (slotId: string) => ({ data: { slotId, operatorAddress: `op${slotId}`, metadata: { moniker: `val-${slotId}` } } });

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  apiGet.mockReset();
  apiGetPath.mockReset();
});

describe('ValidatorSetSection', () => {
  it('derives height from /status and loads the validator set at that height', async () => {
    apiGet.mockImplementation(async (path: string, query?: { height?: string }) => {
      if (path === '/api/v1/status') return statusAt('3196');
      if (path === '/api/v1/network/validator-set') {
        expect(query?.height).toBe('3196');
        return VSET;
      }
      throw new Error(`unexpected ${path}`);
    });
    apiGetPath.mockImplementation(async (_p: string, params: { slotId: string }) => slotDetail(params.slotId));
    renderWithClient(<ValidatorSetSection />);
    expect(await screen.findByText(/Validator set at height 3,196/)).toBeInTheDocument();
    // operator name enriched via the directory (non-blocking):
    expect(await screen.findByText('val-2')).toBeInTheDocument();
  });

  it('renders unavailable and never calls validator-set when height is missing', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/api/v1/status') return statusAt(null);
      if (path === '/api/v1/network/validator-set') throw new Error('must not be called without height');
      throw new Error(`unexpected ${path}`);
    });
    renderWithClient(<ValidatorSetSection />);
    expect(await screen.findByText(/Latest height unavailable/i)).toBeInTheDocument();
    expect(apiGet.mock.calls.some((c) => c[0] === '/api/v1/network/validator-set')).toBe(false);
  });
});

describe('ProposerLeaderboard', () => {
  it('sorts by blocksProposed desc and links operators', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/api/v1/network/proposers') return PROPOSERS;
      throw new Error(`unexpected ${path}`);
    });
    apiGetPath.mockImplementation(async (_p: string, params: { slotId: string }) => slotDetail(params.slotId));
    renderWithClient(<ProposerLeaderboard />);
    const rows = await screen.findAllByRole('row');
    // rows[0] is the header; the first data row is the top proposer (slot 2, 10 blocks).
    expect(within(rows[1] as HTMLElement).getByText('10')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('link', { name: 'val-2' })).toHaveAttribute('href', '/operator/op2'));
  });
});
