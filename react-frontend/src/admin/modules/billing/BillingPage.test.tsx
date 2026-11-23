// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── Stable mock refs (hoisted so they're available inside vi.mock factories) ──
const { mockToast, mockBillingApi, mockApi } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  mockBillingApi: {
    getSubscription: vi.fn(),
    getStanding: vi.fn(),
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

function serve(sub: unknown, stand: unknown) {
  mockBillingApi.getSubscription.mockResolvedValue({ success: true, data: sub });
  mockBillingApi.getStanding.mockResolvedValue({ success: true, data: stand });
}

describe('BillingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(screen.getByText('Next Billing Date')).toBeInTheDocument();
    // No "--" and no "Unknown interval" anywhere.
    expect(screen.queryByText('--')).not.toBeInTheDocument();
    expect(screen.queryByText(/unknown interval/i)).not.toBeInTheDocument();
  });

  it('leaves the period out when it is not known, instead of saying "Unknown interval"', async () => {
    serve(subscription({ billing_interval: null }), standing());

    render(<BillingPage />);

    await waitFor(() => expect(screen.getByText('Local')).toBeInTheDocument());
    expect(screen.queryByText('Billing Interval')).not.toBeInTheDocument();
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
    expect(screen.queryByText('Next Billing Date')).not.toBeInTheDocument();
  });

  it('says so, and offers "Choose Plan", when the community has no plan', async () => {
    serve(null, standing({ payer: 'platform_invoice', paid_until: null, member_limit: null, plan: null }));

    render(<BillingPage />);

    await waitFor(() => expect(screen.getByText('This community has no plan yet.')).toBeInTheDocument());
    expect(screen.getAllByRole('link', { name: /choose plan/i }).length).toBeGreaterThan(0);
  });

  it('tells a community that pays the community above it that nothing is arranged here', async () => {
    serve(
      subscription({ stripe_subscription_id: null, stripe_status: null, has_card_subscription: false }),
      standing({ payer: 'parent', plan: { ...standing().plan, terms: 'hub' } }),
    );

    render(<BillingPage />);

    await waitFor(() => expect(screen.getByText(/pays the community above it/i)).toBeInTheDocument());
    expect(screen.getByText('Local')).toBeInTheDocument();
    // Its plan and payments are its hub's: no platform plan picker, invoices or upgrade request.
    expect(screen.queryByRole('link', { name: /change plan/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /view invoices/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request upgrade/i })).not.toBeInTheDocument();
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

  it('keeps the plan and "Manage Payment" on screen for a card payer whose card has failed, and says what to do', async () => {
    // Stripe "past due" is recorded as `expired`. The page then said "No
    // subscription" and hid the only way to update the card.
    serve(subscription({ status: 'expired', stripe_status: 'past_due' }), standing({ overdue_days: 3 }));

    render(<BillingPage />);

    await waitFor(() => expect(screen.getByText('Local')).toBeInTheDocument());
    expect(screen.getByText(/last card payment did not go through/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /manage payment/i })).toBeInTheDocument();
    // "Past Due", not "Expired": the plan has not ended. The days overdue are
    // on the admin banner above every admin page, not repeated here.
    expect(screen.getByText('Past Due')).toBeInTheDocument();
    expect(screen.queryByText('Expired')).not.toBeInTheDocument();
    expect(screen.queryByText(/days overdue/i)).not.toBeInTheDocument();
    expect(screen.queryByText('This community has no plan yet.')).not.toBeInTheDocument();
  });

  it('shows no "Manage Payment" once the card subscription is over', async () => {
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
