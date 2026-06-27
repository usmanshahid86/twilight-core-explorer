import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiGet };
});

import { CoreSlotsList } from './CoreSlotsList';

const SLOTS = {
  data: [
    { slotId: '1', status: 'active', operatorAddress: 'op1', payoutAddress: null, consensusAddress: 'c1', consensusPower: '10', rewardWeight: '1', createdHeight: '1', updatedHeight: '2', removedHeight: null },
  ],
  page: { limit: 25, nextCursor: null },
};

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => apiGet.mockReset());

describe('CoreSlotsList', () => {
  it('renders the CoreSlot list with a slot link and status', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/api/v1/coreslots') return SLOTS;
      throw new Error(`unexpected ${path}`);
    });
    renderWithClient(<CoreSlotsList />);
    const link = await screen.findByRole('link', { name: '1' });
    expect(link).toHaveAttribute('href', '/coreslots/1');
    expect(screen.getByText('active')).toBeInTheDocument();
  });
});
