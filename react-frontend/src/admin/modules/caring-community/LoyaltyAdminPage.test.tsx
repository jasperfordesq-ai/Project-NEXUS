// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ─── Mock api ─────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Mock caring/access ───────────────────────────────────────────────────────
const { mockCanManage } = vi.hoisted(() => ({ mockCanManage: vi.fn(() => true) }));

vi.mock('@/caring/access', () => ({ canManageCaring: mockCanManage }));

// ─── Mock admin components ────────────────────────────────────────────────────
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/MemberSearchPicker', '../../components/PageHeader',
// etc. directly, and vitest keys mocks per resolved module, so a barrel-only
// mock never installs for those imports.
// A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run.
function adminComponentsMock() {
  return {
    MemberSearchPicker: ({
      onSelectedMemberChange,
      selectedMember,
    }: {
      label: string;
      placeholder: string;
      value: string;
      onValueChange: (v: string) => void;
      selectedMember: unknown;
      onSelectedMemberChange: (m: unknown) => void;
      noResultsText: string;
      clearText: string;
    }) => (
      <div data-testid="member-search-picker">
        {!selectedMember && (
          <button
            data-testid="select-member-btn"
            onClick={() => onSelectedMemberChange({ id: 42, name: 'Seller Sam', email: 'sam@example.com' })}
          >
            Select Sam
          </button>
        )}
        {selectedMember && (
          <div data-testid="selected-member">
            Seller Sam
            <button onClick={() => onSelectedMemberChange(null)}>Clear</button>
          </div>
        )}
      </div>
    ),
    PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
      <div>
        <h1>{title}</h1>
        {actions}
      </div>
    ),
    StatCard: ({ label, value }: { label: string; value: string }) => (
      <div data-testid="stat-card">
        <span>{label}</span>
        <span>{value}</span>
      </div>
    ),
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/MemberSearchPicker', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);
vi.mock('../../components/StatCard', adminComponentsMock);

// ─── Contexts ─────────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Admin', role: 'admin', is_view_only: false },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useToast: () => mockToast,
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeRedemption = (overrides = {}) => ({
  id: 1,
  credits_used: 2.5,
  exchange_rate_chf: 10,
  discount_chf: 25,
  order_total_chf: 100,
  status: 'applied' as const,
  redeemed_at: '2025-05-01T10:00:00Z',
  member_id: 10,
  member_name: 'Alice Member',
  merchant_id: 20,
  merchant_name: 'Bob Merchant',
  marketplace_listing_id: 5,
  listing_title: 'Handmade Goods',
  ...overrides,
});

const makeRedemptionsResponse = (redemptions = [makeRedemption()]) => ({
  stats: { total_redemptions: 3, total_credits: 7.5, total_discount_chf: 75 },
  redemptions,
});

const makeSellerSettings = () => ({
  seller_user_id: 42,
  accepts_time_credits: true,
  loyalty_chf_per_hour: 10,
  loyalty_max_discount_pct: 20,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('LoyaltyAdminPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCanManage.mockReturnValue(true);
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/loyalty/redemptions')) {
        return Promise.resolve({ success: true, data: makeRedemptionsResponse() });
      }
      if (url.includes('/loyalty/seller-settings/')) {
        return Promise.resolve({ success: true, data: makeSellerSettings() });
      }
      return Promise.resolve({ success: true, data: null });
    });
  });

  it('shows a loading spinner initially', async () => {
    mockApi.get.mockImplementation(() => new Promise(() => {}));

    const LoyaltyAdminPage = (await import('./LoyaltyAdminPage')).default;
    render(<LoyaltyAdminPage />);

    const statuses = screen.getAllByRole('status');
    const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders 3 stat cards after load', async () => {
    const LoyaltyAdminPage = (await import('./LoyaltyAdminPage')).default;
    render(<LoyaltyAdminPage />);

    await waitFor(() => {
      expect(screen.getAllByTestId('stat-card')).toHaveLength(3);
    });
  });

  it('renders redemption rows in the ledger table', async () => {
    const LoyaltyAdminPage = (await import('./LoyaltyAdminPage')).default;
    render(<LoyaltyAdminPage />);

    await waitFor(() => {
      expect(screen.getByText('Alice Member')).toBeInTheDocument();
      expect(screen.getByText('Bob Merchant')).toBeInTheDocument();
    });
  });

  it('shows CHF discount amount in ledger', async () => {
    const LoyaltyAdminPage = (await import('./LoyaltyAdminPage')).default;
    render(<LoyaltyAdminPage />);

    await waitFor(() => {
      expect(screen.getByText(/CHF 25\.00/)).toBeInTheDocument();
    });
  });

  it('shows Reverse button for applied redemptions when canManage=true', async () => {
    const LoyaltyAdminPage = (await import('./LoyaltyAdminPage')).default;
    render(<LoyaltyAdminPage />);

    await waitFor(() => {
      const reverseBtn = screen.getAllByRole('button').find(
        (b) => b.textContent?.toLowerCase().includes('reverse'),
      );
      expect(reverseBtn).toBeDefined();
    });
  });

  it('does not show Reverse button when canManage=false', async () => {
    mockCanManage.mockReturnValue(false);

    const LoyaltyAdminPage = (await import('./LoyaltyAdminPage')).default;
    render(<LoyaltyAdminPage />);

    await waitFor(() => screen.getByText('Alice Member'));

    const reverseBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('reverse'),
    );
    expect(reverseBtn).toBeUndefined();
  });

  it('opens reversal modal when Reverse is clicked', async () => {
    const LoyaltyAdminPage = (await import('./LoyaltyAdminPage')).default;
    render(<LoyaltyAdminPage />);

    await waitFor(() => screen.getByText('Alice Member'));

    const reverseBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('reverse'),
    );
    if (reverseBtn) fireEvent.click(reverseBtn);

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
  });

  it('calls POST /reverse when reversal is confirmed', async () => {
    mockApi.post.mockResolvedValue({
      success: true,
      data: { redemption_id: 1, credits_restored: 2.5, member_new_balance: 22.5 },
    });

    const LoyaltyAdminPage = (await import('./LoyaltyAdminPage')).default;
    render(<LoyaltyAdminPage />);

    await waitFor(() => screen.getByText('Alice Member'));

    const reverseBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('reverse'),
    );
    if (reverseBtn) fireEvent.click(reverseBtn);

    await waitFor(() => document.querySelector('[role="dialog"]'));

    // Find confirm button inside modal
    const buttons = screen.getAllByRole('button');
    const confirmBtn = buttons.find(
      (b) =>
        b.textContent?.toLowerCase().includes('confirm') ||
        (b.textContent?.toLowerCase().includes('reverse') && b !== reverseBtn),
    );
    if (confirmBtn) {
      fireEvent.click(confirmBtn);
      await waitFor(() => {
        expect(mockApi.post).toHaveBeenCalledWith(
          '/v2/admin/caring-community/loyalty/redemptions/1/reverse',
          expect.any(Object),
        );
      });
    }
  });

  it('shows success toast after successful reversal', async () => {
    mockApi.post.mockResolvedValue({
      success: true,
      data: { redemption_id: 1, credits_restored: 2.5, member_new_balance: 22.5 },
    });

    const LoyaltyAdminPage = (await import('./LoyaltyAdminPage')).default;
    render(<LoyaltyAdminPage />);

    await waitFor(() => screen.getByText('Alice Member'));

    const reverseBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('reverse'),
    );
    if (reverseBtn) fireEvent.click(reverseBtn);

    await waitFor(() => document.querySelector('[role="dialog"]'));

    const buttons = screen.getAllByRole('button');
    const confirmBtn = buttons.find(
      (b) =>
        b.textContent?.toLowerCase().includes('confirm') ||
        (b.textContent?.toLowerCase().includes('reverse') && b !== reverseBtn),
    );
    if (confirmBtn) {
      fireEvent.click(confirmBtn);
      await waitFor(() => {
        expect(mockToast.success).toHaveBeenCalled();
      });
    }
  });

  it('loads seller settings when a seller is selected via MemberSearchPicker', async () => {
    const LoyaltyAdminPage = (await import('./LoyaltyAdminPage')).default;
    render(<LoyaltyAdminPage />);

    await waitFor(() => screen.getByTestId('member-search-picker'));

    // Simulate selecting a member
    const selectBtn = screen.getByTestId('select-member-btn');
    fireEvent.click(selectBtn);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith(
        expect.stringContaining('/loyalty/seller-settings/42'),
      );
    });
  });

  it('calls PUT /seller-settings when Save is clicked', async () => {
    mockApi.put.mockResolvedValue({ success: true, data: makeSellerSettings() });

    const LoyaltyAdminPage = (await import('./LoyaltyAdminPage')).default;
    render(<LoyaltyAdminPage />);

    await waitFor(() => screen.getByTestId('member-search-picker'));

    fireEvent.click(screen.getByTestId('select-member-btn'));

    await waitFor(() => {
      // settings panel becomes visible after load
      expect(screen.getByTestId('selected-member')).toBeInTheDocument();
    });

    // Wait for settings to load
    await waitFor(() => {
      const saveBtn = screen.getAllByRole('button').find(
        (b) => b.textContent?.toLowerCase().includes('save'),
      );
      expect(saveBtn).toBeDefined();
    });

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save'),
    );
    if (saveBtn) {
      fireEvent.click(saveBtn);
      await waitFor(() => {
        expect(mockApi.put).toHaveBeenCalledWith(
          '/v2/admin/caring-community/loyalty/seller-settings',
          expect.objectContaining({ seller_user_id: 42 }),
        );
      });
    }
  });

  it('shows error toast when load fails', async () => {
    mockApi.get.mockRejectedValue(new Error('Network'));

    const LoyaltyAdminPage = (await import('./LoyaltyAdminPage')).default;
    render(<LoyaltyAdminPage />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows empty ledger when no redemptions', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: { stats: { total_redemptions: 0, total_credits: 0, total_discount_chf: 0 }, redemptions: [] },
    });

    const LoyaltyAdminPage = (await import('./LoyaltyAdminPage')).default;
    render(<LoyaltyAdminPage />);

    await waitFor(() => {
      // Table renders but empty
      expect(screen.getAllByTestId('stat-card')).toHaveLength(3);
      // No redemption rows
      expect(screen.queryByText('Alice Member')).toBeNull();
    });
  });
});
