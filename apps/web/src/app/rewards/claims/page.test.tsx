import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiGet };
});

import RewardsClaimsPage from './page';

const emptyPage = { data: [], page: { limit: 25, nextCursor: null } };

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function claimsCall() {
  return apiGet.mock.calls.find((c) => c[0] === '/api/v1/rewards/claims');
}

afterEach(() => apiGet.mockReset());

describe('RewardsClaimsPage (/rewards/claims — cross-link target)', () => {
  it('passes the slotId searchParam into the claims filter', async () => {
    apiGet.mockResolvedValue(emptyPage);
    renderWithClient(RewardsClaimsPage({ searchParams: { slotId: '7' } }));

    expect(await screen.findByText('Claim history')).toBeInTheDocument();
    expect(screen.getByText(/for CoreSlot 7/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(claimsCall()?.[1]).toEqual(expect.objectContaining({ slotId: '7' })),
    );
  });

  it('coerces a string[] searchParam to a single value', async () => {
    apiGet.mockResolvedValue(emptyPage);
    renderWithClient(RewardsClaimsPage({ searchParams: { slotId: ['3', '9'] } }));
    await waitFor(() => expect(claimsCall()?.[1]).toEqual(expect.objectContaining({ slotId: '3' })));
  });

  it('renders unfiltered when no slotId is provided', async () => {
    apiGet.mockResolvedValue(emptyPage);
    renderWithClient(RewardsClaimsPage({ searchParams: {} }));
    expect(await screen.findByText('Claim history')).toBeInTheDocument();
    await waitFor(() => expect(claimsCall()).toBeDefined());
    expect(claimsCall()?.[1]?.slotId).toBeUndefined();
  });
});
