// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── Stable mock refs (hoisted so they're available inside vi.mock factories) ──
const { mockToast, mockConfirm, mockMemberPremiumApi, mockAdminDonations } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  mockConfirm: vi.fn(async () => true),
  mockMemberPremiumApi: {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    createConnectOnboardingLink: vi.fn(),
    listTiers: vi.fn(),
    createTier: vi.fn(),
    updateTier: vi.fn(),
    deleteTier: vi.fn(),
    syncStripe: vi.fn(),
    getTier: vi.fn(),
    listSubscribers: vi.fn(),
  },
  mockAdminDonations: {
    financeOverview: vi.fn(),
    disputes: vi.fn(),
    giftAidExport: vi.fn(),
    annualReceiptsExport: vi.fn(),
  },
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

// ── memberPremiumAdminApi mock ────────────────────────────────────────────────
vi.mock('@/admin/api/memberPremiumApi', () => ({
  memberPremiumAdminApi: mockMemberPremiumApi,
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminDonations: mockAdminDonations,
}));

// ── useConfirm mock ───────────────────────────────────────────────────────────
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...actual,
    useConfirm: () => mockConfirm,
  };
});

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { MemberPremiumAdminPage } from './MemberPremiumAdminPage';
import userEvent from '@testing-library/user-event';

const TIER_A = {
  id: 1,
  tenant_id: 2,
  slug: 'gold',
  name: 'Gold',
  description: 'Gold tier',
  monthly_price_cents: 999,
  yearly_price_cents: 9900,
  stripe_price_id_monthly: 'price_m1',
  stripe_price_id_yearly: 'price_y1',
  features: ['Feature A', 'Feature B'],
  sort_order: 1,
  is_active: true,
  active_subscriber_count: 7,
};

