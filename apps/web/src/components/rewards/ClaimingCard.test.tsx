import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ClaimingCard } from './ClaimingCard';

describe('ClaimingCard (non-actionable, Phase 12 §4)', () => {
  it('shows the locked read-only copy + the CLI command as documentation', () => {
    render(<ClaimingCard />);
    expect(
      screen.getByText(
        'Claiming is not available from this explorer. This page displays observed rewards and historical claim events only. Operators claim externally using the Twilight CLI.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/twilightd rewards claim <slotId> <startEpoch> <endEpoch> --from <operator>/),
    ).toBeInTheDocument();
  });

  it('is strictly non-actionable: no button, no link, no wallet prompt, no "claim now"', () => {
    render(<ClaimingCard />);
    // No interactive controls of any kind in the card.
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    // No claim-action affordances or language.
    expect(screen.queryByRole('button', { name: /claim/i })).toBeNull();
    expect(screen.queryByText(/claim now/i)).toBeNull();
    expect(screen.queryByText(/connect wallet/i)).toBeNull();
  });
});
