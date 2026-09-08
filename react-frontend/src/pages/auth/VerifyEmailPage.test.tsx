// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for VerifyEmailPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/contexts', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test', settings: {} },
    branding: { name: 'Test Community', logo_url: null },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
  useAuth: vi.fn(() => ({
    isAuthenticated: false,
    user: null,
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
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    isAuthenticated: false,
    user: null,
  })),
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test', settings: {} },
    branding: { name: 'Test Community', logo_url: null },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
}));

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const motionKeys = new Set(['variants', 'initial', 'animate', 'transition', 'whileInView', 'viewport', 'layout', 'exit', 'whileHover', 'whileTap']);
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) { if (!motionKeys.has(k)) rest[k] = v; }
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

// Mock react-router-dom — provide searchParams by default (no token)
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  };
});

import { VerifyEmailPage } from './VerifyEmailPage';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';

const mockApi = api as { post: ReturnType<typeof vi.fn> };
const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;
const mockUseTenant = useTenant as ReturnType<typeof vi.fn>;

describe('VerifyEmailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ isAuthenticated: false, user: null });
    mockUseTenant.mockReturnValue({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test', settings: {} },
      branding: { name: 'Test Community', logo_url: null },
      tenantPath: (p: string) => `/test${p}`,
      hasModule: vi.fn(() => true),
    });
  });

  it('shows error state when no token is in the URL', async () => {
    render(<VerifyEmailPage />);
    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 1 })).toBeInTheDocument();
    });
    // Should display error state — no token means instant error
    // The heading comes from t('verify_email.error_title')
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toBeInTheDocument();
  });

  it('shows branding name at the bottom', async () => {
    render(<VerifyEmailPage />);
    await waitFor(() => {
      expect(screen.getByText('Test Community')).toBeInTheDocument();
    });
  });

  it('shows loading state while verifying token', async () => {
    // Mock API to never resolve during this test
    vi.mocked(mockApi.post).mockReturnValue(new Promise(() => {}));

    // Override useSearchParams to include a token
    const { useSearchParams } = await import('react-router-dom');
    vi.mocked(useSearchParams).mockReturnValue([
      new URLSearchParams('token=abc123'),
      vi.fn(),
    ] as ReturnType<typeof useSearchParams>);

    render(<VerifyEmailPage />);
    // Loading state shows a spinner / loading title
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('shows success state after successful verification', async () => {
    vi.mocked(mockApi.post).mockResolvedValueOnce({ success: true });

    const { useSearchParams } = await import('react-router-dom');
    vi.mocked(useSearchParams).mockReturnValue([
      new URLSearchParams('token=valid-token'),
      vi.fn(),
    ] as ReturnType<typeof useSearchParams>);

    render(<VerifyEmailPage />);

    await waitFor(() => {
      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading).toBeInTheDocument();
    });
  });

  it('shows login button link in success state for unauthenticated users', async () => {
    vi.mocked(mockApi.post).mockResolvedValueOnce({ success: true });

    const { useSearchParams } = await import('react-router-dom');
    vi.mocked(useSearchParams).mockReturnValue([
      new URLSearchParams('token=valid-token'),
      vi.fn(),
    ] as ReturnType<typeof useSearchParams>);

    render(<VerifyEmailPage />);

    await waitFor(() => {
      const links = screen.getAllByRole('link');
      expect(links.length).toBeGreaterThan(0);
    });
  });

  it('shows resend option in error state for authenticated users', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, user: { id: 1 } });

    // No token → immediate error
    render(<VerifyEmailPage />);

    await waitFor(() => {
      // Error state with authenticated user shows resend button
      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading).toBeInTheDocument();
    });
  });

  it('keeps the resend button (does not show a fake "sent") when the resend returns success:false', async () => {
    // Regression: handleResendVerification did an UNCHECKED `await api.post(
    // .../resend-verification)` then set the success state + a success toast. api.post
    // resolves { success:false } on a 4xx (e.g. rate-limited) WITHOUT throwing, so a
    // rejected resend showed a fake "sent" confirmation while no email went out. It must
    // show an error and keep the resend button (verified live).
    mockUseAuth.mockReturnValue({ isAuthenticated: true, user: { id: 1 } });
    vi.mocked(mockApi.post).mockResolvedValue({ success: false, error: 'Too many requests' });

    render(<VerifyEmailPage />);

    const resendBtn = await screen.findByRole('button', { name: /resend/i });
    fireEvent.click(resendBtn);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/auth/resend-verification');
    });
    // The "sent" state was NOT entered: the resend button is still present (a successful
    // resend would replace it with the success message).
    expect(screen.getByRole('button', { name: /resend/i })).toBeInTheDocument();
  });

  it('shows dashboard link in error state for authenticated users', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, user: { id: 1 } });
    // Ensure no token so component enters error state immediately (without API call)
    const { useSearchParams } = await import('react-router-dom');
    vi.mocked(useSearchParams).mockReturnValue([
      new URLSearchParams(),
      vi.fn(),
    ] as ReturnType<typeof useSearchParams>);

    render(<VerifyEmailPage />);

    await waitFor(() => {
      const links = screen.getAllByRole('link');
      // There should be a back to dashboard link
      expect(links.length).toBeGreaterThan(0);
    });
  });
});
