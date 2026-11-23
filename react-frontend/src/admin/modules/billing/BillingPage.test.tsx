// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── Stable mock refs (hoisted so they're available inside vi.mock factories) ──
const { mockToast, mockBillingApi, mockApi } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  mockBillingApi: {
    getSubscription: vi.fn(),
    getStanding: vi.fn(),
    getPayments: vi.fn(),
    createPortal: vi.fn(),
    getPlans: vi.fn(),
    createCheckout: vi.fn(),
    getInvoices: vi.fn(),
  },
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

vi.mock('@/admin/api/billingApi', () => ({
  billingApi: mockBillingApi,
}));

vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { BillingPage } from './BillingPage';

// The server's shapes, key for key, pinned from the other end by
// tests/Laravel/Feature/Billing/CommunityBillingPageContractTest.php. Until
// 21 Nov 2026 this file's fixture was invented (`plan_id`, `user_count`,
// `plan.max_users`, `current_period_end` on a record that never carried it),
// and the page it tested said "Unlimited Users" for every real community.

/** GET /v2/admin/billing/subscription */
const subscription = (over: Record<string, unknown> = {}) => ({
  id: 7,
  pay_plan_id: 16,
  plan_name: 'Local',
  plan_slug: 'local',
  plan_tier_level: 2,
  plan_description: '101 to 300 active members. Best for established local timebanks that have outgrown a pilot.',
  status: 'active',
  stripe_status: 'active',
  billing_interval: 'monthly',
  starts_at: '2026-11-01T09:00:00+00:00',
  current_period_end: '2026-12-01T09:00:00+00:00',
  trial_ends_at: null,
  stripe_subscription_id: 'sub_123',
  has_card_subscription: true,
  ...over,
});

/** GET /v2/admin/billing/standing */
const standing = (over: Record<string, unknown> = {}) => ({
  paused: false,
  own: null,
  since: null,
  payee: null,
  payee_name: null,
  payer: 'platform_card',
  paid_until: '2026-12-01',
  overdue_days: null,
  member_limit: { used: 212, max: 300, percent: 70, stage: null, rule: 'none', acts_on: null },
  plan: {
    name: 'Local',
    description: '101 to 300 active members. Best for established local timebanks that have outgrown a pilot.',
    max_users: 300,
    price_monthly: 199,
    price_yearly: 1990,
    setup_fee: 645,
    currency: 'gbp',
    terms: 'default',
  },
  ...over,
});

/** A row of GET /v2/admin/billing/payments (pinned by HowToPayNoteTest). */
const payment = (over: Record<string, unknown> = {}) => ({
  id: 3,
  received_on: '2026-11-02',
  method: 'bank_transfer',
  amount: '480.00',
  currency: 'EUR',
  paid_until_after: '2027-10-31',
  source: 'manual',
  paid_to: 'platform',
  voided: false,
  refunded_amount: null,
  ...over,
});

function serve(sub: unknown, stand: unknown, payments: unknown[] = []) {
  mockBillingApi.getSubscription.mockResolvedValue({ success: true, data: sub });
  mockBillingApi.getStanding.mockResolvedValue({ success: true, data: stand });
  mockBillingApi.getPayments.mockResolvedValue({ success: true, data: payments });
}

