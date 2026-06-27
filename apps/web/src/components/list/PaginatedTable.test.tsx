import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaginatedTable } from './PaginatedTable';

type Row = { id: string };
const columns = [{ header: 'ID', cell: (r: Row) => r.id }];

function makeQuery(overrides: Record<string, unknown> = {}) {
  return {
    data: { pages: [{ data: [{ id: 'a' }, { id: 'b' }], page: { limit: 25, nextCursor: 'c1' } }] },
    isPending: false,
    isError: false,
    error: null,
    hasNextPage: true,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe('PaginatedTable', () => {
  it('renders flattened rows and a working Load more', () => {
    const fetchNextPage = vi.fn();
    render(
      <PaginatedTable query={makeQuery({ fetchNextPage })} columns={columns} rowKey={(r) => r.id} />,
    );
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('stops paging when hasNextPage is false (no Load more)', () => {
    render(
      <PaginatedTable query={makeQuery({ hasNextPage: false })} columns={columns} rowKey={(r) => r.id} />,
    );
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });

  it('flattens rows across multiple pages', () => {
    const query = makeQuery({
      hasNextPage: false,
      data: {
        pages: [
          { data: [{ id: 'a' }], page: { limit: 25, nextCursor: 'c' } },
          { data: [{ id: 'b' }], page: { limit: 25, nextCursor: null } },
        ],
      },
    });
    render(<PaginatedTable query={query} columns={columns} rowKey={(r) => r.id} />);
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
  });

  it('shows the empty state when there are no rows', () => {
    const query = makeQuery({
      hasNextPage: false,
      data: { pages: [{ data: [], page: { limit: 25, nextCursor: null } }] },
    });
    render(
      <PaginatedTable query={query} columns={columns} rowKey={(r) => r.id} emptyMessage="nothing here" />,
    );
    expect(screen.getByText('nothing here')).toBeInTheDocument();
  });
});
