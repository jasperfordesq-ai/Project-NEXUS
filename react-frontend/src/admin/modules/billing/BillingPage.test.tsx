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

// ── billingApi mock ───────────────────────────────────────────────────────────
vi.mock('@/admin/api/billingApi', () => ({
  billingApi: mockBillingApi,
}));

// ── api mock (for upgrade-request POST) ──────────────────────────────────────
vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { BillingPage } from './BillingPage';

const ACTIVE_SUB = {
  id: 1,
  plan_id: 2,
  plan_name: 'Community Pro',
  plan_tier_level: 2,
  status: 'active' as const,
  billing_interval: 'monthly' as const,
  current_period_start: '2026-01-01T00:00:00Z',
  current_period_end: '2026-02-01T00:00:00Z',
  trial_ends_at: null,
  cancel_at_period_end: false,
  stripe_subscription_id: 'sub_123',
  user_count: 30,
  plan: { max_users: 100 },
};

describe('BillingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading spinner while subscription is fetching', () => {
    // Never resolves so stays in loading state
    mockBillingApi.getSubscription.mockReturnValue(new Promise(() => {}));
    render(<BillingPage />);
    const statuses = screen.getAllByRole('status');
    const spinner = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(spinner).toBeDefined();
  });

  it('shows "no subscription" state when API returns no data', async () => {
    mockBillingApi.getSubscription.mockResolvedValueOnce({ success: false, data: null });
    render(<BillingPage />);
    await waitFor(() => {
      // Multiple "Choose plan" elements may exist (card + action link), so use getAllByText
      const matches = screen.getAllByText(/no_subscription|no subscription|choose plan|Choose plan/i);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it('renders plan name and status chip for active subscription', async () => {
    mockBillingApi.getSubscription.mockResolvedValueOnce({ success: true, data: ACTIVE_SUB });
    render(<BillingPage />);
    await waitFor(() => {
      expect(screen.getByText('Community Pro')).toBeInTheDocument();
    });
  });

  it('renders usage progress bar when user_count and max_users are set', async () => {
    mockBillingApi.getSubscription.mockResolvedValueOnce({ success: true, data: ACTIVE_SUB });
    render(<BillingPage />);
    await waitFor(() => {
      // 30/100 = 30%
      expect(screen.getByText('30%')).toBeInTheDocument();
    });
  });

  it('shows "unlimited users" when max_users is null', async () => {
    mockBillingApi.getSubscription.mockResolvedValueOnce({
      success: true,
      data: { ...ACTIVE_SUB, plan: { max_users: null } },
    });
    render(<BillingPage />);
    await waitFor(() => {
      expect(screen.getByText(/unlimited_users|unlimited/i)).toBeInTheDocument();
    });
  });

  it('shows over-limit warning when usage >= 100%', async () => {
    mockBillingApi.getSubscription.mockResolvedValueOnce({
      success: true,
      data: { ...ACTIVE_SUB, user_count: 100 },
    });
    render(<BillingPage />);
    await waitFor(() => {
      // 100/100 = 100% → danger-colored warning text visible (rendered via i18n key or fallback)
      // Also the progress bar shows 100%
      expect(screen.getByText('100%')).toBeInTheDocument();
      // Look for any danger-colored text (the warning paragraph)
      const container = document.body;
      const dangerTexts = container.querySelectorAll('.text-danger');
      expect(dangerTexts.length).toBeGreaterThan(0);
    });
  });

  it('keeps the plan and "Manage Payment" on screen for a card payer whose card has failed', async () => {
    // Stripe "past due" is recorded as `expired`. The page then said "No
    // subscription" and hid the only way to update the card.
    mockBillingApi.getSubscription.mockResolvedValue({
      success: true,
      data: { ...ACTIVE_SUB, status: 'expired', has_card_subscription: true },
    });

    render(<BillingPage />);

    await waitFor(() => expect(screen.getByText('Community Pro')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /manage payment/i })).toBeInTheDocument();
    expect(screen.queryByText(/^No subscription$/i)).not.toBeInTheDocument();
  });

  it('shows no "Manage Payment" once the subscription is over', async () => {
    mockBillingApi.getSubscription.mockResolvedValue({
      success: true,
      data: { ...ACTIVE_SUB, status: 'cancelled', has_card_subscription: false },
    });

    render(<BillingPage />);

    await waitFor(() => expect(screen.getByText(/No subscription/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /manage payment/i })).not.toBeInTheDocument();
  });

  it('calls billingApi.createPortal and opens portal URL', async () => {
    mockBillingApi.getSubscription.mockResolvedValueOnce({ success: true, data: ACTIVE_SUB });
    mockBillingApi.createPortal.mockResolvedValueOnce({
      success: true,
      data: { portal_url: 'https://billing.stripe.com/portal/test' },
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(<BillingPage />);
    await waitFor(() => screen.getByText(/manage_payment|Manage payment/i));

    fireEvent.click(screen.getByText(/manage_payment|Manage payment/i));
    await waitFor(() => {
      expect(mockBillingApi.createPortal).toHaveBeenCalled();
      expect(openSpy).toHaveBeenCalledWith(
        'https://billing.stripe.com/portal/test',
        '_blank',
        'noopener,noreferrer',
      );
    });
    openSpy.mockRestore();
  });

  it('shows toast error when portal creation fails', async () => {
    mockBillingApi.getSubscription.mockResolvedValueOnce({ success: true, data: ACTIVE_SUB });
    mockBillingApi.createPortal.mockRejectedValueOnce(new Error('Network error'));

    render(<BillingPage />);
    await waitFor(() => screen.getByText(/manage_payment|Manage payment/i));

    fireEvent.click(screen.getByText(/manage_payment|Manage payment/i));
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('sends upgrade-request POST and shows success toast', async () => {
    mockBillingApi.getSubscription.mockResolvedValueOnce({ success: true, data: ACTIVE_SUB });
    mockApi.post.mockResolvedValueOnce({ success: true });

    render(<BillingPage />);
    await waitFor(() => screen.getByText(/request_upgrade|Request upgrade/i));

    // click "Request upgrade" to open modal
    const upgradeBtn = screen.getAllByText(/request_upgrade|Request upgrade/i)[0];
    fireEvent.click(upgradeBtn);

    // send request button in modal footer
    await waitFor(() => screen.getByText(/send_request|Send request/i));
    fireEvent.click(screen.getByText(/send_request|Send request/i));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        '/v2/admin/billing/upgrade-request',
        expect.objectContaining({ message: expect.any(String) }),
      );
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows "change plan" action link regardless of subscription', async () => {
    mockBillingApi.getSubscription.mockResolvedValueOnce({ success: false, data: null });
    render(<BillingPage />);
    await waitFor(() => {
      expect(screen.getByText(/change_plan|Change plan/i)).toBeInTheDocument();
    });
  });
});
