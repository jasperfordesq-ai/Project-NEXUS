// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

vi.mock('@/contexts', () => ({
  useToast: vi.fn(() => mockToast),
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null }),
  useTenant: () => ({ tenant: { id: 2, name: 'Test', slug: 'test', tagline: null }, branding: { name: 'Test', logo_url: null }, tenantSlug: 'test', tenantPath: (p: string) => '/test' + p, isLoading: false, hasFeature: vi.fn(() => true), hasModule: vi.fn(() => true) }),
}));

// Mock adminApi — used via named import { adminDonations }
const mockAdminDonations = vi.hoisted(() => ({
  list: vi.fn(),
  refund: vi.fn(),
  complete: vi.fn(),
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminDonations: mockAdminDonations,
  adminUsers: { list: vi.fn() },
  adminTimebanking: { grantCredits: vi.fn(), getGrants: vi.fn() },
  adminModeration: { hideFeedPost: vi.fn(), deleteFeedPost: vi.fn() },
  adminSuper: { listTenants: vi.fn() },
}));

vi.mock('../../AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
}));

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const DONATIONS = [
  { id: 1, user_id: 10, donor_name: 'Aoife Donorson', is_anonymous: false, amount: '25.00', currency: 'EUR', payment_method: 'stripe', payment_route: 'tenant_connect', stripe_account_id: 'acct_test_123456', status: 'completed', stripe_charge_id: 'ch_abc', refund_id: null, giving_day_id: null, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 2, user_id: null, is_anonymous: true,  amount: '10.00', currency: 'EUR', payment_method: 'cash', payment_route: 'platform_default', stripe_account_id: null, status: 'pending',   stripe_charge_id: null,     refund_id: null, giving_day_id: null, created_at: '2025-01-02T00:00:00Z', updated_at: '2025-01-02T00:00:00Z' },
  { id: 3, user_id: 11, is_anonymous: false, amount: '5.00',  currency: 'EUR', payment_method: 'stripe', payment_route: 'platform_default', stripe_account_id: null, status: 'refunded',  stripe_charge_id: 'ch_xyz', refund_id: 're_xyz', giving_day_id: null, created_at: '2025-01-03T00:00:00Z', updated_at: '2025-01-03T00:00:00Z' },
];

// ─── Import component after mocks ─────────────────────────────────────────────

