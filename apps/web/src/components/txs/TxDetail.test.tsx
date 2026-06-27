import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { apiGetPath } = vi.hoisted(() => ({ apiGetPath: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiGetPath };
});

import { ApiError } from '@/lib/api/client';
import { TxDetail } from './TxDetail';

const TX = {
  data: {
    hash: 'ABCDEF123456',
    height: '10',
    index: 0,
    status: 'ok',
    code: 0,
    gasUsed: '1',
    gasWanted: '2',
    memo: 'hello',
    messageTypes: ['/x.Msg'],
    signerAddresses: ['signer1'],
    time: '1970-01-01T00:00:00.000Z',
    fee: { amount: '5' },
    messages: [
      { msgIndex: 0, typeUrl: '/x.Msg', module: 'x', typeName: 'MsgDoThing', decodedJson: { a: 1 }, decodeError: null },
      { msgIndex: 1, typeUrl: '/y.Msg', module: null, typeName: null, decodedJson: null, decodeError: 'could not decode' },
    ],
    events: [{ phase: 'finalize', type: 'transfer', msgIndex: 0, eventIndex: 0, attributes: [{ key: 'amount' }] }],
  },
};

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => apiGetPath.mockReset());

describe('TxDetail', () => {
  it('renders messages, the decodeError, and events shape-agnostically', async () => {
    apiGetPath.mockImplementation(async (path: string) => {
      if (path === '/api/v1/txs/{hash}') return TX;
      throw new Error(`unexpected ${path}`);
    });
    renderWithClient(<TxDetail hash="ABCDEF123456" />);
    expect(await screen.findByText('MsgDoThing')).toBeInTheDocument();
    expect(screen.getByText('decode error')).toBeInTheDocument();
    expect(screen.getByText('could not decode')).toBeInTheDocument();
    expect(screen.getByText('transfer')).toBeInTheDocument();
  });

  it('not_found -> NotFound state', async () => {
    apiGetPath.mockImplementation(async () => {
      throw new ApiError('not_found', 'no such tx', 404);
    });
    renderWithClient(<TxDetail hash="zzz" />);
    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
  });
});
