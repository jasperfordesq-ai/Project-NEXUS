// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for VerifyEmailPage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  beforeEach(async () => {
    vi.clearAllMocks();
    // Start every test with no token, as the comments in the tests below assume.
    // (A token left over from an earlier test now also shares that test's
    // still-pending request, because the page sends one request per link.)
    const { useSearchParams } = await import('react-router-dom');
    vi.mocked(useSearchParams).mockReturnValue([new URLSearchParams(), vi.fn()] as ReturnType<typeof useSearchParams>);
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

  // The server's sentence for a dead link is system voice ("Invalid or expired verification
  // token…"). The page knows from the code what happened, so it says it in its own words.
  it('explains a dead link in the site voice, not with the server sentence', async () => {
    vi.mocked(mockApi.post).mockResolvedValueOnce({
      success: false,
      code: 'AUTH_TOKEN_INVALID',
      error: 'Invalid or expired verification token. Please request a new verification email.',
    });

    const { useSearchParams } = await import('react-router-dom');
    vi.mocked(useSearchParams).mockReturnValue([
      new URLSearchParams('token=used-token'),
      vi.fn(),
    ] as ReturnType<typeof useSearchParams>);

    render(<VerifyEmailPage />);

    expect(await screen.findByText(/This link isn't working any more/)).toBeInTheDocument();
    expect(screen.queryByText(/Invalid or expired verification token/)).toBeNull();
  });

  it('still shows what the server says for any other refusal', async () => {
    vi.mocked(mockApi.post).mockResolvedValueOnce({
      success: false,
      code: 'RATE_LIMIT_EXCEEDED',
      error: 'Please wait a minute before trying again.',
    });

    const { useSearchParams } = await import('react-router-dom');
    vi.mocked(useSearchParams).mockReturnValue([
      new URLSearchParams('token=some-token'),
      vi.fn(),
    ] as ReturnType<typeof useSearchParams>);

    render(<VerifyEmailPage />);

    expect(await screen.findByText('Please wait a minute before trying again.')).toBeInTheDocument();
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

  // 2026-10-23 SEO audit: only the loading state said noindex, so the
  // finished page (success or error) could be indexed.
  describe('kept out of search results', () => {
    const robots = () => document.querySelector('meta[name="robots"]')?.getAttribute('content');

    it('says noindex on the error state', async () => {
      render(<VerifyEmailPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      await waitFor(() => expect(robots()).toBe('noindex, nofollow'));
    });

    it('says noindex on the success state', async () => {
      vi.mocked(mockApi.post).mockResolvedValueOnce({ success: true });
      const { useSearchParams } = await import('react-router-dom');
      vi.mocked(useSearchParams).mockReturnValue([
        new URLSearchParams('token=valid-token'),
        vi.fn(),
      ] as ReturnType<typeof useSearchParams>);

      render(<VerifyEmailPage />);
      await waitFor(() => expect(mockApi.post).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByRole('status', { busy: true })).not.toBeInTheDocument());
      await waitFor(() => expect(robots()).toBe('noindex, nofollow'));
    });
  });
});

/**
 * B1 walk, 13 Nov 2026 (findings 3.1, 3.3, 3.4, 3.2's button).
 *
 * The server deletes a verification token the first time it is used. Opening the
 * same link again — React's development double effect, a double click, going back,
 * a mail scanner — used to show a red "failed" screen for an address that IS verified.
 */
describe('VerifyEmailPage — opening the same link twice', () => {
  const setToken = async (token: string) => {
    const { useSearchParams } = await import('react-router-dom');
    vi.mocked(useSearchParams).mockReturnValue([
      new URLSearchParams(`token=${token}`),
      vi.fn(),
    ] as ReturnType<typeof useSearchParams>);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockApi.post).mockReset();
    window.localStorage.clear();
    mockUseAuth.mockReturnValue({ isAuthenticated: false, user: null });
    mockUseTenant.mockReturnValue({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test', settings: {} },
      branding: { name: 'Test Community', logo_url: null },
      tenantPath: (p: string) => `/test${p}`,
      hasModule: vi.fn(() => true),
    });
  });

  it('sends one request even when the verify effect runs twice for the same link', async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(mockApi.post).mockImplementation(() => new Promise((r) => { resolve = r; }));
    await setToken('strict-token-1');

    // Two mounts of the page at once: the effect runs twice while the first
    // request is still in flight — what React's development double effect does.
    const { StrictMode } = await import('react');
    render(<StrictMode><VerifyEmailPage /><VerifyEmailPage /></StrictMode>);

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled());
    resolve({ success: true, data: { verified: true } });

    expect((await screen.findAllByText('Email verified')).length).toBe(2);
    expect(mockApi.post).toHaveBeenCalledTimes(1);
  });

  it('shows the success state again when a link that worked here is reopened', async () => {
    await setToken('reopened-token-1');
    vi.mocked(mockApi.post).mockResolvedValueOnce({ success: true, data: { verified: true } });
    const first = render(<VerifyEmailPage />);
    expect(await screen.findByText('Email verified')).toBeInTheDocument();
    first.unmount();

    // Second open: the server has deleted the token and says it is invalid.
    vi.mocked(mockApi.post).mockResolvedValueOnce({
      success: false,
      code: 'AUTH_TOKEN_INVALID',
      error: 'Invalid or expired verification token.',
    });
    render(<VerifyEmailPage />);

    expect(await screen.findByText('Email verified')).toBeInTheDocument();
    expect(screen.queryByText("We couldn't verify your email")).toBeNull();
  });

  it('never stores the token itself in this browser', async () => {
    await setToken('secret-token-value-1');
    vi.mocked(mockApi.post).mockResolvedValueOnce({ success: true, data: { verified: true } });
    render(<VerifyEmailPage />);
    expect(await screen.findByText('Email verified')).toBeInTheDocument();

    const everything = Object.keys(window.localStorage)
      .map((k) => `${k}=${window.localStorage.getItem(k)}`)
      .join('\n');
    expect(everything).not.toContain('secret-token-value-1');
    expect(everything.length).toBeGreaterThan(0);
  });

  it('still shows the dead-link message for a link that never worked here', async () => {
    await setToken('never-worked-token');
    vi.mocked(mockApi.post).mockResolvedValueOnce({
      success: false,
      code: 'AUTH_TOKEN_INVALID',
      error: 'Invalid or expired verification token.',
    });
    render(<VerifyEmailPage />);
    expect(await screen.findByText(/This link isn't working any more/)).toBeInTheDocument();
  });

  it('remembers that the member is still waiting for approval when the link is reopened', async () => {
    await setToken('reopened-waiting-token');
    vi.mocked(mockApi.post).mockResolvedValueOnce({ success: true, data: { verified: true, requires_approval: true } });
    const first = render(<VerifyEmailPage />);
    expect(await screen.findByText('Waiting for approval')).toBeInTheDocument();
    first.unmount();

    vi.mocked(mockApi.post).mockResolvedValueOnce({ success: false, code: 'AUTH_TOKEN_INVALID', error: 'x' });
    render(<VerifyEmailPage />);
    expect(await screen.findByText('Waiting for approval')).toBeInTheDocument();
  });

  it('does not send a member who is waiting for approval to a sign-in that will refuse them', async () => {
    await setToken('waiting-token-2');
    vi.mocked(mockApi.post).mockResolvedValueOnce({ success: true, data: { verified: true, requires_approval: true } });
    render(<VerifyEmailPage />);

    expect(await screen.findByText('Waiting for approval')).toBeInTheDocument();
    const hrefs = screen.getAllByRole('link').map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/test/');
    expect(hrefs.some((h) => h?.startsWith('/test/login'))).toBe(false);
  });

  it('shows the community welcome band on every state', async () => {
    await setToken('band-token');
    vi.mocked(mockApi.post).mockReturnValue(new Promise(() => {}));
    render(<VerifyEmailPage />);
    expect(screen.getByTestId('community-welcome')).toBeInTheDocument();
  });

  it('shows the community welcome band on the result screen', async () => {
    await setToken('band-token-2');
    vi.mocked(mockApi.post).mockResolvedValueOnce({ success: true, data: { verified: true } });
    render(<VerifyEmailPage />);
    expect(await screen.findByText('Email verified')).toBeInTheDocument();
    expect(screen.getByTestId('community-welcome')).toBeInTheDocument();
  });
});

