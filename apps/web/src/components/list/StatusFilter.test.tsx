import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/txs',
  useRouter: () => ({ replace }),
}));

import { StatusFilter } from './StatusFilter';
import { TX_STATUS_OPTIONS } from '@/lib/status-filters';

afterEach(() => replace.mockReset());

describe('StatusFilter', () => {
  it('renders a labelled select with "All" + each option', () => {
    render(<StatusFilter label="Status" paramName="status" value="" options={TX_STATUS_OPTIONS} />);
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Success' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Failed' })).toBeInTheDocument();
  });

  it('rewrites the URL with ?status= on selection (router.replace, not push)', () => {
    render(<StatusFilter label="Status" paramName="status" value="" options={TX_STATUS_OPTIONS} />);
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'failed' } });
    expect(replace).toHaveBeenCalledWith('/txs?status=failed');
  });

  it('drops the param (bare path) when "All" is selected', () => {
    render(
      <StatusFilter label="Status" paramName="status" value="failed" options={TX_STATUS_OPTIONS} />,
    );
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: '' } });
    expect(replace).toHaveBeenCalledWith('/txs');
  });

  it('reflects the current value as the selected option', () => {
    render(
      <StatusFilter label="Status" paramName="status" value="success" options={TX_STATUS_OPTIONS} />,
    );
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('success');
  });
});
