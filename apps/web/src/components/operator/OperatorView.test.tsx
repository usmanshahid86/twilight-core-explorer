import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { useOperatorResolution, useCoreSlot } = vi.hoisted(() => ({
  useOperatorResolution: vi.fn(),
  useCoreSlot: vi.fn(),
}));
vi.mock('@/lib/api/queries', () => ({ useOperatorResolution, useCoreSlot }));
vi.mock('@/components/coreslots/CoreSlotDetail', () => ({
  CoreSlotDetail: ({ slotId }: { slotId: string }) => <div data-testid="coreslot-detail">slot:{slotId}</div>,
}));

import { OperatorView } from './OperatorView';

const slot = (slotId: string) => ({
  slotId,
  status: 'active',
  operatorAddress: 'twilight1op',
  payoutAddress: null,
  consensusAddress: 'cons',
  consensusPower: '1',
  rewardWeight: '1',
  createdHeight: '1',
  updatedHeight: '2',
  removedHeight: null,
});

function resolution(value: unknown) {
  useOperatorResolution.mockReturnValue(value);
  useCoreSlot.mockReturnValue({ data: { data: { metadata: { moniker: 'core5' }, operatorAddress: 'twilight1op' } } });
}

afterEach(() => vi.clearAllMocks());

describe('OperatorView', () => {
  it('single match: role badge + display name + reuses CoreSlotDetail', () => {
    resolution({ isPending: false, isError: false, data: { matchedRole: 'operator', slots: [slot('2')] } });
    render(<OperatorView address="twilight1op" />);
    expect(screen.getByText('matched by operator address')).toBeInTheDocument();
    expect(screen.getByTestId('coreslot-detail')).toHaveTextContent('slot:2');
    // display name from metadata.moniker leads the page:
    expect(screen.getAllByText('core5').length).toBeGreaterThan(0);
    // 12c cross-link: operator identity card links to the rewards hub.
    expect(screen.getByRole('link', { name: /view rewards/i })).toHaveAttribute('href', '/rewards');
  });

  it('consensus fallback shows "matched by consensus address"', () => {
    resolution({ isPending: false, isError: false, data: { matchedRole: 'consensus', slots: [slot('3')] } });
    render(<OperatorView address="cons" />);
    expect(screen.getByText('matched by consensus address')).toBeInTheDocument();
  });

  it('zero match: non-error empty state', () => {
    resolution({ isPending: false, isError: false, data: { matchedRole: null, slots: [] } });
    render(<OperatorView address="nobody" />);
    expect(screen.getByText(/No CoreSlot found for this address/i)).toBeInTheDocument();
    expect(screen.queryByTestId('coreslot-detail')).not.toBeInTheDocument();
  });

  it('multiple matches: surfaces the anomaly note and renders the first slot', () => {
    resolution({ isPending: false, isError: false, data: { matchedRole: 'operator', slots: [slot('2'), slot('9')] } });
    render(<OperatorView address="twilight1op" />);
    expect(screen.getByText(/Multiple CoreSlots matched/i)).toBeInTheDocument();
    expect(screen.getByTestId('coreslot-detail')).toHaveTextContent('slot:2');
  });
});
