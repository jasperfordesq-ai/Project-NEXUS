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

  it('offers to send the other person a thank-you message', () => {
    render(<ExchangeThanks neighbours={1} hours={1} onClose={vi.fn()} partnerName="Ciaran" messageHref="/test/messages/new/9" />);
    const link = screen.getByRole('link', { name: 'Send Ciaran a thank-you message' });
    expect(link).toHaveAttribute('href', '/test/messages/new/9');
  });

  it('offers no message button when messaging is not available', () => {
    render(<ExchangeThanks neighbours={1} hours={1} onClose={vi.fn()} partnerName="Ciaran" />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('offers to write the other person a thank-you note', () => {
    const onWriteNote = vi.fn();
    render(<ExchangeThanks neighbours={1} hours={1} onClose={vi.fn()} partnerName="Ciaran" onWriteNote={onWriteNote} />);
    fireEvent.click(screen.getByRole('button', { name: 'Write Ciaran a thank-you note' }));
    expect(onWriteNote).toHaveBeenCalledTimes(1);
  });

  it('offers no thank-you note button when thank-you notes are switched off', () => {
    render(<ExchangeThanks neighbours={1} hours={1} onClose={vi.fn()} partnerName="Ciaran" messageHref="/test/messages/new/9" />);
    expect(screen.queryByTestId('exchange-thanks-note')).toBeNull();
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

  it("shows the other person's picture, with the handshake as a badge on it", () => {
    render(<ExchangeThanks neighbours={1} hours={1} onClose={vi.fn()} partnerName="Ciaran" partnerAvatar={null} />);
    const face = screen.getByTestId('exchange-thanks-face');
    expect(face).toBeInTheDocument();
    // Decorative: the name is in the text, so the picture is hidden from screen readers.
    expect(face.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByTestId('exchange-thanks-icon').className).toContain('bg-accent-strong');
  });

  it('keeps the handshake alone when there is no one to show', () => {
    render(<ExchangeThanks neighbours={1} hours={1} onClose={vi.fn()} />);
    expect(screen.queryByTestId('exchange-thanks-face')).toBeNull();
  });
});
