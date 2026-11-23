// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Mock billingApi ────────────────────────────────────────────────────────
const mockBillingApi = vi.hoisted(() => ({
  getPlans: vi.fn(),
  getSubscription: vi.fn(),
  createCheckout: vi.fn(),
  changePlan: vi.fn(),
}));

vi.mock('../../api/billingApi', () => ({
  billingApi: mockBillingApi,
}));

// ─── Mock contexts ───────────────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Sample data ─────────────────────────────────────────────────────────────
// The server's shape, key for key: GET /v2/billing/plans
// (AdminBillingController::getPlansPublic), pinned from the other end by
// tests/Laravel/Feature/Billing/PublicPlansContractTest.php. Until 21 Nov 2026
// this fixture was invented (`plan_id` on the subscription, no member number,
// no setup fee, no `charge`), and the screen was wrong in every place the
// invention differed from the server.
const plan = (over: Record<string, unknown>) => ({
  description: null,
  features: [],
  max_users: null,
  price_monthly: 0,
  price_yearly: 0,
  setup_fee: 0,
  price_monthly_gbp: null,
  price_yearly_gbp: null,
  setup_fee_gbp: null,
  max_communities: null,
  storage_gb: null,
  emails_per_month: null,
  is_active: 1,
  charge: {
    monthly: { currency: 'eur', amount: 0, setup_fee: 0 },
    yearly: { currency: 'eur', amount: 0, setup_fee: 0 },
  },
  ...over,
});

const PLANS = [
  plan({
    id: 1,
    name: 'Free',
    slug: 'free',
    description: 'Free tier',
    tier_level: 0,
    features: ['Unlimited members'],
  }),
  plan({
    id: 2,
    name: 'Pro',
    slug: 'pro',
    description: 'Pro tier',
    tier_level: 1,
    max_users: 500,
    price_monthly: 29,
    price_yearly: 290,
    features: ['Everything in Free', 'Analytics'],
    charge: {
      monthly: { currency: 'eur', amount: 29, setup_fee: 0 },
      yearly: { currency: 'eur', amount: 290, setup_fee: 0 },
    },
  }),
];

/** The standard "Local" package as a euro and as a pound community is quoted it. */
const local = (currency: 'eur' | 'gbp') => plan({
  id: 16,
  name: 'Local',
  slug: 'local',
  description: '101 to 300 active members. Best for established local timebanks that have outgrown a pilot.',
  tier_level: 2,
  max_users: 300,
  price_monthly: 229,
  price_yearly: 2290,
  setup_fee: 750,
  price_monthly_gbp: 199,
  price_yearly_gbp: 1990,
  setup_fee_gbp: 645,
  max_communities: 1,
  storage_gb: 10,
  emails_per_month: 20000,
  features: ['1 community', '10 GB storage'],
  charge: currency === 'gbp'
    ? { monthly: { currency: 'gbp', amount: 199, setup_fee: 645 }, yearly: { currency: 'gbp', amount: 1990, setup_fee: 645 } }
    : { monthly: { currency: 'eur', amount: 229, setup_fee: 750 }, yearly: { currency: 'eur', amount: 2290, setup_fee: 750 } },
});

import { PlanSelector } from './PlanSelector';

