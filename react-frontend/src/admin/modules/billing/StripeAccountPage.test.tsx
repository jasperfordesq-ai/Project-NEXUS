// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

const { mockToast, mockConfirm, mockApi, tenantState } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  mockConfirm: vi.fn(async () => true),
  mockApi: {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    createConnectOnboardingLink: vi.fn(),
    createConnectDashboardLink: vi.fn(),
  },
  tenantState: { features: { member_premium: true, volunteering: true } as Record<string, boolean> },
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn((key: string) => tenantState.features[key] ?? false),
      hasModule: vi.fn((_key: string) => true),
    }),
  }),
);

vi.mock('@/admin/api/memberPremiumApi', () => ({
  memberPremiumAdminApi: mockApi,
}));

vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useConfirm: () => mockConfirm };
});

import { StripeAccountPage } from './StripeAccountPage';

const STATUS_NOT_CONNECTED = {
  state: 'not_connected' as const,
  charges_enabled: false,
  payouts_enabled: false,
  details_submitted: false,
  requirements_due: [] as string[],
  disabled_reason: null,
  error: null,
};

function settingsResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      settings: {
        stripe_connect_account_id: '',
        active_stripe_account_id: '',
        payment_route: 'platform_default',
        configured_payment_route: 'platform_default',
        fallback_reason: null,
        account_status: STATUS_NOT_CONNECTED,
        ...overrides,
      },
    },
  };
}

describe('StripeAccountPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tenantState.features = { member_premium: true, volunteering: true };
    mockApi.getSettings.mockResolvedValue(settingsResponse());
    window.history.replaceState({}, '', '/test/admin/stripe-account');
  });

  it('offers to connect when nothing is connected and says payments use the platform account', async () => {
    render(<StripeAccountPage />);

    expect(await screen.findByRole('button', { name: /connect stripe/i })).toBeInTheDocument();
    expect(screen.getAllByText(/platform's stripe account/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /disconnect/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open stripe dashboard/i })).not.toBeInTheDocument();
  });

  it('starts Stripe setup with return and refresh addresses pointing back at this page', async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, assign, origin: 'https://app.test', pathname: '/test/admin/stripe-account' },
    });
    mockApi.createConnectOnboardingLink.mockResolvedValueOnce({
      success: true,
      data: { settings: settingsResponse().data.settings, onboarding_url: 'https://connect.stripe.test/setup/acct_1' },
    });

    try {
      const user = userEvent.setup();
      render(<StripeAccountPage />);
      await user.click(await screen.findByRole('button', { name: /connect stripe/i }));

      await waitFor(() => expect(assign).toHaveBeenCalledWith('https://connect.stripe.test/setup/acct_1'));
      expect(mockApi.createConnectOnboardingLink).toHaveBeenCalledWith({
        return_url: 'https://app.test/test/admin/stripe-account?stripe_connect=return',
        refresh_url: 'https://app.test/test/admin/stripe-account?stripe_connect=refresh',
      });
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('shows a ready account with its id, a dashboard button and a disconnect button', async () => {
    mockApi.getSettings.mockResolvedValue(settingsResponse({
      stripe_connect_account_id: 'acct_ready_123',
      active_stripe_account_id: 'acct_ready_123',
      payment_route: 'tenant_connect',
      configured_payment_route: 'tenant_connect',
      account_status: { ...STATUS_NOT_CONNECTED, state: 'ready', charges_enabled: true, payouts_enabled: true, details_submitted: true },
    }));

    render(<StripeAccountPage />);

    expect(await screen.findByRole('button', { name: /open stripe dashboard/i })).toBeInTheDocument();
    expect(screen.getByText('acct_ready_123')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect stripe/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /finish setup/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(/this community's stripe account/i).length).toBeGreaterThan(0);
  });

  it('tells the admin to finish setup, and how many items Stripe still needs, when the account is restricted', async () => {
    mockApi.getSettings.mockResolvedValue(settingsResponse({
      stripe_connect_account_id: 'acct_restricted_1',
      fallback_reason: 'stripe_connect_not_ready',
      account_status: {
        ...STATUS_NOT_CONNECTED,
        state: 'restricted',
        details_submitted: true,
        requirements_due: ['external_account', 'business_profile.url'],
        disabled_reason: 'requirements.past_due',
      },
    }));

    render(<StripeAccountPage />);

    expect(await screen.findByRole('button', { name: /finish setup in stripe/i })).toBeInTheDocument();
    expect(screen.getByText(/2 items still need your attention/i)).toBeInTheDocument();
    expect(screen.getByText(/needs more information/i)).toBeInTheDocument();
  });

  it('disconnects only after confirmation and reports the new route', async () => {
    mockApi.getSettings.mockResolvedValue(settingsResponse({
      stripe_connect_account_id: 'acct_ready_123',
      active_stripe_account_id: 'acct_ready_123',
      payment_route: 'tenant_connect',
      account_status: { ...STATUS_NOT_CONNECTED, state: 'ready', charges_enabled: true, payouts_enabled: true, details_submitted: true },
    }));
    mockApi.updateSettings.mockResolvedValueOnce(settingsResponse());

    const user = userEvent.setup();
    render(<StripeAccountPage />);
    await user.click(await screen.findByRole('button', { name: /disconnect/i }));

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockApi.updateSettings).toHaveBeenCalledWith({ stripe_connect_account_id: '' }));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: /connect stripe/i })).toBeInTheDocument();
  });

  it('does not disconnect when the admin cancels the confirmation', async () => {
    mockConfirm.mockResolvedValueOnce(false);
    mockApi.getSettings.mockResolvedValue(settingsResponse({
      stripe_connect_account_id: 'acct_ready_123',
      active_stripe_account_id: 'acct_ready_123',
      payment_route: 'tenant_connect',
      account_status: { ...STATUS_NOT_CONNECTED, state: 'ready', charges_enabled: true, payouts_enabled: true, details_submitted: true },
    }));

    const user = userEvent.setup();
    render(<StripeAccountPage />);
    await user.click(await screen.findByRole('button', { name: /disconnect/i }));

    expect(mockApi.updateSettings).not.toHaveBeenCalled();
  });

  it('welcomes the admin back from Stripe and cleans the address bar', async () => {
    window.history.replaceState({}, '', '/test/admin/stripe-account?stripe_connect=return');

    render(<StripeAccountPage />);

    await waitFor(() => expect(mockToast.success).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(mockApi.getSettings).toHaveBeenCalled();
  });

  it('explains that the setup link expired when Stripe sends the admin back for a fresh one', async () => {
    window.history.replaceState({}, '', '/test/admin/stripe-account?stripe_connect=refresh');

    render(<StripeAccountPage />);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('links to donation support levels only when that feature is on', async () => {
    tenantState.features = { member_premium: false, volunteering: true };

    render(<StripeAccountPage />);

    await screen.findByRole('button', { name: /connect stripe/i });
    expect(screen.queryByRole('link', { name: /support levels/i })).not.toBeInTheDocument();
  });
});
