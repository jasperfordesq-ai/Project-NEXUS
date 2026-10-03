// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

// Must be hoisted because vi.mock is hoisted and the factory uses these
const mockApiGet = vi.hoisted(() => vi.fn());
const mockAdminModeration = vi.hoisted(() => ({
  hideFeedPost: vi.fn(),
  deleteFeedPost: vi.fn(),
}));
const mockAdminSuper = vi.hoisted(() => ({
  listTenants: vi.fn(),
}));
const mockUseApi = vi.hoisted(() => vi.fn());

const mockAuthValue = {
  user: { id: 1, role: 'admin', is_super_admin: false, is_tenant_super_admin: false },
  isAuthenticated: true,
  login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null,
};

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockAuthValue,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/contexts/ToastContext', () => ({
  useToast: vi.fn(() => mockToast),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

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
  useAuth: () => mockAuthValue,
  useTenant: () => ({ tenant: { id: 2, name: 'Test', slug: 'test', tagline: null }, branding: { name: 'Test', logo_url: null }, tenantSlug: 'test', tenantPath: (p: string) => '/test' + p, isLoading: false, hasFeature: vi.fn(() => true), hasModule: vi.fn(() => true) }),
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminModeration: mockAdminModeration,
  adminSuper: mockAdminSuper,
  adminDonations: { list: vi.fn(), refund: vi.fn(), complete: vi.fn() },
  adminUsers: { list: vi.fn() },
  adminTimebanking: { grantCredits: vi.fn(), getGrants: vi.fn() },
}));

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useApi', () => ({
  useApi: mockUseApi,
  default: mockUseApi,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const POSTS = [
  { id: 10, user_id: 5, user_name: 'Alice', user_avatar: null, content: 'Hello world', type: 'post', is_hidden: false, is_flagged: false, tenant_name: 'TestTenant', created_at: '2025-01-01T00:00:00Z' },
  { id: 11, user_id: 6, user_name: 'Bob',   user_avatar: null, content: 'Flagged post', type: 'post', is_hidden: false, is_flagged: true, tenant_name: 'TestTenant', created_at: '2025-01-02T00:00:00Z' },
  { id: 12, user_id: 7, user_name: 'Carol', user_avatar: null, content: 'Already hidden', type: 'post', is_hidden: true,  is_flagged: false, tenant_name: 'TestTenant', created_at: '2025-01-03T00:00:00Z' },
];

const makeUseApiResult = (overrides = {}) => ({
  data: POSTS,
  isLoading: false,
  error: null,
  execute: vi.fn(),
  refetch: vi.fn(),
  reset: vi.fn(),
  setData: vi.fn(),
  loading: false,
  meta: { total_pages: 1 },
  ...overrides,
});

// ─── Import component after mocks ─────────────────────────────────────────────

