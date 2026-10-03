// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';

import { ExchangeDateRangeFilter } from './ExchangeDateRangeFilter';

describe('ExchangeDateRangeFilter', () => {
  it('labels the range and offers no Clear button while empty', () => {
    render(<ExchangeDateRangeFilter from={null} to={null} onChange={vi.fn()} />);
    expect(screen.getAllByText('Created between').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Clear dates' })).not.toBeInTheDocument();
  });

  it('shows the given range and clears both bounds at once', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ExchangeDateRangeFilter from="2026-01-05" to="2026-01-20" onChange={onChange} />);

    // The two date fields expose their segments; the year segment of each
    // is the easiest to read back.
    expect(screen.getAllByText('2026').length).toBe(2);

    await user.click(screen.getByRole('button', { name: 'Clear dates' }));
    expect(onChange).toHaveBeenCalledWith(null, null);
  });

  it('ignores a malformed bound instead of throwing', () => {
    render(<ExchangeDateRangeFilter from="not-a-date" to="2026-01-20" onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Clear dates' })).not.toBeInTheDocument();
  });
});
