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
import { AccountDetail } from './AccountDetail';

const ACCOUNT = { data: { address: 'twilight1abc', accountKind: 'base', firstSeenHeight: '1', lastSeenHeight: '10', txCount: 3 } };
const STATUS = {
  data: {
    chainId: 'c',
    indexer: { lastIndexedHeight: '3196', latestChainHeight: '3196', lagBlocks: '0', status: 'idle', lastIndexedHash: 'h', updatedAt: '', freshnessSeconds: 1, error: null },
    projections: [],
    projectionFailures: { unresolvedCount: 0, byProjection: [] },
  },
};
const BAL_SAMPLED = { data: { address: 'twilight1abc', sampled: true, sampledAtHeight: '3196', source: 'sampled', balances: [{ denom: 'utwlt', amount: '1000000' }] } };
const BAL_UNSAMPLED = { data: { address: 'twilight1abc', sampled: false, sampledAtHeight: null, source: 'sampled', balances: [] } };

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function mockAccount(balances: unknown) {
  apiGetPath.mockImplementation(async (path: string) => {
    if (path === '/api/v1/accounts/{address}') return ACCOUNT;
    if (path === '/api/v1/accounts/{address}/balances') return balances;
    throw new Error(`unexpected ${path}`);
  });
  apiGet.mockImplementation(async (path: string) => {
    if (path === '/api/v1/status') return STATUS;
    throw new Error(`unexpected ${path}`);
  });
}

afterEach(() => {
  apiGet.mockReset();
  apiGetPath.mockReset();
});

describe('AccountDetail', () => {
  it('renders identity + sampled balances (TWLT display + raw utwlt), and no tx-history section', async () => {
    mockAccount(BAL_SAMPLED);
    renderWithClient(<AccountDetail address="twilight1abc" />);
    expect(await screen.findByText('1 TWLT')).toBeInTheDocument();
    expect(screen.getByText('1000000 utwlt')).toBeInTheDocument();
    // No account transaction history (Phase 9 API has no address/signer tx filter).
    expect(screen.queryByText(/transactions in this block/i)).not.toBeInTheDocument();
    expect(apiGet.mock.calls.every((c) => c[0] === '/api/v1/status')).toBe(true);
    // 12c cross-link: the ONLY contract-safe account cross-link is /supply (sampled <-> sampled).
    expect(screen.getByRole('link', { name: /network supply/i })).toHaveAttribute('href', '/supply');
    // An account is not provably a claimant -> NO invented ?claimant= rewards relation.
    expect(screen.queryByRole('link', { name: /claim/i })).toBeNull();
  });

  it('sampled:false renders "no sample" — never 0', async () => {
    mockAccount(BAL_UNSAMPLED);
    renderWithClient(<AccountDetail address="twilight1abc" />);
    expect(await screen.findByText('no sample')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('not_found -> NotFound state', async () => {
    apiGetPath.mockImplementation(async () => {
      throw new ApiError('not_found', 'no such account', 404);
    });
    renderWithClient(<AccountDetail address="nope" />);
    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
  });
});