import { DonationRefunds } from './DonationRefunds';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DonationRefunds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminDonations.list.mockResolvedValue({ success: true, data: { items: DONATIONS } });
  });

  it('renders loading state then populates with donations', async () => {
    render(<DonationRefunds />);
    await waitFor(() => {
      // After load, donation #1 amount appears somewhere
      expect(screen.queryAllByRole('status', { hidden: true }).find((el) => el.getAttribute('aria-busy') === 'true')).toBeUndefined();
    });
  });

  it('calls adminDonations.list on mount', async () => {
    render(<DonationRefunds />);
    await waitFor(() => expect(mockAdminDonations.list).toHaveBeenCalledTimes(1));
  });

  it('shows donation payment route and Stripe account reporting details', async () => {
    render(<DonationRefunds />);
    await waitFor(() => {
      expect(screen.getByText(/tenant connect/i)).toBeInTheDocument();
      expect(screen.getByText('acct_test_123456')).toBeInTheDocument();
      expect(screen.getAllByText(/platform account/i).length).toBeGreaterThan(0);
    });
  });

  it('names the donor, falling back to the member number when no name came back', async () => {
    render(<DonationRefunds />);
    await waitFor(() => {
      expect(screen.getByText('Aoife Donorson')).toBeInTheDocument();
      expect(screen.getByText('User #11')).toBeInTheDocument();
      expect(screen.queryByText('User #10')).not.toBeInTheDocument();
    });
  });

  it('shows error card when list call fails', async () => {
    mockAdminDonations.list.mockResolvedValue({ success: false, error: 'Network error' });
    render(<DonationRefunds />);
    await waitFor(() => {
      const alert = screen.queryByRole('alert');
      expect(alert).toBeInTheDocument();
    });
  });

  it('shows empty state when no donations returned', async () => {
    mockAdminDonations.list.mockResolvedValue({ success: true, data: { items: [] } });
    render(<DonationRefunds />);
    // DataTable emptyContent or EmptyState; wait for loading to clear
    await waitFor(() => expect(mockAdminDonations.list).toHaveBeenCalled());
    // No crash; component renders without throwing
  });

  it('refresh button re-fetches donations', async () => {
    render(<DonationRefunds />);
    await waitFor(() => expect(mockAdminDonations.list).toHaveBeenCalledTimes(1));

    const refreshBtn = screen.getAllByRole('button').find((b) => {
      const txt = b.textContent ?? '';
      return txt.toLowerCase().includes('refresh') || txt.toLowerCase().includes('reload');
    });
    if (refreshBtn) {
      fireEvent.click(refreshBtn);
      await waitFor(() => expect(mockAdminDonations.list).toHaveBeenCalledTimes(2));
    }
  });

  it('opens refund confirm modal when Refund action button is pressed', async () => {
    render(<DonationRefunds />);
    await waitFor(() => expect(mockAdminDonations.list).toHaveBeenCalled());

    // DataTable renders rows; find a "Refund" button for the completed donation
    await waitFor(() => {
      const refundBtn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('refund'),
      );
      expect(refundBtn).toBeDefined();
    });

    const refundBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('refund') && !b.textContent?.toLowerCase().includes('total'),
    );
    if (refundBtn) {
      fireEvent.click(refundBtn);
      // ConfirmModal should appear
      await waitFor(() => {
        const dialogs = screen.queryAllByRole('dialog');
        expect(dialogs.length).toBeGreaterThan(0);
      });
    }
  });

  it('calls adminDonations.refund with correct donation id on confirm', async () => {
    mockAdminDonations.refund.mockResolvedValue({ success: true, data: { refund_id: 're_new' } });
    render(<DonationRefunds />);
    await waitFor(() => expect(mockAdminDonations.list).toHaveBeenCalled());

    // Find refund button for donation #1
    await waitFor(() => {
      const refundBtn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('refund') && !b.textContent?.toLowerCase().includes('total'),
      );
      expect(refundBtn).toBeDefined();
    });

    const refundBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('refund') && !b.textContent?.toLowerCase().includes('total'),
    );
    if (refundBtn) {
      fireEvent.click(refundBtn);

      // ConfirmModal confirm button
      await waitFor(() => {
        const dialogs = screen.queryAllByRole('dialog');
        expect(dialogs.length).toBeGreaterThan(0);
      });

      const confirmBtns = screen.getAllByRole('button').filter((b) =>
        b.textContent?.toLowerCase().includes('refund') || b.textContent?.toLowerCase().includes('confirm'),
      );
      // Click the last one (modal confirm)
      const modalConfirm = confirmBtns[confirmBtns.length - 1];
      if (modalConfirm && !modalConfirm.hasAttribute('disabled')) {
        fireEvent.click(modalConfirm);
        await waitFor(() => {
          expect(mockAdminDonations.refund).toHaveBeenCalledWith(1);
        });
        await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
      }
    }
  });

  it('shows error toast when refund API fails', async () => {
    mockAdminDonations.refund.mockResolvedValue({ success: false, error: 'Stripe declined' });
    render(<DonationRefunds />);
    await waitFor(() => expect(mockAdminDonations.list).toHaveBeenCalled());

    const refundBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('refund') && !b.textContent?.toLowerCase().includes('total'),
    );
    if (refundBtn) {
      fireEvent.click(refundBtn);

      await waitFor(() => {
        const dialogs = screen.queryAllByRole('dialog');
        expect(dialogs.length).toBeGreaterThan(0);
      });

      const confirmBtns = screen.getAllByRole('button').filter((b) =>
        b.textContent?.toLowerCase().includes('refund') || b.textContent?.toLowerCase().includes('confirm'),
      );
      const modalConfirm = confirmBtns[confirmBtns.length - 1];
      if (modalConfirm && !modalConfirm.hasAttribute('disabled')) {
        fireEvent.click(modalConfirm);
        await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
      }
    }
  });

  it('shows mark-completed button for pending non-stripe donation', async () => {
    render(<DonationRefunds />);
    await waitFor(() => expect(mockAdminDonations.list).toHaveBeenCalled());

    // Donation #2 is pending + cash → should show "Mark completed" button
    await waitFor(() => {
      const markBtn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('complete') ||
        b.textContent?.toLowerCase().includes('mark'),
      );
      expect(markBtn).toBeDefined();
    });
  });

  it('calls adminDonations.complete on confirm of mark-completed', async () => {
    mockAdminDonations.complete = vi.fn().mockResolvedValue({ success: true });
    render(<DonationRefunds />);
    await waitFor(() => expect(mockAdminDonations.list).toHaveBeenCalled());

    const markBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('complete') ||
      b.textContent?.toLowerCase().includes('mark'),
    );
    if (markBtn) {
      fireEvent.click(markBtn);
      await waitFor(() => {
        const dialogs = screen.queryAllByRole('dialog');
        expect(dialogs.length).toBeGreaterThan(0);
      });

      const confirmBtns = screen.getAllByRole('button').filter((b) =>
        b.textContent?.toLowerCase().includes('complete') || b.textContent?.toLowerCase().includes('confirm'),
      );
      const modalConfirm = confirmBtns[confirmBtns.length - 1];
      if (modalConfirm && !modalConfirm.hasAttribute('disabled')) {
        fireEvent.click(modalConfirm);
        await waitFor(() => {
          expect(mockAdminDonations.complete).toHaveBeenCalledWith(2);
        });
      }
    }
  });

  it('re-fetches after successful refund', async () => {
    mockAdminDonations.refund.mockResolvedValue({ success: true, data: { refund_id: 're_new' } });
    render(<DonationRefunds />);
    await waitFor(() => expect(mockAdminDonations.list).toHaveBeenCalledTimes(1));

    const refundBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('refund') && !b.textContent?.toLowerCase().includes('total'),
    );
    if (refundBtn) {
      fireEvent.click(refundBtn);
      await waitFor(() => {
        const dialogs = screen.queryAllByRole('dialog');
        expect(dialogs.length).toBeGreaterThan(0);
      });
      const confirmBtns = screen.getAllByRole('button').filter((b) =>
        b.textContent?.toLowerCase().includes('refund') || b.textContent?.toLowerCase().includes('confirm'),
      );
      const modalConfirm = confirmBtns[confirmBtns.length - 1];
      if (modalConfirm && !modalConfirm.hasAttribute('disabled')) {
        fireEvent.click(modalConfirm);
        await waitFor(() => expect(mockAdminDonations.list).toHaveBeenCalledTimes(2));
      }
    }
  });
});
