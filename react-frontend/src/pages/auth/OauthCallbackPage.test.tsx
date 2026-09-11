// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for OauthCallbackPage (SOC13)
 *
 * The page reads ?code= or ?error= from the URL, exchanges the code via a raw
 * fetch() POST to /api/v2/auth/oauth/exchange, then either sets tokens and
 * redirects to /dashboard or shows an error card.
 *
 * Mocking strategy:
 *  - react-router-dom: preserve everything, override useSearchParams via vi.hoisted().
 *  - context modules: inline stubs for every hook the component tree pulls in.
 *  - @/lib/api: tokenManager stubs via vi.hoisted().
 *  - @/hooks: stub usePageTitle (side-effect only).
 *  - @/components/seo: null stub for PageMeta.
 *  - global fetch: vi.stubGlobal() per test.
 *  - window.location.href: captured via Object.defineProperty.
 *  - react-i18next: identity translator so assertions match on key strings.
 */

import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';

// ─── vi.hoisted() — must come before vi.mock() calls ─────────────────────────
// Vitest hoists vi.mock() to the top of the file; any variable referenced
// inside the factory must itself be hoisted via vi.hoisted().

const {
  mockBeginChallenge,
  mockNavigate,
  mockSearchParams,
  mockSetAccessToken,
  mockSetRefreshToken,
  mockSetTenantId,
  mockGetOAuthBrowserVerifier,
  mockClearOAuthBrowserVerifier,
} = vi.hoisted(() => ({
  mockBeginChallenge: vi.fn(),
  mockNavigate: vi.fn(),
  mockSearchParams: vi.fn(),
  mockSetAccessToken: vi.fn(),
  mockSetRefreshToken: vi.fn(),
  mockSetTenantId: vi.fn(),
  mockGetOAuthBrowserVerifier: vi.fn(() => 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
  mockClearOAuthBrowserVerifier: vi.fn(),
}));

// ─── react-router-dom ────────────────────────────────────────────────────────
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useSearchParams: mockSearchParams,
    useNavigate: () => mockNavigate,
  };
});

// ─── @/contexts ───────────────────────────────────────────────────────────────
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ beginTwoFactorChallenge: mockBeginChallenge }) }));
vi.mock('@/contexts', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
  useAuth: vi.fn(() => ({
    user: null,
    isAuthenticated: false,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    updateUser: vi.fn(),
    refreshUser: vi.fn(),
    status: 'idle',
    error: null,
  })),
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  })),
  useTheme: vi.fn(() => ({
    resolvedTheme: 'light',
    theme: 'system',
    toggleTheme: vi.fn(),
    setTheme: vi.fn(),
  })),
  useNotifications: vi.fn(() => ({
    unreadCount: 0,
    counts: {},
    notifications: [],
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
    hasMore: false,
    loadMore: vi.fn(),
    isLoading: false,
    refresh: vi.fn(),
  })),
  usePusher: vi.fn(() => ({ channel: null, isConnected: false })),
  usePusherOptional: vi.fn(() => null),
  useCookieConsent: vi.fn(() => ({
    consent: null,
    showBanner: false,
    openPreferences: vi.fn(),
    resetConsent: vi.fn(),
    saveConsent: vi.fn(),
    hasConsent: vi.fn(() => true),
    updateConsent: vi.fn(),
  })),
  readStoredConsent: vi.fn(() => null),
  useMenuContext: vi.fn(() => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false })),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  usePresence: vi.fn(() => ({
    status: 'offline',
    setStatus: vi.fn(),
    getPresence: vi.fn(),
    isOnline: vi.fn(() => false),
  })),
  usePresenceOptional: vi.fn(() => null),
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
}));

// ─── @/lib/api — tokenManager ─────────────────────────────────────────────────
vi.mock('@/lib/api', () => ({
  API_BASE: 'https://api.example.test/api',
  tokenManager: {
    getAccessToken: vi.fn(() => null),
    setAccessToken: mockSetAccessToken,
    getRefreshToken: vi.fn(() => null),
    setRefreshToken: mockSetRefreshToken,
    getTenantId: vi.fn(() => null),
    setTenantId: mockSetTenantId,
    clearTokens: vi.fn(),
  },
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/oauth-browser-binding', () => ({
  getOAuthBrowserVerifier: mockGetOAuthBrowserVerifier,
  clearOAuthBrowserVerifier: mockClearOAuthBrowserVerifier,
}));

// ─── @/hooks ──────────────────────────────────────────────────────────────────
vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

// ─── @/components/seo ────────────────────────────────────────────────────────
vi.mock('@/components/seo', () => ({
  PageMeta: () => null,
}));

