import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn(async () => ({ data: [] })) }));

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiGet };
});

import { useValidatorSet } from './queries';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => apiGet.mockClear());

describe('useValidatorSet requires a height (Codex blocker 1)', () => {
  it('is disabled and issues no request when height is undefined', () => {
    const { result } = renderHook(() => useValidatorSet(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.isPending).toBe(true);
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('calls validator-set WITH the required height query when present', async () => {
    renderHook(() => useValidatorSet('3196'), { wrapper });
    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith('/api/v1/network/validator-set', { height: '3196' }),
    );
  });
});
