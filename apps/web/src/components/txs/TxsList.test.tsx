import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiGet };
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/txs',
  useRouter: () => ({ replace: vi.fn() }),
}));

import { TxsList } from './TxsList';

const TXS = {
  data: [{ hash: 'abc123def456', height: '5', index: 0, status: 'failed', messageTypes: ['MsgSend'] }],
  page: { limit: 25, nextCursor: null },
};

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => apiGet.mockReset());

describe('TxsList', () => {
  it('passes the txs status filter through to apiGet', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/api/v1/txs') return TXS;
      throw new Error(`unexpected ${path}`);
    });
    renderWithClient(<TxsList status="failed" />);
    await screen.findByText('failed');
    expect(apiGet).toHaveBeenCalledWith(
      '/api/v1/txs',
      expect.objectContaining({ status: 'failed', cursor: undefined }),
    );
  });

  it('shows a status-aware empty message when a filter yields no rows', async () => {
    apiGet.mockImplementation(async () => ({ data: [], page: { limit: 25, nextCursor: null } }));
    renderWithClient(<TxsList status="failed" />);
    expect(await screen.findByText('No failed transactions.')).toBeInTheDocument();
  });
});
