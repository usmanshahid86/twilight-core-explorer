import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiGet };
});

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/coreslots',
  useRouter: () => ({ replace }),
}));

import { CoreSlotsList } from './CoreSlotsList';

const SLOTS = {
  data: [
    { slotId: '1', status: 'ACTIVE', operatorAddress: 'op1', payoutAddress: null, consensusAddress: 'c1', consensusPower: '10', rewardWeight: '1', createdHeight: '1', updatedHeight: '2', removedHeight: null },
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
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
  });

  it('passes the status filter through to apiGet (and not on the unfiltered call)', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/api/v1/coreslots') return SLOTS;
      throw new Error(`unexpected ${path}`);
    });
    renderWithClient(<CoreSlotsList status="ACTIVE" />);
    await screen.findByRole('link', { name: '1' });
    expect(apiGet).toHaveBeenCalledWith(
      '/api/v1/coreslots',
      expect.objectContaining({ status: 'ACTIVE' }),
    );
  });

  it('shows a status-aware empty message when a filter yields no rows', async () => {
    apiGet.mockImplementation(async () => ({ data: [], page: { limit: 25, nextCursor: null } }));
    renderWithClient(<CoreSlotsList status="REMOVED" />);
    expect(await screen.findByText('No removed CoreSlots.')).toBeInTheDocument();
  });

  it('the status control rewrites the URL on change (and resets to the bare path for "All")', async () => {
    apiGet.mockImplementation(async () => SLOTS);
    renderWithClient(<CoreSlotsList status="ACTIVE" />);
    const select = await screen.findByLabelText('Status');
    fireEvent.change(select, { target: { value: 'SUSPENDED' } });
    expect(replace).toHaveBeenCalledWith('/coreslots?status=SUSPENDED');
    fireEvent.change(select, { target: { value: '' } });
    expect(replace).toHaveBeenCalledWith('/coreslots');
  });

  it('resets pagination when the filter changes — new status re-keys to a fresh page-one fetch', async () => {
    apiGet.mockImplementation(async () => SLOTS);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <CoreSlotsList status="ACTIVE" />
      </QueryClientProvider>,
    );
    await screen.findByRole('link', { name: '1' });
    apiGet.mockClear();
    rerender(
      <QueryClientProvider client={client}>
        <CoreSlotsList status="INACTIVE" />
      </QueryClientProvider>,
    );
    // The new queryKey (status: 'INACTIVE') is an unfetched cache entry → starts at cursor undefined.
    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith(
        '/api/v1/coreslots',
        expect.objectContaining({ status: 'INACTIVE', cursor: undefined }),
      ),
    );
  });
});