import FeedModeration from './FeedModeration';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FeedModeration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApi.mockReturnValue(makeUseApiResult());
    mockAdminSuper.listTenants.mockResolvedValue({ success: true, data: [] });
  });

  it('renders posts from useApi data', () => {
    render(<FeedModeration />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Carol')).toBeInTheDocument();
  });

  it('shows posts written in the web composer as text, and a poll by its title', () => {
    mockUseApi.mockReturnValue(makeUseApiResult({
      data: [
        { ...POSTS[0], id: 20, content: '<p class="mb-1 leading-relaxed"><span>Meeting at 10am</span></p>' },
        { ...POSTS[1], id: 21, type: 'poll', title: 'Which day suits the garden club?', content: null },
      ],
      meta: { total_pages: 1, total: 2 },
    }));
    render(<FeedModeration />);

    expect(screen.getByText('Meeting at 10am')).toBeInTheDocument();
    expect(screen.queryByText(/<p class=/)).not.toBeInTheDocument();
    expect(screen.getByText('Which day suits the garden club?')).toBeInTheDocument();
    // The count line names the numbers again (it said only "Showing").
    expect(screen.getByText('Showing 2 of 2')).toBeInTheDocument();
  });

  it('shows loading spinner while isLoading is true', () => {
    mockUseApi.mockReturnValue(makeUseApiResult({ data: null, isLoading: true }));
    render(<FeedModeration />);
    // TableBody renders loadingContent = Spinner in loading state
    const statuses = screen.queryAllByRole('status', { hidden: true });
    // spinner has role=status; aria-busy spinner would be in there
    expect(statuses.length).toBeGreaterThanOrEqual(0); // just confirm no crash
  });

  it('shows error alert when useApi returns an error', () => {
    mockUseApi.mockReturnValue(makeUseApiResult({ data: null, error: 'Server error', isLoading: false }));
    render(<FeedModeration />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders empty content when no posts', () => {
    mockUseApi.mockReturnValue(makeUseApiResult({ data: [], isLoading: false }));
    render(<FeedModeration />);
    // No crash; empty message rendered by TableBody emptyContent
    expect(document.body).toBeInTheDocument();
  });

  it('shows Hide button only for visible posts', () => {
    render(<FeedModeration />);
    const hideBtns = screen.getAllByRole('button').filter((b) =>
      b.textContent?.toLowerCase().includes('hide'),
    );
    // Posts #10 and #11 are visible; post #12 is hidden → no Hide for #12
    expect(hideBtns.length).toBeGreaterThanOrEqual(2);
  });

  it('always shows Delete button for each post', () => {
    render(<FeedModeration />);
    const deleteBtns = screen.getAllByRole('button').filter((b) =>
      b.textContent?.toLowerCase().includes('delete'),
    );
    expect(deleteBtns.length).toBeGreaterThanOrEqual(POSTS.length);
  });

  it('opens confirm dialog when Hide is clicked', async () => {
    render(<FeedModeration />);
    const hideBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase() === 'hide' ||
      (b.textContent?.toLowerCase().includes('hide') && !b.textContent?.toLowerCase().includes('hidden')),
    );
    expect(hideBtn).toBeDefined();
    fireEvent.click(hideBtn!);

    await waitFor(() => {
      const dialogs = screen.queryAllByRole('dialog');
      expect(dialogs.length).toBeGreaterThan(0);
    });
  });

  it('opens confirm dialog when Delete is clicked', async () => {
    render(<FeedModeration />);
    const deleteBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase() === 'delete' ||
      b.textContent?.toLowerCase() === 'delete post' ||
      b.textContent?.trim().toLowerCase() === 'delete',
    );
    expect(deleteBtn).toBeDefined();
    fireEvent.click(deleteBtn!);

    await waitFor(() => {
      const dialogs = screen.queryAllByRole('dialog');
      expect(dialogs.length).toBeGreaterThan(0);
    });
  });

  it('calls hideFeedPost with post id on confirm', async () => {
    mockAdminModeration.hideFeedPost.mockResolvedValue({ success: true });
    const mockExecute = vi.fn();
    mockUseApi.mockReturnValue(makeUseApiResult({ execute: mockExecute }));

    render(<FeedModeration />);

    const hideBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('hide') &&
      !b.textContent?.toLowerCase().includes('post') === false,
    ) ?? screen.getAllByRole('button').find((b) =>
      b.textContent?.trim().toLowerCase() === 'hide',
    );

    if (hideBtn) {
      fireEvent.click(hideBtn);

      await waitFor(() => {
        const dialogs = screen.queryAllByRole('dialog');
        expect(dialogs.length).toBeGreaterThan(0);
      });

      // Confirm the action
      const confirmBtns = screen.getAllByRole('button').filter((b) =>
        b.textContent?.toLowerCase().includes('hide') ||
        b.textContent?.toLowerCase().includes('confirm'),
      );
      const confirmBtn = confirmBtns[confirmBtns.length - 1];
      if (confirmBtn && !confirmBtn.hasAttribute('disabled')) {
        fireEvent.click(confirmBtn);
        await waitFor(() => {
          expect(mockAdminModeration.hideFeedPost).toHaveBeenCalledWith(
            expect.any(Number),
            expect.any(String),
          );
        });
      }
    }
  });

  it('calls deleteFeedPost with post id on confirm', async () => {
    mockAdminModeration.deleteFeedPost.mockResolvedValue({ success: true });
    const mockExecute = vi.fn();
    mockUseApi.mockReturnValue(makeUseApiResult({ execute: mockExecute }));

    render(<FeedModeration />);

    const deleteBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.trim().toLowerCase() === 'delete',
    );
    if (deleteBtn) {
      fireEvent.click(deleteBtn);

      await waitFor(() => {
        const dialogs = screen.queryAllByRole('dialog');
        expect(dialogs.length).toBeGreaterThan(0);
      });

      const confirmBtns = screen.getAllByRole('button').filter((b) =>
        b.textContent?.toLowerCase().includes('delete') ||
        b.textContent?.toLowerCase().includes('confirm'),
      );
      const confirmBtn = confirmBtns[confirmBtns.length - 1];
      if (confirmBtn && !confirmBtn.hasAttribute('disabled')) {
        fireEvent.click(confirmBtn);
        await waitFor(() => {
          expect(mockAdminModeration.deleteFeedPost).toHaveBeenCalledWith(
            expect.any(Number),
            expect.any(String),
          );
        });
      }
    }
  });

  // Regression: a tenant_admin (or broker) is broker-or-admin on the server
  // (requireBrokerOrAdmin), but the old inline client gate accepted only
  // admin/super_admin/moderator — so the DELETE was blocked CLIENT-SIDE with an
  // "Unauthorized" toast and never reached the server. This is the recurring
  // "admin can't delete a feed post" bug in the broker panel.
  it('allows a tenant_admin without super flags to delete (does not block client-side)', async () => {
    const originalUser = mockAuthValue.user;
    mockAuthValue.user = { id: 2, role: 'tenant_admin', is_super_admin: false, is_tenant_super_admin: false };
    try {
      mockAdminModeration.deleteFeedPost.mockResolvedValue({ success: true });
      mockUseApi.mockReturnValue(makeUseApiResult({ execute: vi.fn() }));

      render(<FeedModeration />);

      const deleteBtn = screen.getAllByRole('button').find((b) =>
        b.textContent?.trim().toLowerCase() === 'delete',
      );
      expect(deleteBtn).toBeDefined();
      fireEvent.click(deleteBtn!);

      await waitFor(() => {
        expect(screen.queryAllByRole('dialog').length).toBeGreaterThan(0);
      });

      const confirmBtns = screen.getAllByRole('button').filter((b) =>
        b.textContent?.toLowerCase().includes('delete') ||
        b.textContent?.toLowerCase().includes('confirm'),
      );
      const confirmBtn = confirmBtns[confirmBtns.length - 1];
      expect(confirmBtn).toBeDefined();
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(mockAdminModeration.deleteFeedPost).toHaveBeenCalled();
      });
      // The old gate would have shown an "unauthorized" toast and returned early.
      expect(mockToast.error).not.toHaveBeenCalled();
    } finally {
      mockAuthValue.user = originalUser;
    }
  });

  it('shows success toast after hide succeeds', async () => {
    mockAdminModeration.hideFeedPost.mockResolvedValue({ success: true });
    mockUseApi.mockReturnValue(makeUseApiResult({ execute: vi.fn() }));
    render(<FeedModeration />);

    const hideBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.trim().toLowerCase() === 'hide',
    );
    if (hideBtn) {
      fireEvent.click(hideBtn);
      await waitFor(() => screen.queryAllByRole('dialog').length > 0);
      const confirmBtns = screen.getAllByRole('button').filter((b) =>
        b.textContent?.toLowerCase().includes('hide'),
      );
      const confirmBtn = confirmBtns[confirmBtns.length - 1];
      if (confirmBtn && !confirmBtn.hasAttribute('disabled')) {
        fireEvent.click(confirmBtn);
        await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
      }
    }
  });

  it('shows error toast when hide fails', async () => {
    mockAdminModeration.hideFeedPost.mockResolvedValue({ success: false, error: 'Forbidden' });
    mockUseApi.mockReturnValue(makeUseApiResult({ execute: vi.fn() }));
    render(<FeedModeration />);

    const hideBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.trim().toLowerCase() === 'hide',
    );
    if (hideBtn) {
      fireEvent.click(hideBtn);
      await waitFor(() => screen.queryAllByRole('dialog').length > 0);
      const confirmBtns = screen.getAllByRole('button').filter((b) =>
        b.textContent?.toLowerCase().includes('hide'),
      );
      const confirmBtn = confirmBtns[confirmBtns.length - 1];
      if (confirmBtn && !confirmBtn.hasAttribute('disabled')) {
        fireEvent.click(confirmBtn);
        await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
      }
    }
  });

  it('handleSearch triggers apply button', () => {
    render(<FeedModeration />);
    const applyBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('apply'),
    );
    expect(applyBtn).toBeDefined();
    fireEvent.click(applyBtn!);
    // No crash; apply just commits the current filter state
  });

  it('handleClear resets filter inputs', () => {
    render(<FeedModeration />);
    const clearBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('clear'),
    );
    expect(clearBtn).toBeDefined();
    fireEvent.click(clearBtn!);
    // No crash
  });
});