describe('BillingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBillingApi.getPayments.mockResolvedValue({ success: true, data: [] });
  });

  it('shows loading spinner while the page is fetching', () => {
    mockBillingApi.getSubscription.mockReturnValue(new Promise(() => {}));
    mockBillingApi.getStanding.mockReturnValue(new Promise(() => {}));

    render(<BillingPage />);

    const spinner = screen.getAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true');
    expect(spinner).toBeInTheDocument();
  });

  it('shows the plan with the member number it allows, its price in the community\'s currency and its setup fee', async () => {
    serve(subscription(), standing());

    render(<BillingPage />);

    await waitFor(() => expect(screen.getByText('Local')).toBeInTheDocument());
    expect(screen.getByText('Up to 300 active members')).toBeInTheDocument();
    expect(screen.getByText('£199 per month')).toBeInTheDocument();
    expect(screen.getByText('£1,990 per year')).toBeInTheDocument();
    expect(screen.getByText('plus £645 one-off setup fee')).toBeInTheDocument();
    // Never the old, always-wrong line.
    expect(screen.queryByText(/unlimited users/i)).not.toBeInTheDocument();
  });

  it('shows who the community pays, the date it is paid up to, the period and the next payment', async () => {
    serve(subscription(), standing());

    render(<BillingPage />);

    await waitFor(() => expect(screen.getByText('Local')).toBeInTheDocument());
    expect(screen.getByText('Platform, by card')).toBeInTheDocument();
    expect(screen.getByText('Paid up to and including')).toBeInTheDocument();
    expect(screen.getByText('Monthly')).toBeInTheDocument();
    expect(screen.getByText('Next billing date')).toBeInTheDocument();
    // No "--" and no "Unknown interval" anywhere.
    expect(screen.queryByText('--')).not.toBeInTheDocument();
    expect(screen.queryByText(/unknown interval/i)).not.toBeInTheDocument();
  });

  it('leaves the period out when it is not known, instead of saying "Unknown interval"', async () => {
    serve(subscription({ billing_interval: null }), standing());

    render(<BillingPage />);

    await waitFor(() => expect(screen.getByText('Local')).toBeInTheDocument());
    expect(screen.queryByText('Billing interval')).not.toBeInTheDocument();
    expect(screen.queryByText(/unknown interval/i)).not.toBeInTheDocument();
  });

  it('shows the active members against the plan\'s number, as the daily check counts them', async () => {
    serve(subscription(), standing());

    render(<BillingPage />);

    await waitFor(() => expect(screen.getByText('212 of 300 active members')).toBeInTheDocument());
    expect(screen.getByText(/signed in within the last 90 days/i)).toBeInTheDocument();
  });

  it('warns when the community is over its member number', async () => {
    serve(subscription(), standing({ member_limit: { used: 320, max: 300, percent: 106, stage: 'over', rule: 'pause', acts_on: '2026-12-20' } }));

    render(<BillingPage />);

    await waitFor(() => expect(screen.getByText('320 of 300 active members')).toBeInTheDocument());
    expect(screen.getByText(/more than its plan's limit of 300/i)).toBeInTheDocument();
  });

  it('says "No member limit" for a plan without one, and shows no members card', async () => {
    serve(subscription(), standing({
      member_limit: null,
      plan: { ...standing().plan, max_users: null },
    }));

    render(<BillingPage />);

    await waitFor(() => expect(screen.getByText('No member limit')).toBeInTheDocument());
    expect(screen.queryByText('Active members')).not.toBeInTheDocument();
  });

  it('shows a plan given by hand to a community that pays by invoice, with no card actions', async () => {
    serve(
      subscription({ stripe_subscription_id: null, stripe_status: null, billing_interval: null, current_period_end: null, has_card_subscription: false }),
      standing({ payer: 'platform_invoice' }),
    );

    render(<BillingPage />);

    await waitFor(() => expect(screen.getByText('Local')).toBeInTheDocument());
    expect(screen.getByText('Platform, by invoice')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /manage payment/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Next billing date')).not.toBeInTheDocument();
  });

  // ── Read-only for everyone but a card payer (owner, 23 Nov 2026) ─────────

  it('is read-only for a community that pays by invoice: no plan picker, no card invoices, and a way to ask', async () => {
    serve(
      subscription({ stripe_subscription_id: null, stripe_status: null, billing_interval: null, current_period_end: null, has_card_subscription: false }),
      standing({ payer: 'platform_invoice' }),
    );

    render(<BillingPage />);

    await waitFor(() => expect(screen.getByText('Local')).toBeInTheDocument());
    expect(screen.getByText(/This community pays the platform by invoice\./)).toBeInTheDocument();
    // Changing a plan here goes through card checkout: not for an invoice payer.
    expect(screen.queryByRole('link', { name: /change plan/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /view invoices/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Message the platform team' })).toBeInTheDocument();
  });

  it('says so when the community has no plan, and tells an invoice payer who to ask', async () => {
    serve(null, standing({ payer: 'platform_invoice', paid_until: null, member_limit: null, plan: null }));

    render(<BillingPage />);

    await waitFor(() => expect(screen.getByText('This community has no plan yet.')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /choose plan/i })).not.toBeInTheDocument();
    expect(screen.getByText(/The platform team sets this community's plan\./)).toBeInTheDocument();
  });

  it('offers "Choose plan" to a card payer with no plan', async () => {
    serve(null, standing({ payer: 'platform_card', paid_until: null, member_limit: null, plan: null }));

    render(<BillingPage />);

    await waitFor(() => expect(screen.getByText('This community has no plan yet.')).toBeInTheDocument());
    expect(screen.getAllByRole('link', { name: /choose plan/i }).length).toBeGreaterThan(0);
  });

  it('says "No date set" when a billed community has no paid-until date, and nothing for one nobody bills', async () => {
    serve(
      subscription({ stripe_subscription_id: null, stripe_status: null, has_card_subscription: false }),
      standing({ payer: 'platform_invoice', paid_until: null }),
    );
    const first = render(<BillingPage />);
    expect(await screen.findByTestId('own-paid-until')).toHaveTextContent('No date set');
    first.unmount();

    serve(
      subscription({ stripe_subscription_id: null, stripe_status: null, has_card_subscription: false }),
      standing({ payer: 'not_billed', paid_until: null }),
    );
    render(<BillingPage />);
    await waitFor(() => expect(screen.getByText('Not billed')).toBeInTheDocument());
    expect(screen.queryByTestId('own-paid-until')).not.toBeInTheDocument();
  });

  // ── How to pay, in the payee's own words ─────────────────────────────────

  it('shows the platform team\'s how-to-pay note to an invoice payer, as plain text', async () => {
    serve(
      subscription({ stripe_subscription_id: null, stripe_status: null, has_card_subscription: false }),
      standing({ payer: 'platform_invoice', how_to_pay: 'Pay by bank transfer.\nIBAN IE00 TEST 0000\n<b>not markup</b>' }),
    );

    render(<BillingPage />);

    const card = within(await screen.findByTestId('how-to-pay'));
    expect(card.getByText('How to pay')).toBeInTheDocument();
    expect(card.getByText('From the platform team')).toBeInTheDocument();
    expect(card.getByText(/IBAN IE00 TEST 0000/)).toBeInTheDocument();
    // Another community's words are text, never markup.
    expect(card.getByText(/<b>not markup<\/b>/)).toBeInTheDocument();
    expect(card.queryByText('not markup')).not.toBeInTheDocument();
  });

  it('names the parent community it pays, and says the note is from that community', async () => {
    serve(
      subscription({ stripe_subscription_id: null, stripe_status: null, has_card_subscription: false }),
      standing({ payer: 'parent', payee_name: 'Cork Timebank', how_to_pay: 'Pay Cork by cheque.' }),
    );

    render(<BillingPage />);

    expect(await screen.findByTestId('own-payer')).toHaveTextContent('Cork Timebank, its parent community');
    const card = within(screen.getByTestId('how-to-pay'));
    expect(card.getByText('From Cork Timebank')).toBeInTheDocument();
    expect(card.getByText('Pay Cork by cheque.')).toBeInTheDocument();
  });

  it('shows no how-to-pay card when nobody has written a note', async () => {
    serve(subscription(), standing({ how_to_pay: null }));

    render(<BillingPage />);

    await waitFor(() => expect(screen.getByText('Local')).toBeInTheDocument());
    expect(screen.queryByTestId('how-to-pay')).not.toBeInTheDocument();
  });

  // ── The community's own payments ─────────────────────────────────────────

  it('lists the payments recorded for the community', async () => {
    serve(subscription(), standing(), [
      payment(),
      payment({ id: 4, received_on: '2025-11-01', method: 'cash', amount: null, currency: null, paid_until_after: '2026-10-31' }),
    ]);

    render(<BillingPage />);

    const first = within(await screen.findByTestId('own-payment-3'));
    expect(first.getByText('Bank transfer')).toBeInTheDocument();
    expect(first.getByText(/480/)).toBeInTheDocument();
    const second = within(screen.getByTestId('own-payment-4'));
    expect(second.getByText('Cash')).toBeInTheDocument();
    expect(second.getByText('Not recorded')).toBeInTheDocument();
  });

  it('keeps a voided payment in the list and says it is not counted', async () => {
    serve(subscription(), standing(), [payment({ voided: true })]);

    render(<BillingPage />);

    const row = within(await screen.findByTestId('own-payment-3'));
    expect(row.getByText('Voided: it was recorded by mistake and is not counted.')).toBeInTheDocument();
    expect(row.getByText('Bank transfer').className).toMatch(/line-through/);
  });

  it('shows a way of paying it does not know as "Other", not as a raw word', async () => {
    serve(subscription(), standing(), [payment({ method: 'direct_debit_2027' })]);

    render(<BillingPage />);

    const row = within(await screen.findByTestId('own-payment-3'));
    expect(row.getByText('Other')).toBeInTheDocument();
    expect(row.queryByText('direct_debit_2027')).not.toBeInTheDocument();
  });

  it('says so when there are no payments, or when they cannot be loaded, and still shows the plan', async () => {
    serve(subscription(), standing(), []);
    const first = render(<BillingPage />);
    expect(await screen.findByText('No payments are recorded yet.')).toBeInTheDocument();
    first.unmount();

    serve(subscription(), standing());
    mockBillingApi.getPayments.mockResolvedValue({ success: false, error: 'nope' });
    render(<BillingPage />);
    expect(await screen.findByText('The payments could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText('Local')).toBeInTheDocument();
  });

  it('tells a community that pays its parent community that nothing is arranged here', async () => {
    serve(
      subscription({ stripe_subscription_id: null, stripe_status: null, has_card_subscription: false }),
      standing({ payer: 'parent', plan: { ...standing().plan, terms: 'hub' } }),
    );

    render(<BillingPage />);

    await waitFor(() => expect(screen.getByText(/pays its parent community/i)).toBeInTheDocument());
    expect(screen.getByText('Local')).toBeInTheDocument();
    // Its plan and payments are its parent's: no platform plan picker, no
    // card invoices, no message to the platform team, and so no Actions box.
    expect(screen.queryByRole('link', { name: /change plan/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /view invoices/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /message the platform team/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Actions')).not.toBeInTheDocument();
  });

  // F-640: a manager visiting from a community above is refused every billing
  // request but the standing. The page says so and offers nothing.
  it('shows a visiting manager a plain note and none of the community\'s billing', async () => {
    mockBillingApi.getSubscription.mockResolvedValue({ success: false, error: 'You are visiting this community.', code: 'VISITING_MANAGER_NO_BILLING' });
    mockBillingApi.getStanding.mockResolvedValue({ success: true, data: standing({ visiting: true }) });

    render(<BillingPage />);

    await waitFor(() => expect(screen.getByText(/you are visiting this community/i)).toBeInTheDocument());
    expect(screen.queryByText('Local')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /manage payment/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /change plan/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /view invoices/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request upgrade/i })).not.toBeInTheDocument();
  });

  it('keeps the plan and "Manage payment" on screen for a card payer whose card has failed, and says what to do', async () => {
    // Stripe "past due" is recorded as `expired`. The page then said "No
    // subscription" and hid the only way to update the card.
    serve(subscription({ status: 'expired', stripe_status: 'past_due' }), standing({ overdue_days: 3 }));

    render(<BillingPage />);

    await waitFor(() => expect(screen.getByText('Local')).toBeInTheDocument());
    expect(screen.getByText(/last card payment did not go through/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /manage payment/i })).toBeInTheDocument();
    // "Payment overdue", not "Expired": the plan has not ended. The days overdue are
    // on the admin banner above every admin page, not repeated here.
    expect(screen.getByText('Payment overdue')).toBeInTheDocument();
    expect(screen.queryByText('Expired')).not.toBeInTheDocument();
    expect(screen.queryByText(/days overdue/i)).not.toBeInTheDocument();
    expect(screen.queryByText('This community has no plan yet.')).not.toBeInTheDocument();
  });

  it('shows no "Manage payment" once the card subscription is over', async () => {
    serve(
      subscription({ status: 'cancelled', stripe_status: 'canceled', has_card_subscription: false }),
      standing({ payer: 'platform_invoice', plan: null, member_limit: null }),
    );

    render(<BillingPage />);

    await waitFor(() => expect(screen.getByText('This community has no plan yet.')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /manage payment/i })).not.toBeInTheDocument();
  });

  it('says the page could not be loaded, instead of "no plan", when the request fails', async () => {
    mockBillingApi.getSubscription.mockResolvedValue({ success: false, error: 'Server error' });
    mockBillingApi.getStanding.mockResolvedValue({ success: false, error: 'Server error' });

    render(<BillingPage />);

    await waitFor(() => expect(screen.getByText('The billing details could not be loaded.')).toBeInTheDocument());
    expect(screen.queryByText('This community has no plan yet.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('calls billingApi.createPortal and opens portal URL', async () => {
    serve(subscription(), standing());
    mockBillingApi.createPortal.mockResolvedValue({
      success: true,
      data: { portal_url: 'https://billing.stripe.com/session/test' },
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(<BillingPage />);

    const btn = await screen.findByRole('button', { name: /manage payment/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockBillingApi.createPortal).toHaveBeenCalled();
      expect(openSpy).toHaveBeenCalledWith('https://billing.stripe.com/session/test', '_blank', 'noopener,noreferrer');
    });
    openSpy.mockRestore();
  });

  it('shows the server\'s reason when the payment page cannot be opened', async () => {
    // The API client answers "not successful" instead of throwing, so a
    // refusal used to do nothing at all.
    serve(subscription(), standing());
    mockBillingApi.createPortal.mockResolvedValue({ success: false, error: 'The payment page is not available right now.' });

    render(<BillingPage />);

    fireEvent.click(await screen.findByRole('button', { name: /manage payment/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('The payment page is not available right now.');
    });
  });

  it('shows toast error when portal creation throws', async () => {
    serve(subscription(), standing());
    mockBillingApi.createPortal.mockRejectedValue(new Error('Stripe error'));

    render(<BillingPage />);

    fireEvent.click(await screen.findByRole('button', { name: /manage payment/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows the "change plan" link for a community that pays the platform', async () => {
    serve(subscription(), standing());

    render(<BillingPage />);

    await waitFor(() => expect(screen.getByText('Local')).toBeInTheDocument());
    const links = screen.getAllByRole('link');
    expect(links.some((l) => (l.getAttribute('href') ?? '').endsWith('/admin/billing/plans'))).toBe(true);
  });
  it('opens the message box when the address asks for it, and will not send an empty message', async () => {
    // The plan picker sends people here from a plan they cannot take themselves.
    window.history.pushState({}, '', '/?message=1');
    try {
      render(<BillingPage />);

      const send = await screen.findByRole('button', { name: 'Send message' });
      expect(send).toBeDisabled();

      fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'We have paid our invoice.' } });
      expect(screen.getByRole('button', { name: 'Send message' })).not.toBeDisabled();
    } finally {
      window.history.pushState({}, '', '/');
    }
  });
});
