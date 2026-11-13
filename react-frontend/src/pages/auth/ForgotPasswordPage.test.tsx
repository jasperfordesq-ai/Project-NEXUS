// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ForgotPasswordPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/test-utils';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: [] }),
    post: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

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

import { ForgotPasswordPage } from './ForgotPasswordPage';
import { api } from '@/lib/api';

describe('ForgotPasswordPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders without crashing', () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByText('Reset your password')).toBeInTheDocument();
  });

  it('shows email input', () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
  });

  it('shows the link back to sign in', () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByText('Back to sign in')).toBeInTheDocument();
  });

  it('fires only ONE reset request when the form is submitted twice in rapid succession', async () => {
    // Regression: handleSubmit had no re-entry guard and the submit button is not
    // natively disabled while loading (isLoading only renders a spinner), so a
    // double-Enter — which submits the native form — fired two POST /auth/forgot-password
    // requests and sent two reset emails. A synchronous useRef guard now rejects the
    // second submit. Live-verified: two submits → one POST (was two before the fix).
    let resolvePost: (v: { success: boolean }) => void = () => {};
    vi.mocked(api.post).mockReturnValue(new Promise((resolve) => { resolvePost = resolve; }));

    const { container } = render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'user@example.com' },
    });

    const form = container.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(api.post).toHaveBeenCalledTimes(1);

    resolvePost({ success: true });
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  });
});
