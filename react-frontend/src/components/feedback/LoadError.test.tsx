// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@/test/test-utils';
import { LoadError } from './LoadError';

describe('LoadError', () => {
  it('says what happened with "we", and what to do next, when nothing is passed', () => {
    render(<LoadError onRetry={() => undefined} />);

    const panel = screen.getByTestId('load-error');
    expect(panel).toHaveAttribute('role', 'alert');
    expect(panel).toHaveTextContent("We couldn't load this just now");
    expect(panel).toHaveTextContent(/try again in a moment/i);
    // The voice guide: never "Failed to", "Unable to", "Error" or blame.
    expect(panel.textContent).not.toMatch(/failed to|unable to|\berror\b|invalid/i);
  });

  it('names the thing in the member\'s words when a title is given', () => {
    render(<LoadError title="We couldn't load your exchanges" description="Give it a moment, then try again." />);

    expect(screen.getByText("We couldn't load your exchanges")).toBeInTheDocument();
    expect(screen.getByText('Give it a moment, then try again.')).toBeInTheDocument();
    expect(screen.queryByText("We couldn't load this just now")).toBeNull();
  });

  it('offers "Try again" and runs the retry when it is pressed', () => {
    const onRetry = vi.fn();
    render(<LoadError onRetry={onRetry} />);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows no button when there is nothing to retry', () => {
    render(<LoadError />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
