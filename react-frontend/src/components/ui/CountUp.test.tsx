// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CountUp } from './CountUp';

describe('CountUp', () => {
  it('gives screen readers the final number only, and hides the rolling digits', () => {
    const { container } = render(<CountUp value={1234} format={(n) => n.toLocaleString('en-GB')} />);
    const hidden = container.querySelector('[aria-hidden="true"]');
    expect(hidden?.textContent).toBe('1,234');
    expect(screen.getByText('1,234', { selector: '.sr-only' })).toBeInTheDocument();
  });

  it('keeps decimals for hours', () => {
    const { container } = render(<CountUp value={13.5} decimals={1} />);
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe('13.5');
  });
});
