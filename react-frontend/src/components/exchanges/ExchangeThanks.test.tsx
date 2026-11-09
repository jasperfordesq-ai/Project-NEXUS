// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@/test/test-utils';
import { ExchangeThanks } from './ExchangeThanks';

describe('ExchangeThanks', () => {
  it('thanks the member and shows their year so far', () => {
    render(<ExchangeThanks neighbours={4} hours={7.5} onClose={vi.fn()} />);

    const panel = screen.getByRole('status');
    expect(within(panel).getByRole('heading', { name: 'Thank you!' })).toBeInTheDocument();
    expect(within(panel).getByText("People you've exchanged with this year")).toBeInTheDocument();
    expect(within(panel).getByText('4')).toBeInTheDocument();
    expect(within(panel).getByText('Hours exchanged this year')).toBeInTheDocument();
    expect(within(panel).getByText('7.5')).toBeInTheDocument();
  });

  it('can be closed', () => {
    const onClose = vi.fn();
    render(<ExchangeThanks neighbours={1} hours={1} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sits on the soft community colour, with the icon on the button shade', () => {
    render(<ExchangeThanks neighbours={1} hours={1} onClose={vi.fn()} />);
    expect(screen.getByTestId('exchange-thanks').className).toContain('bg-accent-soft');
    expect(screen.getByTestId('exchange-thanks-icon').className).toContain('bg-accent-strong');
  });
});