// A new member signed up on the way to an emailed page; the server put that page
// in the verification link (?next=), usually opened in a new tab.
describe('VerifyEmailPage — carrying the page the member was going to', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockUseTenant.mockReturnValue({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test', settings: {} },
      branding: { name: 'Test Community', logo_url: null },
      tenantPath: (p: string) => `/test${p}`,
      hasModule: vi.fn(() => true),
    });
    vi.mocked(mockApi.post).mockResolvedValueOnce({ success: true });
    window.history.pushState({}, '', '/test/verify-email?token=valid-token&next=%2Ftest%2Fgroups%2F7');
    const { useSearchParams } = await import('react-router-dom');
    vi.mocked(useSearchParams).mockReturnValue([
      new URLSearchParams('token=valid-token&next=%2Ftest%2Fgroups%2F7'),
      vi.fn(),
    ] as ReturnType<typeof useSearchParams>);
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('sends a signed-out member to sign in with the page kept in ?next=', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, user: null });
    render(<VerifyEmailPage />);
    await waitFor(() => {
      expect(screen.getAllByRole('link').map((l) => l.getAttribute('href')))
        .toContain('/test/login?next=%2Ftest%2Fgroups%2F7');
    });
  });

  it('offers a signed-in member a Continue button to that page', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, user: { id: 1 } });
    render(<VerifyEmailPage />);
    const link = await screen.findByRole('link', { name: 'Continue' });
    expect(link.getAttribute('href')).toBe('/test/groups/7');
  });

  it('keeps the page in a replacement verification email', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, user: { id: 1 } });
    vi.mocked(mockApi.post).mockReset();
    vi.mocked(mockApi.post).mockResolvedValueOnce({ success: false, error: 'expired' }).mockResolvedValueOnce({ success: true });
    render(<VerifyEmailPage />);
    fireEvent.click(await screen.findByRole('button', { name: /resend/i }));
    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/auth/resend-verification', { return_to: '/test/groups/7' });
    });
  });

  it('ignores a ?next= pointing at another site', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, user: null });
    window.history.pushState({}, '', '/test/verify-email?token=valid-token&next=https%3A%2F%2Fevil.test');
    render(<VerifyEmailPage />);
    await waitFor(() => {
      const hrefs = screen.getAllByRole('link').map((l) => l.getAttribute('href'));
      expect(hrefs).toContain('/test/login');
      expect(hrefs.join(' ')).not.toContain('evil');
    });
  });
});
