// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for NewsletterUnsubscribePage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import React from 'react';

const mockApiPost = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: null }),
    post: (...args: unknown[]) => mockApiPost(...args),
    put: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

const stableToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const stableTenant = {
  tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
  branding: { name: 'Test Community' },
  tenantPath: (p: string) => `/test${p}`,
  hasFeature: vi.fn(() => true),
  hasModule: vi.fn(() => true),
  isLoading: false,
};

vi.mock('@/contexts', () => ({
  useTenant: vi.fn(() => stableTenant),
  useAuth: vi.fn(() => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null })),
  useToast: vi.fn(() => stableToast),
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// Default: no token in URL
let mockSearchParams = new URLSearchParams('');

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useSearchParams: () => [mockSearchParams],
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  };
});

import NewsletterUnsubscribePage from './NewsletterUnsubscribePage';

describe('NewsletterUnsubscribePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams('');
  });

  it('renders without crashing', () => {
    const { container } = render(<NewsletterUnsubscribePage />);
    expect(container.querySelector('div')).toBeTruthy();
  });

  it('shows invalid link state when no token provided', () => {
    render(<NewsletterUnsubscribePage />);
    expect(screen.getByText(/link doesn't work/i)).toBeInTheDocument();
  });

  it('shows success state on successful unsubscribe', async () => {
    mockSearchParams = new URLSearchParams('token=valid-token');
    mockApiPost.mockResolvedValue({ success: true, data: { success: true } });
    render(<NewsletterUnsubscribePage />);
    await waitFor(() => {
      expect(screen.getByText(/unsubscribed/i)).toBeInTheDocument();
    });
    expect(mockApiPost).toHaveBeenCalledWith(
      '/v2/newsletter/unsubscribe',
      { token: 'valid-token' },
      { skipAuth: true, skipTenant: true },
    );
  });

  it('shows already-done state when already unsubscribed', async () => {
    mockSearchParams = new URLSearchParams('token=valid-token');
    mockApiPost.mockResolvedValue({ success: true, data: { success: true, already_done: true } });
    render(<NewsletterUnsubscribePage />);
    await waitFor(() => {
      expect(screen.getByText(/already unsubscribed/i)).toBeInTheDocument();
    });
  });

  it('shows error state on API failure', async () => {
    mockSearchParams = new URLSearchParams('token=valid-token');
    mockApiPost.mockRejectedValue(new Error('Network error'));
    render(<NewsletterUnsubscribePage />);
    await waitFor(() => {
      expect(screen.getByText(/that didn't work/i)).toBeInTheDocument();
    });
  });
});