describe('MemberPremiumAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMemberPremiumApi.getSettings.mockResolvedValue({
      data: {
        settings: {
          stripe_connect_account_id: '',
          payment_route: 'platform_default',
          account_status: {
            state: 'not_connected',
            charges_enabled: false,
            payouts_enabled: false,
            details_submitted: false,
            requirements_due: [],
            disabled_reason: null,
            error: null,
          },
        },
      },
    });
    mockAdminDonations.financeOverview.mockResolvedValue({
      data: {
        overview: {
          totals: {
            completed_cents: 3500,
            refunded_cents: 0,
            pending_cents: 1000,
            failed_count: 1,
          },
          routing: {
            platform_fallback_cents: 1000,
            tenant_connect_cents: 2500,
            platform_fallback_count: 1,
            tenant_connect_count: 1,
          },
          gift_aid: {
            ready_cents: 1000,
            ready_count: 1,
          },
          recurring: {
            active_count: 7,
            past_due_count: 1,
            canceled_count: 2,
          },
          disputes: {
            open_count: 1,
          },
          receipts: {
            failed_email_count: 2,
          },
        },
      },
    });
    mockAdminDonations.giftAidExport.mockResolvedValue(undefined);
    mockAdminDonations.annualReceiptsExport.mockResolvedValue(undefined);
  });

  it('shows loading spinner while tiers are fetching', () => {
    mockMemberPremiumApi.listTiers.mockReturnValue(new Promise(() => {}));
    render(<MemberPremiumAdminPage />);
    const statuses = screen.getAllByRole('status');
    const spinner = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(spinner).toBeDefined();
  });

  it('presents the admin surface as donations and support', async () => {
    mockMemberPremiumApi.listTiers.mockResolvedValueOnce({ data: { tiers: [TIER_A] } });
    render(<MemberPremiumAdminPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Donations & Support' })).toBeInTheDocument();
      expect(screen.getByText(/recognition/i)).toBeInTheDocument();
    });
  });

  it('summarises a connected Stripe account and links to the Stripe account page', async () => {
    mockMemberPremiumApi.getSettings.mockResolvedValueOnce({
      data: {
        settings: {
          stripe_connect_account_id: 'acct_test_123456',
          payment_route: 'tenant_connect',
          account_status: {
            state: 'ready',
            charges_enabled: true,
            payouts_enabled: true,
            details_submitted: true,
            requirements_due: [],
            disabled_reason: null,
            error: null,
          },
        },
      },
    });
    mockMemberPremiumApi.listTiers.mockResolvedValueOnce({ data: { tiers: [TIER_A] } });
    render(<MemberPremiumAdminPage />);

    await waitFor(() => {
      expect(screen.getAllByText(/this community's stripe account/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/ready/i).length).toBeGreaterThan(0);
    });
    // Setup moved to its own page so communities without Donations & Support
    // can reach it; this page only links there.
    expect(screen.getByRole('link', { name: /manage stripe account/i })).toHaveAttribute('href', '/test/admin/stripe-account');
    expect(screen.queryByRole('button', { name: /onboarding/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /account id/i })).not.toBeInTheDocument();
  });

  it('shows donation finance operations and export controls', async () => {
    const user = userEvent.setup();
    mockMemberPremiumApi.listTiers.mockResolvedValueOnce({ data: { tiers: [TIER_A] } });
    render(<MemberPremiumAdminPage />);

    await waitFor(() => {
      expect(screen.getByText(/finance operations/i)).toBeInTheDocument();
      expect(screen.getByText(/paid into your stripe account/i)).toBeInTheDocument();
      expect(screen.getByText(/gift aid ready/i)).toBeInTheDocument();
      expect(screen.getByText(/open disputes/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /export gift aid/i }));
    await user.click(screen.getByRole('button', { name: /export annual receipts/i }));

    expect(mockAdminDonations.giftAidExport).toHaveBeenCalledTimes(1);
    expect(mockAdminDonations.annualReceiptsExport).toHaveBeenCalledWith(new Date().getFullYear());
  });

  it('warns when Connect is configured but payments are falling back to the platform account', async () => {
    mockMemberPremiumApi.getSettings.mockResolvedValueOnce({
      data: {
        settings: {
          stripe_connect_account_id: 'acct_test_123456',
          payment_route: 'platform_default',
          fallback_reason: 'stripe_connect_not_ready',
          account_status: {
            state: 'restricted',
            charges_enabled: false,
            payouts_enabled: false,
            details_submitted: false,
            requirements_due: ['external_account'],
            disabled_reason: 'requirements.past_due',
            error: null,
          },
        },
      },
    });
    mockMemberPremiumApi.listTiers.mockResolvedValueOnce({ data: { tiers: [TIER_A] } });
    render(<MemberPremiumAdminPage />);

    await waitFor(() => {
      expect(screen.getAllByText(/platform's stripe account/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/not ready yet/i)).toBeInTheDocument();
    });
  });

  it('shows empty state when no tiers exist', async () => {
    mockMemberPremiumApi.listTiers.mockResolvedValue({ data: { tiers: [] } });
    render(<MemberPremiumAdminPage />);
    await waitFor(() => {
      expect(screen.getByText(/no support levels/i)).toBeInTheDocument();
    });
  });

  it('renders tier name in table when tiers are loaded', async () => {
    mockMemberPremiumApi.listTiers.mockResolvedValue({ data: { tiers: [TIER_A] } });
    render(<MemberPremiumAdminPage />);
    await waitFor(() => {
      expect(screen.getByText('Gold')).toBeInTheDocument();
    });
  });

  it('renders tier slug and price cells', async () => {
    mockMemberPremiumApi.listTiers.mockResolvedValue({ data: { tiers: [TIER_A] } });
    render(<MemberPremiumAdminPage />);
    await waitFor(() => {
      expect(screen.getByText('gold')).toBeInTheDocument();
      // 999 cents → "9.99"
      expect(screen.getByText('9.99')).toBeInTheDocument();
    });
  });

  it('shows "Synced" chip when stripe IDs are present', async () => {
    mockMemberPremiumApi.listTiers.mockResolvedValue({ data: { tiers: [TIER_A] } });
    render(<MemberPremiumAdminPage />);
    await waitFor(() => {
      expect(screen.getByText(/stripe.synced|synced/i)).toBeInTheDocument();
    });
  });

  // Prices made in the platform account stop being the ones checkout uses
  // once the community's own Stripe account is live, so "Synced" would be a
  // false reassurance until Sync to Stripe (or the first checkout) re-creates them.
  it('shows "Needs sync" when the prices live in the platform account but payments now go to the community account', async () => {
    mockMemberPremiumApi.getSettings.mockResolvedValueOnce({
      data: {
        settings: {
          stripe_connect_account_id: 'acct_test_123456',
          active_stripe_account_id: 'acct_test_123456',
          payment_route: 'tenant_connect',
          account_status: {
            state: 'ready',
            charges_enabled: true,
            payouts_enabled: true,
            details_submitted: true,
            requirements_due: [],
            disabled_reason: null,
            error: null,
          },
        },
      },
    });
    mockMemberPremiumApi.listTiers.mockResolvedValue({
      data: { tiers: [{ ...TIER_A, stripe_price_account_id: 'platform_default' }] },
    });
    render(<MemberPremiumAdminPage />);
    await waitFor(() => {
      expect(screen.getByText(/needs sync/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/^synced$/i)).not.toBeInTheDocument();
  });

  it('shows "Synced" when the prices live in the community account that payments go to', async () => {
    mockMemberPremiumApi.getSettings.mockResolvedValueOnce({
      data: {
        settings: {
          stripe_connect_account_id: 'acct_test_123456',
          active_stripe_account_id: 'acct_test_123456',
          payment_route: 'tenant_connect',
          account_status: {
            state: 'ready',
            charges_enabled: true,
            payouts_enabled: true,
            details_submitted: true,
            requirements_due: [],
            disabled_reason: null,
            error: null,
          },
        },
      },
    });
    mockMemberPremiumApi.listTiers.mockResolvedValue({
      data: { tiers: [{ ...TIER_A, stripe_price_account_id: 'acct_test_123456' }] },
    });
    render(<MemberPremiumAdminPage />);
    await waitFor(() => {
      expect(screen.getByText(/^synced$/i)).toBeInTheDocument();
    });
  });

  it('shows "Needs sync" chip when stripe IDs are missing', async () => {
    const unsynced = {
      ...TIER_A,
      stripe_price_id_monthly: null,
      stripe_price_id_yearly: null,
    };
    mockMemberPremiumApi.listTiers.mockResolvedValue({ data: { tiers: [unsynced] } });
    render(<MemberPremiumAdminPage />);
    await waitFor(() => {
      expect(screen.getByText(/needs_sync|needs sync/i)).toBeInTheDocument();
    });
  });

  it('opens create modal when the new support level button is pressed', async () => {
    mockMemberPremiumApi.listTiers.mockResolvedValue({ data: { tiers: [] } });
    render(<MemberPremiumAdminPage />);
    await waitFor(() => screen.getByText(/new support level/i));

    fireEvent.click(screen.getByText(/new support level/i));
    await waitFor(() => {
      // Modal opens — the save/create button becomes visible
      const createBtns = screen.getAllByText(/create support level/i);
      expect(createBtns.length).toBeGreaterThan(0);
    });
  });

  it('calls createTier and reloads on save with valid form data', async () => {
    const user = userEvent.setup();
    mockMemberPremiumApi.listTiers.mockResolvedValue({ data: { tiers: [] } });
    mockMemberPremiumApi.createTier.mockResolvedValueOnce({ data: { tier: TIER_A } });

    render(<MemberPremiumAdminPage />);
    await waitFor(() => screen.getByText(/new support level/i));
    await user.click(screen.getByText(/new support level/i));

    // Fill in required fields in the modal
    await waitFor(() => screen.getAllByRole('textbox'));

    // Fill name and slug fields inside the modal.
    const textboxes = screen.getAllByRole('textbox');
    fireEvent.change(textboxes[0], { target: { value: 'Gold' } });
    fireEvent.change(textboxes[1], { target: { value: 'gold' } });

    await user.click(screen.getByRole('button', { name: /create support level/i }));

    await waitFor(() => {
      expect(mockMemberPremiumApi.createTier).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Gold', slug: 'gold' }),
      );
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows validation error when slug is empty on save', async () => {
    mockMemberPremiumApi.listTiers.mockResolvedValue({ data: { tiers: [] } });
    render(<MemberPremiumAdminPage />);
    await waitFor(() => screen.getByText(/new support level/i));
    fireEvent.click(screen.getByText(/new support level/i));

    await waitFor(() => screen.getByText(/create support level/i));
    fireEvent.click(screen.getByText(/create support level/i));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
      expect(mockMemberPremiumApi.createTier).not.toHaveBeenCalled();
    });
  });

  it('calls syncStripe when Sync Stripe button is clicked', async () => {
    mockMemberPremiumApi.listTiers.mockResolvedValue({ data: { tiers: [TIER_A] } });
    mockMemberPremiumApi.syncStripe.mockResolvedValueOnce({ data: { tier: TIER_A } });

    render(<MemberPremiumAdminPage />);
    await waitFor(() => screen.getByText('Gold'));

    // The sync button label is translated — find by partial aria-label match
    const allButtons = screen.getAllByRole('button');
    // The icon-only sync button has aria-label containing the translation key
    const syncBtn = allButtons.find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('sync') ||
             b.getAttribute('aria-label')?.includes('actions.sync_stripe'),
    );
    expect(syncBtn).toBeDefined();
    fireEvent.click(syncBtn!);

    await waitFor(() => {
      expect(mockMemberPremiumApi.syncStripe).toHaveBeenCalledWith(TIER_A.id);
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('does not show a synced toast when Stripe sync returns a tier that still needs sync', async () => {
    const unsynced = {
      ...TIER_A,
      stripe_price_id_monthly: null,
      stripe_price_id_yearly: null,
    };
    mockMemberPremiumApi.listTiers.mockResolvedValue({ data: { tiers: [unsynced] } });
    mockMemberPremiumApi.syncStripe.mockResolvedValueOnce({ data: { tier: unsynced } });

    render(<MemberPremiumAdminPage />);
    await waitFor(() => screen.getByText('Gold'));

    const syncBtn = screen.getAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('sync') ||
             b.getAttribute('aria-label')?.includes('actions.sync_stripe'),
    );
    expect(syncBtn).toBeDefined();
    fireEvent.click(syncBtn!);

    await waitFor(() => {
      expect(mockMemberPremiumApi.syncStripe).toHaveBeenCalledWith(TIER_A.id);
      expect(mockToast.success).not.toHaveBeenCalled();
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('calls deleteTier after confirm dialog and reloads', async () => {
    mockMemberPremiumApi.listTiers.mockResolvedValue({ data: { tiers: [TIER_A] } });
    mockMemberPremiumApi.deleteTier.mockResolvedValueOnce({ data: { deleted: true } });
    mockConfirm.mockResolvedValueOnce(true);

    render(<MemberPremiumAdminPage />);
    await waitFor(() => screen.getByText('Gold'));

    const allButtons = screen.getAllByRole('button');
    const deleteBtn = allButtons.find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('delete') ||
             b.getAttribute('aria-label')?.includes('actions.delete'),
    );
    expect(deleteBtn).toBeDefined();
    fireEvent.click(deleteBtn!);

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalled();
      expect(mockMemberPremiumApi.deleteTier).toHaveBeenCalledWith(TIER_A.id);
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('does not call deleteTier when confirm dialog is cancelled', async () => {
    mockMemberPremiumApi.listTiers.mockResolvedValue({ data: { tiers: [TIER_A] } });
    // IMPORTANT: mockConfirm.mockResolvedValueOnce(false) must be set BEFORE mockConfirm is used
    // by the previous test — use a fresh setup here
    mockConfirm.mockResolvedValueOnce(false);

    render(<MemberPremiumAdminPage />);
    await waitFor(() => {
      // Use getAllByText in case the text appears in multiple places
      const goldEls = screen.queryAllByText('Gold');
      expect(goldEls.length).toBeGreaterThan(0);
    });

    // Find delete button by aria-label
    const allButtons = screen.getAllByRole('button');
    const deleteBtn = allButtons.find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('delete') ||
             b.getAttribute('aria-label')?.includes('actions.delete'),
    );
    expect(deleteBtn).toBeDefined();
    fireEvent.click(deleteBtn!);

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalled();
      expect(mockMemberPremiumApi.deleteTier).not.toHaveBeenCalled();
    });
  });
});
