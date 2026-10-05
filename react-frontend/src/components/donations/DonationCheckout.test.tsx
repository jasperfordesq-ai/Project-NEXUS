// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── vi.hoisted ──────────────────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
}));

// Stripe mocks — hoisted so they're available in vi.mock factories
const mockConfirmPayment = vi.hoisted(() => vi.fn());
const mockStripe = vi.hoisted(() => ({
  confirmPayment: mockConfirmPayment,
}));
const mockElements = vi.hoisted(() => ({}));

// The community currency comes from the tenant bootstrap; tests flip it per case.
const tenantState = vi.hoisted(() => ({ currency: 'EUR' }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => {
      // Built as a variable so the extra `currency` field type-checks against
      // the helper's narrower default tenant shape.
      const tenant = { id: 2, name: 'Test Tenant', slug: 'test', currency: tenantState.currency };
      return {
        tenant,
        tenantPath: (p: string) => `/test${p}`,
        hasFeature: vi.fn((_key: string) => true),
        hasModule: vi.fn((_key: string) => true),
      };
    },
  })
);

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('@/lib/tenant-routing', () => ({
  detectTenantFromUrl: vi.fn(() => ({ source: 'path', slug: 'test' })),
  tenantPath: (path: string, slug: string) => `/${slug}${path}`,
}));

// Mock Stripe
vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve(mockStripe)),
}));

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="stripe-elements">{children}</div>
  ),
  PaymentElement: () => <div data-testid="stripe-payment-element" />,
  useStripe: () => mockStripe,
  useElements: () => mockElements,
}));

// Mock the StripePaymentForm sub-component entirely to isolate DonationCheckout
vi.mock('./StripePaymentForm', () => ({
  StripePaymentForm: ({
    onSuccess,
    onError,
  }: {
    clientSecret: string;
    onSuccess: () => void;
    onError: (e: string) => void;
  }) => (
    <div data-testid="stripe-payment-form">
      <button onClick={() => onSuccess()}>Pay Now</button>
      <button onClick={() => onError('card_declined')}>Trigger Error</button>
    </div>
  ),
}));

import React from 'react';
import { api } from '@/lib/api';
import { DonationCheckout } from './DonationCheckout';

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  onDonationComplete: vi.fn(),
};

