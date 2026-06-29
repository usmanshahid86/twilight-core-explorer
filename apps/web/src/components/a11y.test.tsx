import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations } from '@/test/axe';

// next/navigation is used by Header (active link), StatusFilter, etc. One mock covers them all.
vi.mock('next/navigation', () => ({
  usePathname: () => '/blocks',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

import { Badge } from './ui/Badge';
import { Card, CardBody } from './ui/Card';
import { StatCard } from './ui/StatCard';
import { Table, Td, Th, Tr } from './ui/Table';
import { CopyButton } from './ui/CopyButton';
import { MonoCopy } from './ui/MonoCopy';
import { EmptyState, InvalidInput } from './states/States';
import { Footer } from './Footer';
import { Header } from './Header';
import { OperatorLink } from './operator/OperatorLink';
import { PaginatedTable } from './list/PaginatedTable';
import { StatusFilter } from './list/StatusFilter';
import { TX_STATUS_OPTIONS } from '@/lib/status-filters';

async function noViolations(ui: React.ReactElement) {
  const { container } = render(ui);
  expect(await axeViolations(container)).toEqual([]);
}

const tableQuery = {
  data: { pages: [{ data: [{ id: 'a' }, { id: 'b' }], page: { limit: 25, nextCursor: null } }] },
  isPending: false,
  isError: false,
  error: null,
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
};

describe('a11y — axe structural net (no color-contrast/region; jsdom)', () => {
  it('ui primitives have no structural violations', async () => {
    await noViolations(<Badge tone="success">Active</Badge>);
    await noViolations(<Card><CardBody>body</CardBody></Card>);
    await noViolations(<StatCard label="Block height" value="2500" />);
    await noViolations(<CopyButton value="twilight1abc" />);
    await noViolations(<MonoCopy value="twilight1abcdefghijklmnop" />);
  });

  it('a named Table + the empty/invalid states are clean', async () => {
    await noViolations(
      <Table caption="Blocks" head={<Th>Height</Th>}>
        <Tr><Td>1</Td></Tr>
      </Table>,
    );
    await noViolations(<EmptyState />);
    await noViolations(<InvalidInput />);
  });

  it('Header nav, Footer, and OperatorLink are clean', async () => {
    await noViolations(<Header />);
    await noViolations(<Footer />);
    await noViolations(<OperatorLink operatorAddress="twilight1abc" name="core5" />);
  });

  it('StatusFilter is a labelled, operable select', async () => {
    await noViolations(
      <StatusFilter label="Status" paramName="status" value="" options={TX_STATUS_OPTIONS} />,
    );
  });

  it('PaginatedTable threads a caption so the table has an accessible name', async () => {
    const columns = [{ header: 'ID', cell: (r: { id: string }) => r.id }];
    const { container, getByRole } = render(
      <PaginatedTable query={tableQuery} columns={columns} rowKey={(r) => r.id} caption="Recent blocks" />,
    );
    // a <caption> is the table's accessible name (sr-only is fine).
    expect(getByRole('table', { name: 'Recent blocks' })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});