describe('PlanSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading spinner while fetching plans', async () => {
    // Never resolve so we stay in loading state
    mockBillingApi.getPlans.mockReturnValue(new Promise(() => {}));
    mockBillingApi.getSubscription.mockReturnValue(new Promise(() => {}));

    render(<PlanSelector />);

    const spinner = screen
      .getAllByRole('status')
      .find((el) => el.getAttribute('aria-busy') === 'true');
    expect(spinner).toBeInTheDocument();
  });

  it('renders plan cards after loading', async () => {
    mockBillingApi.getPlans.mockResolvedValue({ success: true, data: PLANS });
    mockBillingApi.getSubscription.mockRejectedValue(new Error('No subscription'));

    render(<PlanSelector />);

    await waitFor(() => {
      expect(screen.getByText('Free')).toBeInTheDocument();
      expect(screen.getByText('Pro')).toBeInTheDocument();
    });
  });

  it('shows empty message when no plans returned', async () => {
    mockBillingApi.getPlans.mockResolvedValue({ success: true, data: [] });
    mockBillingApi.getSubscription.mockRejectedValue(new Error('No subscription'));

    render(<PlanSelector />);

    await waitFor(() => {
      // Real i18n: "billing.no_plans" → "No plans"
      expect(screen.getByText(/No plans/i)).toBeInTheDocument();
    });
  });

  it('shows error toast when load fails', async () => {
    mockBillingApi.getPlans.mockRejectedValue(new Error('Server error'));
    mockBillingApi.getSubscription.mockRejectedValue(new Error('Server error'));

    render(<PlanSelector />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('monthly/yearly toggle switches billing interval label', async () => {
    const user = userEvent.setup();
    mockBillingApi.getPlans.mockResolvedValue({ success: true, data: PLANS });
    mockBillingApi.getSubscription.mockRejectedValue(new Error('No subscription'));

    render(<PlanSelector />);

    // Wait for plans to load
    await waitFor(() => expect(screen.getByText('Free')).toBeInTheDocument());

    // Monthly is selected by default — "Per Month" text visible on plan cards
    // The text may be split across elements so use a flexible matcher
    expect(screen.getAllByText((content) => /per month/i.test(content)).length).toBeGreaterThan(0);

    // Click "Yearly" button — real i18n "Yearly"
    const yearlyBtn = screen.getByRole('button', { name: /^Yearly/i });
    await user.click(yearlyBtn);

    // "Per Year" text should appear
    await waitFor(() => {
      expect(screen.getAllByText((content) => /per year/i.test(content)).length).toBeGreaterThan(0);
    });
  });

  it('calls createCheckout and navigates on free plan activation', async () => {
    mockBillingApi.getPlans.mockResolvedValue({ success: true, data: PLANS });
    mockBillingApi.getSubscription.mockRejectedValue(new Error('No subscription'));
    mockBillingApi.createCheckout.mockResolvedValue({
      success: true,
      data: { activated: true, checkout_url: null },
    });

    const user = userEvent.setup();
    render(<PlanSelector />);

    await waitFor(() => expect(screen.getByText('Free')).toBeInTheDocument());

    // Find the subscribe button for the Free plan (not current, not blocked)
    const buttons = screen.getAllByRole('button', { name: /subscribe/i });
    await user.click(buttons[0]);

    await waitFor(() => {
      expect(mockBillingApi.createCheckout).toHaveBeenCalledWith(
        expect.objectContaining({ plan_id: 1 })
      );
      expect(mockToast.success).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/test/admin/billing');
    });
  });

  it('shows checkout error toast when API returns failure', async () => {
    mockBillingApi.getPlans.mockResolvedValue({ success: true, data: PLANS });
    mockBillingApi.getSubscription.mockRejectedValue(new Error('No subscription'));
    mockBillingApi.createCheckout.mockResolvedValue({ success: false });

    const user = userEvent.setup();
    render(<PlanSelector />);

    await waitFor(() => expect(screen.getByText('Free')).toBeInTheDocument());

    const buttons = screen.getAllByRole('button', { name: /subscribe/i });
    await user.click(buttons[0]);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('marks current plan and disables its subscribe button', async () => {
    // `pay_plan_id` is the server's name (getSubscriptionDetails). The screen
    // read `plan_id`, which never arrives, so no plan was ever "Current" and a
    // card payer could subscribe to its own plan a second time.
    const subscription = {
      id: 10,
      pay_plan_id: 2,
      plan_name: 'Pro',
      plan_tier_level: 1,
      status: 'active',
      billing_interval: 'monthly',
      current_period_start: '2026-01-01',
      current_period_end: '2026-02-01',
      trial_ends_at: null,
      cancel_at_period_end: false,
      stripe_subscription_id: 'sub_123',
    };

    mockBillingApi.getPlans.mockResolvedValue({ success: true, data: PLANS });
    mockBillingApi.getSubscription.mockResolvedValue({ success: true, data: subscription });

    render(<PlanSelector />);

    await waitFor(() => expect(screen.getByText('Pro')).toBeInTheDocument());

    // "Current" chip should appear
    expect(screen.getAllByText(/current/i).length).toBeGreaterThan(0);

    // The Pro subscribe button should show "Current" label and be disabled
    // (HeroUI disabled buttons won't fire onPress — just confirm aria-disabled)
    const currentBtns = screen.getAllByRole('button', { name: /current/i });
    expect(currentBtns.length).toBeGreaterThan(0);

    // No live "Subscribe" is left: Pro is the current plan, and Free is a
    // downgrade from a paid plan ("Contact Support").
    expect(screen.queryByRole('button', { name: /subscribe/i })).not.toBeInTheDocument();
  });

  it('lets a card payer change plan on its existing card payment, after confirming', async () => {
    // A checkout always starts a NEW Stripe subscription. "Change plan" sent
    // a card payer through one, and both subscriptions were then charged.
    // A card payer now changes the subscription it has.
    const subscription = {
      id: 10,
      pay_plan_id: 16,
      plan_name: 'Local',
      plan_tier_level: 2,
      status: 'active',
      stripe_status: 'active',
      billing_interval: 'monthly',
      stripe_subscription_id: 'sub_123',
      has_card_subscription: true,
    };
    mockBillingApi.getPlans.mockResolvedValue({ success: true, data: [PLANS[1], local('eur')] });
    mockBillingApi.getSubscription.mockResolvedValue({ success: true, data: subscription });
    mockBillingApi.changePlan.mockResolvedValue({ success: true, data: { plan_id: 2, plan_name: 'Pro', billing_interval: 'monthly' } });

    const user = userEvent.setup();
    render(<PlanSelector />);

    await waitFor(() => expect(screen.getByText('Local')).toBeInTheDocument());

    expect(screen.getByText(/Choosing another plan changes that card payment/i)).toBeInTheDocument();
    // Never "Subscribe": that is a second card payment.
    expect(screen.queryByRole('button', { name: /^subscribe$/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^current$/i })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Change to this plan' }));

    // Money moves, so it is confirmed first, with what happens said plainly.
    expect(await screen.findByText('Change plan to Pro?')).toBeInTheDocument();
    expect(screen.getByText(/charged, or credited, on your next invoice/i)).toBeInTheDocument();
    expect(mockBillingApi.changePlan).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Change plan' }));

    await waitFor(() => {
      expect(mockBillingApi.changePlan).toHaveBeenCalledWith({ plan_id: 2, billing_interval: 'monthly' });
    });
    expect(mockBillingApi.createCheckout).not.toHaveBeenCalled();
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Plan changed to Pro'));
  });

  it('offers the same plan on the other period to a card payer', async () => {
    const subscription = {
      id: 10, pay_plan_id: 16, plan_name: 'Local', plan_tier_level: 2, status: 'active',
      stripe_status: 'active', billing_interval: 'monthly', stripe_subscription_id: 'sub_123', has_card_subscription: true,
    };
    mockBillingApi.getPlans.mockResolvedValue({ success: true, data: [local('eur')] });
    mockBillingApi.getSubscription.mockResolvedValue({ success: true, data: subscription });

    const user = userEvent.setup();
    render(<PlanSelector />);

    await waitFor(() => expect(screen.getByText('Local')).toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: /^current$/i })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /^Yearly/i }));

    // Monthly Local is what it has; yearly Local is a change it can make.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change to this plan' })).toBeInTheDocument());
  });

  it('shows the server\'s reason when a change of plan is refused, and keeps the dialog open', async () => {
    const subscription = {
      id: 10, pay_plan_id: 16, plan_name: 'Local', plan_tier_level: 2, status: 'active',
      stripe_status: 'active', billing_interval: 'monthly', stripe_subscription_id: 'sub_123', has_card_subscription: true,
    };
    mockBillingApi.getPlans.mockResolvedValue({ success: true, data: [PLANS[1], local('eur')] });
    mockBillingApi.getSubscription.mockResolvedValue({ success: true, data: subscription });
    mockBillingApi.changePlan.mockResolvedValue({ success: false, error: 'This plan allows up to 500 active members and this community has 612.' });

    const user = userEvent.setup();
    render(<PlanSelector />);

    await waitFor(() => expect(screen.getByText('Local')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Change to this plan' }));
    await user.click(await screen.findByRole('button', { name: 'Change plan' }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('This plan allows up to 500 active members and this community has 612.');
    });
    expect(screen.getByText('Change plan to Pro?')).toBeInTheDocument();
  });

  it('tells a card payer whose card has failed to put it right first, and offers no change', async () => {
    // A failed renewal is recorded as `expired`. The community is still on
    // that plan and Stripe is still collecting for it.
    const subscription = {
      id: 10,
      pay_plan_id: 16,
      plan_name: 'Local',
      plan_tier_level: 2,
      status: 'expired',
      stripe_status: 'past_due',
      billing_interval: 'monthly',
      stripe_subscription_id: 'sub_123',
      has_card_subscription: true,
    };
    mockBillingApi.getPlans.mockResolvedValue({ success: true, data: [PLANS[1], local('eur')] });
    mockBillingApi.getSubscription.mockResolvedValue({ success: true, data: subscription });

    render(<PlanSelector />);

    await waitFor(() => expect(screen.getByText('Local')).toBeInTheDocument());

    expect(screen.getByText(/put the card right before changing plan/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^current$/i })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^subscribe$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change to this plan' })).not.toBeInTheDocument();
    // A plan it cannot take by itself leads somewhere: the message box on
    // Billing. It was a greyed-out "Contact Support" button that did nothing.
    const ask = screen.getByRole('link', { name: 'Message the platform team' });
    expect(ask.getAttribute('href')).toContain('/admin/billing?message=1');
    expect(screen.queryByText('Contact Support')).not.toBeInTheDocument();
  });

  it('says nothing about card payments to a community with no card subscription', async () => {
    const subscription = {
      id: 10, pay_plan_id: 16, plan_name: 'Local', plan_tier_level: 2, status: 'active',
      stripe_subscription_id: null, has_card_subscription: false,
    };
    mockBillingApi.getPlans.mockResolvedValue({ success: true, data: [PLANS[1], local('eur')] });
    mockBillingApi.getSubscription.mockResolvedValue({ success: true, data: subscription });

    render(<PlanSelector />);

    await waitFor(() => expect(screen.getByText('Local')).toBeInTheDocument());

    expect(screen.queryByText(/pays by card/i)).not.toBeInTheDocument();
    // A plan given by hand: paying for another one by card is a first checkout.
    expect(screen.getAllByRole('button', { name: /subscribe/i })).toHaveLength(1);
  });

  it('says how many members a plan allows, from its own number', async () => {
    mockBillingApi.getPlans.mockResolvedValue({ success: true, data: [PLANS[0], local('eur')] });
    mockBillingApi.getSubscription.mockRejectedValue(new Error('No subscription'));

    render(<PlanSelector />);

    await waitFor(() => expect(screen.getByText('Local')).toBeInTheDocument());

    expect(screen.getByText('Up to 300 active members')).toBeInTheDocument();
    // A plan with no number says so, instead of saying nothing.
    expect(screen.getByText('No member limit')).toBeInTheDocument();
  });

  it('shows the one-off setup fee, and that it is added to the first card payment', async () => {
    mockBillingApi.getPlans.mockResolvedValue({ success: true, data: [local('eur')] });
    mockBillingApi.getSubscription.mockRejectedValue(new Error('No subscription'));

    render(<PlanSelector />);

    await waitFor(() => expect(screen.getByText('Local')).toBeInTheDocument());

    expect(screen.getByText('€229')).toBeInTheDocument();
    expect(screen.getByText('plus €750 one-off setup fee')).toBeInTheDocument();
    expect(screen.getByText(/setup fee is added to the first card payment/i)).toBeInTheDocument();
  });

  it('says "No setup fee" for a paid plan without one, and nothing about fees for a free plan', async () => {
    mockBillingApi.getPlans.mockResolvedValue({ success: true, data: PLANS });
    mockBillingApi.getSubscription.mockRejectedValue(new Error('No subscription'));

    render(<PlanSelector />);

    await waitFor(() => expect(screen.getByText('Pro')).toBeInTheDocument());

    // Pro only: the Free card has no fee line at all.
    expect(screen.getAllByText('No setup fee')).toHaveLength(1);
    expect(screen.queryByText(/added to the first card payment/i)).not.toBeInTheDocument();
  });

  it('quotes a pound community in pounds, as the server says it will be charged', async () => {
    // The fault: every price was formatted as euro. A pound community read
    // "€229.00" and Stripe charged £199.
    mockBillingApi.getPlans.mockResolvedValue({ success: true, data: [local('gbp')] });
    mockBillingApi.getSubscription.mockRejectedValue(new Error('No subscription'));

    render(<PlanSelector />);

    await waitFor(() => expect(screen.getByText('Local')).toBeInTheDocument());

    expect(screen.getByText('£199')).toBeInTheDocument();
    expect(screen.getByText('plus £645 one-off setup fee')).toBeInTheDocument();
    expect(screen.queryByText(/€/)).not.toBeInTheDocument();
  });

  it('on yearly, shows the first year with the setup fee and the renewal after it', async () => {
    const user = userEvent.setup();
    mockBillingApi.getPlans.mockResolvedValue({ success: true, data: [local('gbp')] });
    mockBillingApi.getSubscription.mockRejectedValue(new Error('No subscription'));

    render(<PlanSelector />);

    await waitFor(() => expect(screen.getByText('Local')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /^Yearly/i }));

    // The pricing page's own sum: £645 setup + £1,990 = £2,635.
    await waitFor(() => {
      expect(screen.getByText('Year one £2,635, then £1,990 a year')).toBeInTheDocument();
    });
    expect(screen.getByText('£1,990')).toBeInTheDocument();
  });

  it('puts a real number in the yearly saving, never a raw placeholder', async () => {
    mockBillingApi.getPlans.mockResolvedValue({ success: true, data: [local('eur')] });
    mockBillingApi.getSubscription.mockRejectedValue(new Error('No subscription'));

    render(<PlanSelector />);

    await waitFor(() => expect(screen.getByText('Local')).toBeInTheDocument());

    // Ten months' price for twelve: 17%.
    expect(screen.getByText('Save 17%')).toBeInTheDocument();
    expect(screen.queryByText(/\{\{/)).not.toBeInTheDocument();
  });

  it('shows the server\'s own reason when checkout is refused', async () => {
    mockBillingApi.getPlans.mockResolvedValue({ success: true, data: [local('eur')] });
    mockBillingApi.getSubscription.mockRejectedValue(new Error('No subscription'));
    mockBillingApi.createCheckout.mockResolvedValue({
      success: false,
      error: 'This community pays its parent community, not the platform.',
    });

    const user = userEvent.setup();
    render(<PlanSelector />);

    await waitFor(() => expect(screen.getByText('Local')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /subscribe/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('This community pays its parent community, not the platform.');
    });
  });
});