// ─── react-i18next — identity translator ─────────────────────────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ─── @/lib/motion ────────────────────────────────────────────────────────────
vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => (
      <div {...rest}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ─── Component import (after mocks) ──────────────────────────────────────────
import { OauthCallbackPage } from './OauthCallbackPage';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeParams(query: string) {
  return [new URLSearchParams(query), vi.fn()] as [URLSearchParams, ReturnType<typeof vi.fn>];
}

const BROWSER_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

function makeBoundCodeParams(code: string) {
  return makeParams(`code=${encodeURIComponent(code)}&flow=${BROWSER_CHALLENGE}`);
}

function makeResponse(body: object, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 400,
    json: () => Promise.resolve(body),
    headers: new Headers(),
  } as unknown as Response;
}

// ─────────────────────────────────────────────────────────────────────────────
// window.location.href capture
// ─────────────────────────────────────────────────────────────────────────────

let capturedHref = '';

beforeEach(() => {
  capturedHref = '';
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...window.location,
      set href(val: string) {
        capturedHref = val;
      },
      get href() {
        return capturedHref || 'http://localhost/';
      },
    },
  });

  // Default: empty params — individual tests override as needed.
  mockSearchParams.mockReturnValue(makeParams(''));
  vi.clearAllMocks();
  // Re-apply defaults that clearAllMocks wipes.
  mockSearchParams.mockReturnValue(makeParams(''));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('OauthCallbackPage', () => {
  it.each([false, true])('continues local MFA without installing credentials (setup=%s)', async (setup) => {
    mockSearchParams.mockReturnValue([new URLSearchParams('code=mfa-code&flow=test-flow'), vi.fn()]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      success: true, requires_2fa: !setup, requires_2fa_setup: setup,
      two_factor_token: 'restricted-challenge', methods: setup ? ['totp_setup'] : ['totp'], allow_trusted_device: false,
    }) }));
    render(<OauthCallbackPage />);
    await waitFor(() => expect(mockBeginChallenge).toHaveBeenCalledWith('restricted-challenge', setup, setup ? ['totp_setup'] : ['totp'], false));
    expect(mockSetAccessToken).not.toHaveBeenCalled();
    expect(mockSetRefreshToken).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining(setup ? '/auth/two-factor/setup' : '/login'), { replace: true });
  });
  // ── Loading state ──────────────────────────────────────────────────────────

  it('renders the signing-in text while the exchange is in flight', async () => {
    // Stall fetch indefinitely so the component stays in the loading state.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    mockSearchParams.mockReturnValue(makeBoundCodeParams('abc123'));

    render(<OauthCallbackPage />);

    expect(screen.getByText('oauth.callback_signing_in')).toBeInTheDocument();
  });

  // ── Success path ───────────────────────────────────────────────────────────

  it('exchanges the code and stores the access token on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        makeResponse({ success: true, token: 'jwt-abc', tenant_id: 99 }),
      ),
    );
    mockSearchParams.mockReturnValue(makeBoundCodeParams('valid-code'));

    render(<OauthCallbackPage />);

    await waitFor(() => {
      expect(mockSetAccessToken).toHaveBeenCalledWith('jwt-abc');
    });
    expect(mockGetOAuthBrowserVerifier).toHaveBeenCalledWith(BROWSER_CHALLENGE);
    expect(mockClearOAuthBrowserVerifier).toHaveBeenCalledWith(BROWSER_CHALLENGE);
  });

  it('stores the rotating refresh token returned by the exchange', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        makeResponse({
          success: true,
          access_token: 'jwt-abc',
          token: 'jwt-abc',
          refresh_token: 'refresh-xyz',
          tenant_id: 99,
        }),
      ),
    );
    mockSearchParams.mockReturnValue(makeBoundCodeParams('valid-code'));

    render(<OauthCallbackPage />);

    await waitFor(() => {
      expect(mockSetRefreshToken).toHaveBeenCalledWith('refresh-xyz');
    });
    expect(mockSetRefreshToken.mock.invocationCallOrder[0]).toBeLessThan(
      mockSetAccessToken.mock.invocationCallOrder[0],
    );
  });

  it('exchanges once and completes when StrictMode restarts the effect', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({
        success: true,
        access_token: 'strict-access',
        token: 'strict-access',
        refresh_token: 'strict-refresh',
        tenant_id: 99,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    mockSearchParams.mockReturnValue(makeBoundCodeParams('strict-mode-code'));

    render(
      <StrictMode>
        <OauthCallbackPage />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(capturedHref).toBe('/test/dashboard');
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockSetRefreshToken).toHaveBeenCalledWith('strict-refresh');
    expect(mockSetAccessToken).toHaveBeenCalledWith('strict-access');
    expect(mockSetRefreshToken.mock.invocationCallOrder[0]).toBeLessThan(
      mockSetAccessToken.mock.invocationCallOrder[0],
    );
    expect(mockClearOAuthBrowserVerifier).toHaveBeenCalledTimes(1);
    expect(mockClearOAuthBrowserVerifier).toHaveBeenCalledWith(BROWSER_CHALLENGE);
  });

  it('stores the tenant_id when the exchange response includes one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        makeResponse({ success: true, token: 'tok', tenant_id: 99 }),
      ),
    );
    mockSearchParams.mockReturnValue(makeBoundCodeParams('valid-code'));

    render(<OauthCallbackPage />);

    await waitFor(() => {
      expect(mockSetTenantId).toHaveBeenCalledWith('99');
    });
  });

  it('navigates to tenantPath /dashboard on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        makeResponse({ success: true, token: 'tok', tenant_id: 2 }),
      ),
    );
    mockSearchParams.mockReturnValue(makeBoundCodeParams('valid-code'));

    render(<OauthCallbackPage />);

    await waitFor(() => {
      expect(capturedHref).toBe('/test/dashboard');
    });
  });

  it('POSTs to the correct exchange endpoint with the code in the body', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({ success: true, token: 'tok', tenant_id: 2 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    mockSearchParams.mockReturnValue(makeBoundCodeParams('my-code'));

    render(<OauthCallbackPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.test/api/v2/auth/oauth/exchange',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            code: 'my-code',
            browser_verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
          }),
          credentials: 'include',
        }),
      );
    });
  });

  it('does not call setTenantId when the exchange response has no tenant_id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        makeResponse({ success: true, token: 'tok' }),
      ),
    );
    mockSearchParams.mockReturnValue(makeBoundCodeParams('no-tenant-code'));

    render(<OauthCallbackPage />);

    await waitFor(() => {
      expect(mockSetAccessToken).toHaveBeenCalledWith('tok');
    });
    expect(mockSetTenantId).not.toHaveBeenCalled();
  });

  // ── Error: backend redirects with ?error= param ────────────────────────────

  it('shows the error card when the backend redirects with ?error=', () => {
    vi.stubGlobal('fetch', vi.fn());
    mockSearchParams.mockReturnValue(
      makeParams('error=access_denied&message=User+denied+access'),
    );

    render(<OauthCallbackPage />);

    expect(
      screen.getByRole('heading', { name: 'oauth.callback_failed' }),
    ).toBeInTheDocument();
  });

  it('shows the error message param text in the error card', () => {
    vi.stubGlobal('fetch', vi.fn());
    mockSearchParams.mockReturnValue(
      makeParams('error=access_denied&message=User+denied+access'),
    );

    render(<OauthCallbackPage />);

    expect(screen.getByText('User denied access')).toBeInTheDocument();
  });

  it('falls back to the translation key when ?error= has no ?message=', () => {
    vi.stubGlobal('fetch', vi.fn());
    mockSearchParams.mockReturnValue(makeParams('error=server_error'));

    render(<OauthCallbackPage />);

    // When no ?message= is provided the paragraph also shows the translation
    // key. Both heading and paragraph match — use getAllByText.
    const matches = screen.getAllByText('oauth.callback_failed');
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('does not call fetch when ?error= is present', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mockSearchParams.mockReturnValue(makeParams('error=access_denied'));

    render(<OauthCallbackPage />);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders a back-to-login link in the error card pointing to tenantPath /login', () => {
    vi.stubGlobal('fetch', vi.fn());
    mockSearchParams.mockReturnValue(makeParams('error=access_denied'));

    render(<OauthCallbackPage />);

    const link = screen.getByRole('link', { name: /back_to_login/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/test/login');
  });

  // ── Error: no code in URL ──────────────────────────────────────────────────

  it('shows error card when no ?code= is present (empty query string)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // Default mockSearchParams already returns makeParams('') from beforeEach.

    render(<OauthCallbackPage />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'oauth.callback_failed' }),
      ).toBeInTheDocument();
    });

    // No fetch call because there is no code to exchange.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── Error: API exchange fails ──────────────────────────────────────────────

  it('shows error card when the exchange API returns a non-ok HTTP status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        makeResponse({ success: false, message: 'Token expired' }, false),
      ),
    );
    mockSearchParams.mockReturnValue(makeBoundCodeParams('expired-code'));

    render(<OauthCallbackPage />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'oauth.callback_failed' }),
      ).toBeInTheDocument();
    });

    expect(mockSetAccessToken).not.toHaveBeenCalled();
    expect(mockClearOAuthBrowserVerifier).not.toHaveBeenCalled();
    expect(capturedHref).toBe('');
  });

  it('shows error card when the exchange API returns success:false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(makeResponse({ success: false })),
    );
    mockSearchParams.mockReturnValue(makeBoundCodeParams('bad-code'));

    render(<OauthCallbackPage />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'oauth.callback_failed' }),
      ).toBeInTheDocument();
    });
  });

  it('shows error card when the exchange API omits the token field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(makeResponse({ success: true })),
    );
    mockSearchParams.mockReturnValue(makeBoundCodeParams('no-token-code'));

    render(<OauthCallbackPage />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'oauth.callback_failed' }),
      ).toBeInTheDocument();
    });
  });

  it('shows error card when fetch throws a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')),
    );
    mockSearchParams.mockReturnValue(makeBoundCodeParams('some-code'));

    render(<OauthCallbackPage />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'oauth.callback_failed' }),
      ).toBeInTheDocument();
    });
  });
});
