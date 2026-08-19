// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The shared failure state.
 *
 * 🔴 Its absence was the biggest remaining UX gap in the app. `components/ui/` had
 * `EmptyState`, `LoadingSpinner` and `Skeleton` — the happy path and the waiting path — and
 * nothing for failure, so every screen improvised and a readiness audit found retry offered on
 * only 19 of 43 large screens. Crashes were never the gap (`ModalErrorBoundary` covers
 * ~100% of modals); the ordinary case was — a 500, or a train tunnel.
 *
 * The assertions worth having are about the DEAD END, not the pixels: that it always explains
 * itself even with no props, and that a retry actually fires.
 */

import React from 'react';
import { render, screen, userEvent } from '@testing-library/react-native';

import ErrorState from './ErrorState';

describe('ErrorState', () => {
  it('explains itself with no props at all', () => {
    // A screen that renders this bare must still say something useful, because the most
    // likely adoption is a one-line substitution with nothing to hand.
    render(<ErrorState />);

    expect(screen.getByText("Couldn't load this")).toBeTruthy();
    expect(screen.getByText('Something went wrong while loading. Please try again.')).toBeTruthy();
  });

  it('prefers a caller-supplied title and detail', () => {
    render(<ErrorState title="Wallet unavailable" subtitle="The server did not respond." />);

    expect(screen.getByText('Wallet unavailable')).toBeTruthy();
    expect(screen.getByText('The server did not respond.')).toBeTruthy();
  });

  it('🔴 offers a retry that actually fires', async () => {
    const onRetry = jest.fn();
    render(<ErrorState onRetry={onRetry} />);

    await userEvent.press(screen.getByText('Retry'));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows no button when there is nothing to retry', () => {
    // Some failures cannot be retried (a deleted record). Better to explain and stop than to
    // show a button that does nothing — which is the defect this component replaces.
    render(<ErrorState />);

    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('uses a caller-supplied action label', () => {
    // profile.tsx says "Sign in" rather than "Retry", because signing in is the real recovery
    // when there is no session to retry with.
    render(<ErrorState onRetry={jest.fn()} retryLabel="Sign in" />);

    expect(screen.getByText('Sign in')).toBeTruthy();
    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('stops a second tap while a retry is in flight', async () => {
    const onRetry = jest.fn();
    render(<ErrorState onRetry={onRetry} isRetrying />);

    await userEvent.press(screen.getByText('Retry'));

    expect(onRetry).not.toHaveBeenCalled();
  });
});
