import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OperatorLink } from './OperatorLink';

describe('OperatorLink', () => {
  it('renders the name linked to /operator/[address] when a name is provided', () => {
    render(<OperatorLink operatorAddress="twilight1abc" name="core5" />);
    const link = screen.getByRole('link', { name: 'core5' });
    expect(link).toHaveAttribute('href', '/operator/twilight1abc');
  });

  it('falls back to the shortened address (still linked) when there is no name', () => {
    render(<OperatorLink operatorAddress="twilight1abcdefghijklmnopqrstuv" />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/operator/twilight1abcdefghijklmnopqrstuv');
    expect(link.textContent).toContain('…');
  });

  it('renders an em dash for a null address', () => {
    render(<OperatorLink operatorAddress={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
