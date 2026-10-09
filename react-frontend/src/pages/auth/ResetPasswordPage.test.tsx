// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ResetPasswordPage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@/test/test-utils';
import { api } from '@/lib/api';
import { HIBP_TIMEOUT_MS } from '@/hooks/usePasswordCheck';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: [] }),
    post: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useSearchParams: vi.fn(() => [new URLSearchParams('token=test-token&email=test@test.com'), vi.fn()]),
  };
});

vi.mock('@/contexts', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    branding: { name: 'Test Community', logo_url: null },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
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
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    branding: { name: 'Test Community', logo_url: null },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
  })),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo', () => ({ PageMeta: () => null }));
vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const motionKeys = new Set(["variants", "initial", "animate", "transition", "whileInView", "viewport", "layout", "exit", "whileHover", "whileTap"]);
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) { if (!motionKeys.has(k)) rest[k] = v; }
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ResetPasswordPage } from './ResetPasswordPage';

describe('ResetPasswordPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders without crashing', () => {
    render(<ResetPasswordPage />);
    expect(screen.getByText('Set new password')).toBeInTheDocument();
  });

  it('shows password inputs', () => {
    render(<ResetPasswordPage />);
    expect(screen.getByPlaceholderText('Enter a strong password')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Re-enter your password')).toBeInTheDocument();
  });
});

describe('ResetPasswordPage when the breach check hangs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // The breach-check request never answers (seen in a sandboxed browser,
    // and possible behind some firewalls, privacy extensions and portals).
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function fillBothFields(password: string) {
    fireEvent.change(screen.getByPlaceholderText('Enter a strong password'), { target: { value: password } });
    fireEvent.change(screen.getByPlaceholderText('Re-enter your password'), { target: { value: password } });
  }

  it('cannot be submitted while the check is still running', async () => {
    render(<ResetPasswordPage />);
    fillBothFields('reset-page-still-checking-1');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350 + 1000);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));

    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Checking against known data breaches');
  });

  it('becomes submittable once the time limit passes, leaving the server to check', async () => {
    render(<ResetPasswordPage />);
    const password = 'reset-page-hanging-check-2';
    fillBothFields(password);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350 + HIBP_TIMEOUT_MS);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));
    });

    expect(api.post).toHaveBeenCalledWith('/auth/reset-password', {
      token: 'test-token',
      password,
      password_confirmation: password,
    });
  });
});
