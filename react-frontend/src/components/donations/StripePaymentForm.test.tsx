// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/contexts', () => createMockContexts());

// ── Stripe mocks ──────────────────────────────────────────────────────────────
const mockConfirmPayment = vi.fn();

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn().mockResolvedValue({}),
}));

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({
    confirmPayment: mockConfirmPayment,
  }),
  useElements: () => ({
    getElement: vi.fn(),
  }),
}));

// Import React after mocks so JSX in Elements mock works
import React from 'react';
import { StripePaymentForm } from './StripePaymentForm';

describe('StripePaymentForm', () => {
  const onSuccess = vi.fn();
  const onError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirmPayment.mockReset();
  });

  it('renders the PaymentElement placeholder', () => {
    render(
      <StripePaymentForm
        clientSecret="pi_test_secret"
        onSuccess={onSuccess}
        onError={onError}
      />
    );
    expect(screen.getByTestId('payment-element')).toBeInTheDocument();
  });

  it('renders a submit button', () => {
    render(
      <StripePaymentForm
        clientSecret="pi_test_secret"
        onSuccess={onSuccess}
        onError={onError}
      />
    );
    expect(screen.getByRole('button', { name: /pay|processing|donations/i })).toBeInTheDocument();
  });

  it('calls confirmPayment on form submit', async () => {
    mockConfirmPayment.mockResolvedValueOnce({
      paymentIntent: { status: 'succeeded' },
    });

    const { container } = render(
      <StripePaymentForm
        clientSecret="pi_test_secret"
        onSuccess={onSuccess}
        onError={onError}
      />
    );

    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => {
      expect(mockConfirmPayment).toHaveBeenCalled();
    });
  });

  it('calls onSuccess when paymentIntent status is succeeded', async () => {
    mockConfirmPayment.mockResolvedValueOnce({
      paymentIntent: { status: 'succeeded' },
    });

    const { container } = render(
      <StripePaymentForm
        clientSecret="pi_test_secret"
        onSuccess={onSuccess}
        onError={onError}
      />
    );

    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('calls onError and shows error message when Stripe returns an error', async () => {
    mockConfirmPayment.mockResolvedValueOnce({
      error: { message: 'Your card was declined.' },
    });

    const { container } = render(
      <StripePaymentForm
        clientSecret="pi_test_secret"
        onSuccess={onSuccess}
        onError={onError}
      />
    );

    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Your card was declined.');
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByText('Your card was declined.')).toBeInTheDocument();
  });

  it('shows error message when paymentIntent has an unexpected status', async () => {
    mockConfirmPayment.mockResolvedValueOnce({
      paymentIntent: { status: 'canceled' },
    });

    const { container } = render(
      <StripePaymentForm
        clientSecret="pi_test_secret"
        onSuccess={onSuccess}
        onError={onError}
      />
    );

    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
  });

  it('shows action-required message when status is requires_action', async () => {
    mockConfirmPayment.mockResolvedValueOnce({
      paymentIntent: { status: 'requires_action' },
    });

    const { container } = render(
      <StripePaymentForm
        clientSecret="pi_test_secret"
        onSuccess={onSuccess}
        onError={onError}
      />
    );

    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => {
      // onSuccess and onError not called; an action-required message is shown
      expect(onSuccess).not.toHaveBeenCalled();
    });
    // The action_required error message is displayed (i18n key or translated value)
    expect(screen.getByText(/action_required|action required|additional authentication/i)).toBeInTheDocument();
  });

  // A PaymentIntent created on a community's own Stripe account (Connect
  // direct charge) can only be confirmed by Stripe.js initialised with that
  // account; through the platform instance Stripe answers "No such
  // payment_intent" and every donation to such a community fails.
  it('initialises Stripe.js against the connected account the client secret belongs to', async () => {
    // CI has no publishable key in its environment; the form reads it when
    // first needed, so stubbing it here is enough.
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_ci_stub');
    const { loadStripe } = await import('@stripe/stripe-js');
    vi.mocked(loadStripe).mockClear();

    render(
      <StripePaymentForm
        clientSecret="pi_test_secret"
        stripeAccountId="acct_test_community"
        onSuccess={onSuccess}
        onError={onError}
      />
    );

    expect(loadStripe).toHaveBeenCalledWith('pk_test_ci_stub', { stripeAccount: 'acct_test_community' });
    vi.unstubAllEnvs();
  });

  it('uses the platform account when no connected account is given', async () => {
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_ci_stub');
    const { loadStripe } = await import('@stripe/stripe-js');
    vi.mocked(loadStripe).mockClear();

    render(
      <StripePaymentForm
        clientSecret="pi_test_secret"
        stripeAccountId={null}
        onSuccess={onSuccess}
        onError={onError}
      />
    );

    // Instances are cached per account, so the platform one may already
    // exist from an earlier render; what matters is that it is never built
    // with a stripeAccount option.
    for (const call of vi.mocked(loadStripe).mock.calls) {
      expect(call[1]).toBeUndefined();
    }
    vi.unstubAllEnvs();
  });

  it('handles confirmPayment throwing an exception', async () => {
    mockConfirmPayment.mockRejectedValueOnce(new Error('Network failure'));

    const { container } = render(
      <StripePaymentForm
        clientSecret="pi_test_secret"
        onSuccess={onSuccess}
        onError={onError}
      />
    );

    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
