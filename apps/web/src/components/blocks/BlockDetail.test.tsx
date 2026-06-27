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
import { BlockDetail } from './BlockDetail';

const BLOCK = {
  data: {
    height: '3196',
    hash: 'BLOCKHASH',
    time: '1970-01-01T00:00:00.000Z',
    txCount: 1,
    chainId: 'twilight-localnet-1',
    proposer: { rawAddress: 'R', address: 'A', slotId: '1', operatorAddress: 'op', attributionStatus: 'attributed' },
    appHash: 'APP',
    validatorsHash: 'V',
    nextValidatorsHash: 'NV',
    lastBlockHash: 'LB',
    createdAt: '',
  },
};
const TXS = {
  data: [
    { hash: 'TXHASH1', height: '3196', index: 0, status: 'ok', code: 0, gasUsed: null, gasWanted: null, memo: null, messageTypes: ['/x.Msg'], signerAddresses: [] },
  ],
  page: { limit: 25, nextCursor: null },
};

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  apiGet.mockReset();
  apiGetPath.mockReset();
});

describe('BlockDetail', () => {
  it('renders detail + the block transactions (via /txs?height)', async () => {
    apiGetPath.mockImplementation(async (path: string) => {
      if (path === '/api/v1/blocks/{height}') return BLOCK;
      throw new Error(`unexpected ${path}`);
    });
    apiGet.mockImplementation(async (path: string, query?: { height?: string }) => {
      if (path === '/api/v1/txs') {
        expect(query?.height).toBe('3196');
        return TXS;
      }
      throw new Error(`unexpected ${path}`);
    });
    renderWithClient(<BlockDetail height="3196" />);
    expect(await screen.findByText('Block 3,196')).toBeInTheDocument();
    expect(await screen.findByText(/TXHASH1/)).toBeInTheDocument();
  });

  it('malformed height -> invalid input, no API call', () => {
    renderWithClient(<BlockDetail height="abc" />);
    expect(screen.getByText(/must be a positive integer/i)).toBeInTheDocument();
    expect(apiGetPath).not.toHaveBeenCalled();
  });

  it('rejects "0" and leading-zero heights as invalid input (no API call)', () => {
    for (const bad of ['0', '007']) {
      const { unmount } = renderWithClient(<BlockDetail height={bad} />);
      expect(screen.getByText(/must be a positive integer/i)).toBeInTheDocument();
      unmount();
    }
    expect(apiGetPath).not.toHaveBeenCalled();
  });

  it('not_found -> NotFound state', async () => {
    apiGetPath.mockImplementation(async () => {
      throw new ApiError('not_found', 'no such block', 404);
    });
    renderWithClient(<BlockDetail height="999999" />);
    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
  });

  it('RawSection lazy-fetches include=raw only after expansion', async () => {
    apiGetPath.mockImplementation(async (_path: string, _params: unknown, query?: { include?: string }) =>
      query?.include === 'raw' ? { data: { ...BLOCK.data, raw: { ok: 1 } } } : BLOCK,
    );
    apiGet.mockResolvedValue(TXS);
    renderWithClient(<BlockDetail height="3196" />);
    await screen.findByText('Block 3,196');
    const rawCalled = () => apiGetPath.mock.calls.some((c) => (c[2] as { include?: string } | undefined)?.include === 'raw');
    expect(rawCalled()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /raw/i }));
    await waitFor(() => expect(rawCalled()).toBe(true));
  });
});
