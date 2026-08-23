// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for WalletPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      success: true,
      data: { balance: 10, pending_in: 2, total_spent: 5, total_earned: 15 },
    }),
    post: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

vi.mock('@/contexts', () => ({
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),

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
}));

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock('@/components/wallet', () => ({
  TransferModal: () => null,
  DonateModal: () => null,
  CommunityFundCard: () => null,
  RatingModal: () => null,
  CategorySelect: () => null,
}));

vi.mock('@/lib/motion', () => {  const motionProps = new Set(['variants', 'initial', 'animate', 'layout', 'transition', 'exit', 'whileHover', 'whileTap', 'whileInView', 'viewport']);  const filterMotion = (props: Record<string, unknown>) => {    const filtered: Record<string, unknown> = {};    for (const [k, v] of Object.entries(props)) {      if (!motionProps.has(k)) filtered[k] = v;    }    return filtered;  };  return {    motion: {      div: ({ children, ...props }: Record<string, unknown>) => <div {...filterMotion(props)}>{children}</div>,    },    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,  };});

import { WalletPage } from './WalletPage';
import { api } from '@/lib/api';

describe('WalletPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(<WalletPage />);
    expect(screen.getByText('Wallet')).toBeInTheDocument();
  });

  it('shows the page description', () => {
    render(<WalletPage />);
    expect(screen.getByText('Track your time credits and transactions')).toBeInTheDocument();
  });

  it('shows Send Credits button', () => {
    render(<WalletPage />);
    expect(screen.getByText('Send Credits')).toBeInTheDocument();
  });

  it('shows Transaction History section', () => {
    render(<WalletPage />);
    expect(screen.getByText('Transaction History')).toBeInTheDocument();
  });

  it('shows filter tabs', () => {
    render(<WalletPage />);
    // These labels appear in both stat cards and filter tabs
    expect(screen.getAllByText('Earned').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Spent').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Pending').length).toBeGreaterThanOrEqual(1);
  });

  it('shows Export button', () => {
    render(<WalletPage />);
    expect(screen.getByText('Export')).toBeInTheDocument();
  });
  /**
   * 🔴 Two faults found by walking the mobile app on 2026-08-23, both of which existed
   * here too.
   *
   * The pending card ADDED credits coming in to credits going out and printed the sum, a
   * figure the member has nowhere. And the "Pending" filter read `tx.status === 'pending'`
   * over a list that could never contain a pending row, because
   * `GET /v2/wallet/transactions` was completed-only for every filter — so it said "no
   * transactions" while the card beside it claimed hours were pending.
   */
  function mockWallet(pendingRows: unknown[] = []) {
    vi.mocked(api.get).mockImplementation((url: string) => Promise.resolve(
      String(url).includes('type=pending')
        ? { success: true, data: pendingRows }
        : String(url).includes('/transactions')
          ? { success: true, data: [] }
          : { success: true, data: { balance: 23, total_earned: 3, total_spent: 5, pending_in: 7, pending_out: 4 } },
    ) as never);
  }

  it('never adds pending in and pending out together', async () => {
    mockWallet();

    render(<WalletPage />);

    await waitFor(() => {
      expect(screen.getByText('+7h -4h')).toBeInTheDocument();
    });
    // 11 is the sum of the two directions and must appear nowhere.
    expect(screen.queryByText('11h')).not.toBeInTheDocument();
  });

  it('asks the server for pending rows instead of filtering a completed-only list', async () => {
    mockWallet([{
      id: 991, type: 'credit', amount: 7, status: 'pending',
      description: 'Pending inbound fixture', created_at: '2026-08-23T09:00:00Z',
      other_user: { id: 5, name: 'Bob Smith', avatar_url: null },
    }]);

    render(<WalletPage />);

    await waitFor(() => expect(api.get).toHaveBeenCalled());

    // "Pending" also labels a stat card, so pick the tab control rather than the text.
    const pendingTab = screen.getAllByText('Pending')
      .map((node) => node.closest('[role="tab"], button, [data-key="pending"]'))
      .find((node): node is HTMLElement => node !== null);
    expect(pendingTab).toBeTruthy();
    fireEvent.click(pendingTab as HTMLElement);

    await waitFor(() => {
      expect(vi.mocked(api.get).mock.calls.some(([url]) => String(url).includes('type=pending'))).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByText('Pending inbound fixture')).toBeInTheDocument();
    });
  });
});