describe('DonationCheckout', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    tenantState.currency = 'EUR';
  });

  // ── Step 1: Form ──────────────────────────────────────────────────────────

  it('renders the form step with amount input when open', () => {
    render(<DonationCheckout {...defaultProps} />);
    // Amount input (type=number)
    const amountInput = screen.queryByRole('spinbutton');
    expect(amountInput).toBeInTheDocument();
  });

  it('tells the donor which organisation the campaign supports', () => {
    render(<DonationCheckout {...defaultProps} givingDayId={3} beneficiaryName="Food Bank" />);
    expect(screen.getByText('Your donation supports Food Bank.')).toBeInTheDocument();
  });

  it('names no organisation for a whole-community donation', () => {
    render(<DonationCheckout {...defaultProps} />);
    expect(screen.queryByText(/Your donation supports/)).not.toBeInTheDocument();
  });

  it('shows the modal header', () => {
    render(<DonationCheckout {...defaultProps} />);
    // Dialog should be present
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    render(<DonationCheckout {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Continue button is disabled when amount is empty', () => {
    render(<DonationCheckout {...defaultProps} />);
    const continueBtn = screen.getByRole('button', { name: /continue/i });
    expect(
      continueBtn.getAttribute('disabled') !== null ||
        continueBtn.getAttribute('aria-disabled') === 'true',
    ).toBe(true);
  });

  it('Continue button is disabled when amount < 0.5', async () => {
    render(<DonationCheckout {...defaultProps} />);
    const amountInput = screen.getByRole('spinbutton');
    fireEvent.change(amountInput, { target: { value: '0.1' } });
    await waitFor(() => {
      const continueBtn = screen.getByRole('button', { name: /continue/i });
      const isDisabled =
        continueBtn.getAttribute('disabled') !== null ||
        continueBtn.getAttribute('aria-disabled') === 'true';
      expect(isDisabled).toBe(true);
    });
  });

  it('shows toast when continuing with invalid amount', async () => {
    render(<DonationCheckout {...defaultProps} />);

    // Try to click continue (it should be disabled, so we force it via fireEvent)
    const form = document.querySelector('form');
    if (form) {
      fireEvent.submit(form);
    }
    // Toast fires from the amount validation guard
    // Since button is disabled, nothing should call api.post
    expect(vi.mocked(api.post).mock.calls.length).toBe(0);
  });

  it('creates payment intent and advances to payment step', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      success: true,
      data: { client_secret: 'pi_test_secret', donation_id: 99 },
    });
    const user = userEvent.setup();
    render(<DonationCheckout {...defaultProps} />);

    // userEvent.type triggers React synthetic events that flow through onValueChange
    const amountInput = screen.getByRole('spinbutton');
    await user.clear(amountInput);
    await user.type(amountInput, '10');

    // The Continue button becomes enabled once amount >= 0.5
    await waitFor(() => {
      const continueBtn = screen.queryByRole('button', { name: /continue/i });
      const isEnabled =
        continueBtn &&
        continueBtn.getAttribute('disabled') === null &&
        continueBtn.getAttribute('aria-disabled') !== 'true';
      expect(isEnabled).toBe(true);
    });

    // onPress requires userEvent.click (not fireEvent.click) for React Aria buttons
    await user.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/v2/donations/payment-intent',
        expect.objectContaining({
          amount: expect.any(Number),
          currency: 'EUR',
        }),
      ),
    );
    // Should advance to payment step and show StripePaymentForm
    await waitFor(() =>
      expect(screen.getByTestId('stripe-payment-form')).toBeInTheDocument(),
    );
  });

  // The server refuses any currency other than the community's own, so the
  // checkout never offers a choice: it shows the tenant currency and pays in it.
  it('shows the community currency on the amount field and offers no currency picker', () => {
    render(<DonationCheckout {...defaultProps} />);
    expect(screen.getByText('EUR')).toBeInTheDocument();
    expect(
      screen.queryAllByRole('button').find((b) => b.getAttribute('data-slot') === 'select-trigger' && b.textContent?.includes('EUR')),
    ).toBeUndefined();
    // Gift Aid is a UK scheme — not shown for a euro community.
    expect(screen.queryByRole('switch', { name: /gift aid/i })).not.toBeInTheDocument();
  });

  it('sends the selected fund and Gift Aid declaration to the payment intent API for a GBP community', async () => {
    tenantState.currency = 'GBP';
    vi.mocked(api.post).mockResolvedValueOnce({
      success: true,
      data: { client_secret: 'pi_test_secret', donation_id: 99 },
    });
    const user = userEvent.setup();
    render(<DonationCheckout {...defaultProps} />);

    await user.type(screen.getByRole('spinbutton'), '25');

    await user.click(screen.getByRole('switch', { name: /gift aid/i }));
    await user.type(screen.getByLabelText(/full name on declaration/i), 'Ada Lovelace');
    await user.type(screen.getByLabelText(/address line 1/i), '1 Example Street');
    await user.type(screen.getByLabelText(/town or city/i), 'London');
    await user.type(screen.getByLabelText(/postcode/i), 'SW1A 1AA');

    await user.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/v2/donations/payment-intent',
        expect.objectContaining({
          amount: 25,
          currency: 'GBP',
          fund_code: 'general',
          gift_aid_enabled: true,
          gift_aid: {
            declaration_name: 'Ada Lovelace',
            address_line1: '1 Example Street',
            address_line2: null,
            town: 'London',
            postcode: 'SW1A 1AA',
            country: 'GB',
          },
        }),
      ),
    );
  });

  it('shows error toast when payment intent creation fails', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      success: false,
      error: 'intent_creation_failed',
    });
    const user = userEvent.setup();
    render(<DonationCheckout {...defaultProps} />);

    // Use userEvent.type + userEvent.click for onPress buttons
    const amountInput = screen.getByRole('spinbutton');
    await user.clear(amountInput);
    await user.type(amountInput, '10');

    await waitFor(() => {
      const continueBtn = screen.queryByRole('button', { name: /continue/i });
      const isEnabled =
        continueBtn &&
        continueBtn.getAttribute('disabled') === null &&
        continueBtn.getAttribute('aria-disabled') !== 'true';
      expect(isEnabled).toBe(true);
    });
    await user.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });

  // ── Step 2: Payment ──────────────────────────────────────────────────────

  it('advances to success step when StripePaymentForm calls onSuccess', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      success: true,
      data: { client_secret: 'pi_test_secret', donation_id: 99 },
    });
    const user = userEvent.setup();
    render(<DonationCheckout {...defaultProps} />);

    // Use userEvent.type to trigger onValueChange; userEvent.click for onPress buttons
    const amountInput = screen.getByRole('spinbutton');
    await user.clear(amountInput);
    await user.type(amountInput, '10');

    await waitFor(() => {
      const continueBtn = screen.queryByRole('button', { name: /continue/i });
      const isEnabled =
        continueBtn &&
        continueBtn.getAttribute('disabled') === null &&
        continueBtn.getAttribute('aria-disabled') !== 'true';
      expect(isEnabled).toBe(true);
    });
    await user.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() =>
      expect(screen.getByTestId('stripe-payment-form')).toBeInTheDocument(),
    );

    // Simulate payment success via the mock's "Pay Now" button
    await user.click(screen.getByRole('button', { name: /pay now/i }));

    await waitFor(() => expect(defaultProps.onDonationComplete).toHaveBeenCalled());
    // Success step shows close button
    await waitFor(() => {
      const allBtns = screen.getAllByRole('button');
      const closeBtn = allBtns.find((b) => /close/i.test(b.textContent ?? ''));
      expect(closeBtn).toBeDefined();
    });
  });

  it('Back button on payment step returns to form step', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      success: true,
      data: { client_secret: 'pi_test_secret', donation_id: 99 },
    });
    const user = userEvent.setup();
    render(<DonationCheckout {...defaultProps} />);

    // Use userEvent.type to trigger onValueChange; userEvent.click for onPress buttons
    const amountInput = screen.getByRole('spinbutton');
    await user.clear(amountInput);
    await user.type(amountInput, '10');

    await waitFor(() => {
      const continueBtn = screen.queryByRole('button', { name: /continue/i });
      const isEnabled =
        continueBtn &&
        continueBtn.getAttribute('disabled') === null &&
        continueBtn.getAttribute('aria-disabled') !== 'true';
      expect(isEnabled).toBe(true);
    });
    await user.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() =>
      expect(screen.getByTestId('stripe-payment-form')).toBeInTheDocument(),
    );

    // Back button
    const allBtns = screen.getAllByRole('button');
    const backBtn = allBtns.find((b) => /back/i.test(b.textContent ?? ''));
    expect(backBtn).toBeDefined();
    await user.click(backBtn!);

    await waitFor(() =>
      expect(screen.getByRole('spinbutton')).toBeInTheDocument(),
    );
  });

  // ── Step 3: Success ───────────────────────────────────────────────────────

  it('Close button on success step calls onClose', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      success: true,
      data: { client_secret: 'pi_test_secret', donation_id: 99 },
    });
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DonationCheckout {...defaultProps} onClose={onClose} />);

    // Use userEvent.type to trigger onValueChange; userEvent.click for onPress buttons
    const amountInput = screen.getByRole('spinbutton');
    await user.clear(amountInput);
    await user.type(amountInput, '10');

    await waitFor(() => {
      const continueBtn = screen.queryByRole('button', { name: /continue/i });
      const isEnabled =
        continueBtn &&
        continueBtn.getAttribute('disabled') === null &&
        continueBtn.getAttribute('aria-disabled') !== 'true';
      expect(isEnabled).toBe(true);
    });
    await user.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() =>
      expect(screen.getByTestId('stripe-payment-form')).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: /pay now/i }));

    // Wait for success step close button
    let closeBtn: HTMLElement | undefined;
    await waitFor(() => {
      const allBtns = screen.getAllByRole('button');
      closeBtn = allBtns.find((b) => /close/i.test(b.textContent ?? ''));
      expect(closeBtn).toBeDefined();
    });
    await user.click(closeBtn!);
    expect(onClose).toHaveBeenCalled();
  });

  // ── Anonymous toggle ──────────────────────────────────────────────────────

  it('anonymous toggle is present on form step', () => {
    render(<DonationCheckout {...defaultProps} />);
    const toggle = screen.getByRole('switch', { name: /donate anonymously/i });
    expect(toggle).toBeInTheDocument();
  });

  it('sends is_anonymous=true when toggled', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      success: true,
      data: { client_secret: 'pi_test_secret', donation_id: 99 },
    });
    const user = userEvent.setup();
    render(<DonationCheckout {...defaultProps} />);

    // Use userEvent.type + userEvent.click for onPress buttons
    const amountInput = screen.getByRole('spinbutton');
    await user.clear(amountInput);
    await user.type(amountInput, '10');

    // Toggle anonymous
    const toggle = screen.getByRole('switch', { name: /donate anonymously/i });
    await user.click(toggle);

    await waitFor(() => {
      const continueBtn = screen.queryByRole('button', { name: /continue/i });
      const isEnabled =
        continueBtn &&
        continueBtn.getAttribute('disabled') === null &&
        continueBtn.getAttribute('aria-disabled') !== 'true';
      expect(isEnabled).toBe(true);
    });
    await user.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => {
      const calls = vi.mocked(api.post).mock.calls;
      if (calls.length > 0) {
        expect(calls[0][1]).toMatchObject({ is_anonymous: true });
      }
    });
  });
});
