import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NoSampleLabel, SampleAgeLabel, SampledAtNote } from './Freshness';

describe('sampled-data rendering honesty', () => {
  it('renders "no sample" — never 0 — when no sample exists', () => {
    render(<SampledAtNote sampledAtHeight={null} age={{ kind: 'none' }} />);
    expect(screen.getByText('no sample')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('SampleAgeLabel with kind=none falls back to no-sample', () => {
    render(<SampleAgeLabel age={{ kind: 'none' }} />);
    expect(screen.getByText('no sample')).toBeInTheDocument();
  });

  it('NoSampleLabel is explicit', () => {
    render(<NoSampleLabel />);
    expect(screen.getByText('no sample')).toBeInTheDocument();
  });

  it('shows sampled-at height and an age badge when a sample is present', () => {
    render(<SampledAtNote sampledAtHeight="100" age={{ kind: 'old', deltaBlocks: '60' }} />);
    expect(screen.getByText(/sampled at height/i)).toBeInTheDocument();
    expect(screen.getByText(/60 blocks behind/i)).toBeInTheDocument();
  });
});
