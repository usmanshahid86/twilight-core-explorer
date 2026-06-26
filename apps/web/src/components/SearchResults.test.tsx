import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const replace = vi.fn();
let currentQ = '2';
const searchState: { value: unknown } = { value: undefined };

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'q' ? currentQ : null) }),
  useRouter: () => ({ replace, push: vi.fn() }),
}));

vi.mock('@/lib/api/queries', () => ({
  useSearch: () => searchState.value,
}));

import { SearchResults } from './SearchResults';

afterEach(() => {
  replace.mockReset();
});

describe('SearchResults', () => {
  it('shows a typed picker on ambiguity (q=2 -> block + CoreSlot), no auto-nav', () => {
    currentQ = '2';
    searchState.value = {
      isPending: false,
      isError: false,
      data: {
        data: [
          { type: 'block', height: '2', hash: 'H' },
          { type: 'coreslot', slotId: '2' },
        ],
      },
    };
    render(<SearchResults />);
    expect(screen.getByText('Block')).toBeInTheDocument();
    expect(screen.getByText('CoreSlot')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('navigates directly on a single strong result', async () => {
    currentQ = 'abcdef';
    searchState.value = {
      isPending: false,
      isError: false,
      data: { data: [{ type: 'transaction', hash: 'abcdef', height: '5' }] },
    };
    render(<SearchResults />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/txs/abcdef'));
  });
});
