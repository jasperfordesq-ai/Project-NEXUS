// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { Stars } from './Stars';

describe('Stars (read-only rating, warmth plan B7)', () => {
  it('is one picture for screen readers, named by the caller', () => {
    render(<Stars rating={4} label="Rated 4 out of 5" />);
    const stars = screen.getByRole('img', { name: 'Rated 4 out of 5' });
    expect(stars.querySelectorAll('[data-filled="true"]')).toHaveLength(4);
    expect(stars.querySelectorAll('[data-filled="false"]')).toHaveLength(1);
  });

  it('rounds to the nearest star and keeps the rating within range', () => {
    const { rerender } = render(<Stars rating={3.6} label="x" />);
    expect(screen.getByTestId('stars').querySelectorAll('[data-filled="true"]')).toHaveLength(4);
    rerender(<Stars rating={9} label="x" />);
    expect(screen.getByTestId('stars').querySelectorAll('[data-filled="true"]')).toHaveLength(5);
    rerender(<Stars rating={Number.NaN} label="x" />);
    expect(screen.getByTestId('stars').querySelectorAll('[data-filled="true"]')).toHaveLength(0);
  });

  it('has a general name when the caller gives none', () => {
    render(<Stars rating={2} />);
    expect(screen.getByTestId('stars')).toHaveAttribute('aria-label');
    expect(screen.getByTestId('stars').getAttribute('aria-label')).not.toBe('');
  });
});
