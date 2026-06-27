import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RewardAmount } from './RewardAmount';

describe('RewardAmount', () => {
  it('renders utwlt -> TWLT and preserves the raw base-denom value in the title', () => {
    const { container } = render(<RewardAmount raw="1040475" denom="utwlt" />);
    const span = container.querySelector('span');
    expect(span?.textContent).toBe('1.040475 TWLT');
    expect(span?.getAttribute('title')).toBe('1040475 utwlt');
  });

  it('renders a null/empty denom verbatim with NO trailing space in text or title', () => {
    for (const denom of [null, ''] as const) {
      const { container } = render(<RewardAmount raw="100" denom={denom} />);
      const span = container.querySelector('span');
      // No blank symbol -> no trailing space.
      expect(span?.textContent).toBe('100');
      // No empty rawDenom -> no trailing space in the title either.
      expect(span?.getAttribute('title')).toBe('100');
    }
  });

  it('renders the em-dash placeholder for a null/undefined amount', () => {
    expect(render(<RewardAmount raw={null} denom="utwlt" />).container.textContent).toBe('—');
    expect(render(<RewardAmount raw={undefined} denom="utwlt" />).container.textContent).toBe('—');
  });
});
