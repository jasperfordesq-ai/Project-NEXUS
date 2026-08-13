// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for LoginPage — Passkey/WebAuthn functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';

// ── Mock webauthn module ────────────────────────────────────────────────────
const mockIsBiometricAvailable = vi.fn();
const mockIsConditionalMediationAvailable = vi.fn();
const mockStartConditionalAuthentication = vi.fn();

vi.mock('@/lib/webauthn', () => ({
  isBiometricAvailable: (...args: unknown[]) => mockIsBiometricAvailable(...args),
  isConditionalMediationAvailable: (...args: unknown[]) => mockIsConditionalMediationAvailable(...args),
  startConditionalAuthentication: (...args: unknown[]) => mockStartConditionalAuthentication(...args),
}));

// ── Mock auth context ───────────────────────────────────────────────────────
const mockLogin = vi.fn();
const mockLoginWithBiometric = vi.fn();
const mockVerify2FA = vi.fn();
const mockClearError = vi.fn();
const mockCancel2FA = vi.fn();
const mockTenantPath = vi.fn((p: string) => `/test${p}`);
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

const authDefaults = {
  status: 'idle' as string,
  error: null as string | null,
  isAuthenticated: false,
  login: mockLogin,
  loginWithBiometric: mockLoginWithBiometric,
  verify2FA: mockVerify2FA,
  clearError: mockClearError,
  cancel2FA: mockCancel2FA,
  twoFactorMethods: [] as string[],
  twoFactorTrustDeviceAllowed: true,
  twoFactorTrustedDeviceDays: 30,
  user: null,
  logout: vi.fn(),
  register: vi.fn(),
  updateUser: vi.fn(),
  refreshUser: vi.fn(),
};

let authOverrides: Partial<typeof authDefaults> = {};
let conditionalAutofillEnabled = true;
let passkeyAuthenticationEnabled = true;

vi.mock('@/contexts', () => ({
  useAuth: () => ({ ...authDefaults, ...authOverrides }),
  useTenant: () => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test', tagline: null },
    branding: { name: 'Test Community', logo_url: null },
    tenantSlug: 'test',
    tenantPath: mockTenantPath,
    authenticationConfig: { 'passkeys.conditional_autofill': conditionalAutofillEnabled },
    isLoading: false,
    hasFeature: vi.fn((feature: string) => feature !== 'biometric_login' || passkeyAuthenticationEnabled),
    hasModule: vi.fn(() => true),
  }),
  useToast: () => mockToast,

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

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ ...authDefaults, ...authOverrides }),
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test', tagline: null },
    branding: { name: 'Test Community', logo_url: null },
    tenantSlug: 'test',
    tenantPath: mockTenantPath,
    authenticationConfig: { 'passkeys.conditional_autofill': conditionalAutofillEnabled },
    isLoading: false,
    hasFeature: vi.fn((feature: string) => feature !== 'biometric_login' || passkeyAuthenticationEnabled),
    hasModule: vi.fn(() => true),
  }),
}));

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => mockToast,
}));

// ── Mock react-router-dom ───────────────────────────────────────────────────
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const React = await import('react');
  return {
    useNavigate: () => mockNavigate,
    useLocation: () => ({ state: null, pathname: '/login' }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
    Link: ({ children, to, ...props }: { children: ReactNode; to: string; [k: string]: unknown }) =>
      React.createElement('a', { href: to, ...props }, children),
    BrowserRouter: ({ children }: { children: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

// ── Mock api + tokenManager ─────────────────────────────────────────────────
// TOTAL factory (no importOriginal): the real module builds an ApiClient and
// registers listeners at module scope. It must therefore enumerate every export
// the render graph touches — `API_BASE` is read by SsoButtons and OAuthButtons,
// which LoginPage renders once a tenant is selected.
vi.mock('@/lib/api', () => ({
  API_BASE: '/api',
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: [] }),
    post: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: {
    setTenantId: vi.fn(),
    clearTokens: vi.fn(),
    setAccessToken: vi.fn(),
    setRefreshToken: vi.fn(),
    getTenantId: vi.fn(),
  },
}));

// ── Mock UI dependencies ────────────────────────────────────────────────────
// NOTE: LoginPage imports every UI primitive, icon, PageMeta and usePageTitle by
// its DIRECT path ('@/components/ui/Button', 'lucide-react/icons/mail',
// '@/components/seo/PageMeta', '@/hooks/usePageTitle'). These four barrel mocks
// are therefore INERT for this suite — the real modules load, which is why the
// autocomplete-contract test below can assert real rendered input attributes.
// Do not "fix" a selector by adding keys here; it will have no effect.
vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

vi.mock('@/components/seo', () => ({ PageMeta: () => null }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ── Mock framer-motion ──────────────────────────────────────────────────────
vi.mock('@/lib/motion', async () => {
  const React = await import('react');
  const handler: ProxyHandler<Record<string, never>> = {
    get: (_target, prop) => {
      return ({ children, _initial, _animate, _exit, _transition, _whileHover, _whileTap, _variants, _layout, ...rest }: Record<string, unknown>) =>
        React.createElement(prop as string, rest, children);
    },
  };
  return {
    motion: new Proxy({} as Record<string, never>, handler),
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
  };
});

// ── Mock lucide-react icons ─────────────────────────────────────────────────
vi.mock('lucide-react', async () => {
  const React = await import('react');
  const Icon = () => React.createElement('span');
  return {
    Mail: Icon, Lock: Icon, Eye: Icon, EyeOff: Icon,
    Shield: Icon, ArrowLeft: Icon, Loader2: Icon,
    Building2: Icon, Fingerprint: Icon, ShieldAlert: Icon, ShieldX: Icon,
  };
});

// ── Import component under test ─────────────────────────────────────────────
import { LoginPage } from './LoginPage';

// ── Tests ───────────────────────────────────────────────────────────────────
describe('LoginPage — Passkey/WebAuthn functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authOverrides = {};
    conditionalAutofillEnabled = true;
    passkeyAuthenticationEnabled = true;
    Object.defineProperty(window, 'PublicKeyCredential', {
      value: class MockPublicKeyCredential {},
      configurable: true,
    });
    // Defaults: biometric available, conditional mediation not supported
    mockIsBiometricAvailable.mockResolvedValue(true);
    mockIsConditionalMediationAvailable.mockResolvedValue(false);
    mockStartConditionalAuthentication.mockResolvedValue(null);
    mockLoginWithBiometric.mockResolvedValue({ success: false, errorCode: 'cancelled' });
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, 'PublicKeyCredential');
  });

  // ─── 1. Passkey button renders when biometric available + tenant selected ──
  it('renders passkey button when biometric is available and tenant is selected', async () => {
    render(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByText('Sign in with a passkey')).toBeDefined();
    });
  });

  // ─── 2. Passkey button NOT rendered when biometric unavailable ─────────────
  it('does NOT render passkey button when biometric is unavailable', async () => {
    Reflect.deleteProperty(window, 'PublicKeyCredential');

    render(<LoginPage />);

    expect(screen.queryByText('Sign in with a passkey')).toBeNull();
  });

  it('does not report support when PublicKeyCredential exists but is not callable', () => {
    Object.defineProperty(window, 'PublicKeyCredential', {
      value: undefined,
      configurable: true,
    });

    render(<LoginPage />);

    expect(screen.queryByText('Sign in with a passkey')).toBeNull();
  });

  it('hides explicit and conditional passkey authentication when the tenant master switch is off', async () => {
    passkeyAuthenticationEnabled = false;
    mockIsConditionalMediationAvailable.mockResolvedValue(true);

    render(<LoginPage />);
    const emailInput = document.querySelector('input[type="email"]') as HTMLInputElement;
    fireEvent.focus(emailInput);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByText('Sign in with a passkey')).toBeNull();
    expect(mockIsConditionalMediationAvailable).not.toHaveBeenCalled();
    expect(mockStartConditionalAuthentication).not.toHaveBeenCalled();
  });

  it('uses the required username WebAuthn autocomplete contract and stable field names', () => {
    render(<LoginPage />);

    const emailInput = document.querySelector('input[type="email"]') as HTMLInputElement;
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    expect(emailInput.id).toBe('login-email');
    expect(emailInput.name).toBe('username');
    expect(emailInput.autocomplete).toBe('username webauthn');
    expect(passwordInput.id).toBe('login-password');
    expect(passwordInput.name).toBe('password');
  });

  // ─── 3. handleBiometricLogin calls loginWithBiometric (no email) ───────────
  it('calls loginWithBiometric with undefined when no email entered', async () => {
    mockLoginWithBiometric.mockResolvedValue({ success: false, errorCode: 'cancelled' });
    const user = userEvent.setup();

    render(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByText('Sign in with a passkey')).toBeDefined();
    });

    await user.click(screen.getByText('Sign in with a passkey'));

    expect(mockLoginWithBiometric).toHaveBeenCalledWith(undefined, expect.any(AbortSignal));
  });

  // ─── 4. handleBiometricLogin passes email when filled ──────────────────────
  it('keeps the passkey ceremony account-agnostic when email is filled', async () => {
    mockLoginWithBiometric.mockResolvedValue({ success: false, errorCode: 'cancelled' });
    const user = userEvent.setup();

    render(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByText('Sign in with a passkey')).toBeDefined();
    });

    // Set email value via fireEvent.change to avoid per-keystroke re-render issues.
    // Located by type rather than by label: the real HeroUI Input renders the
    // label in a sibling <label> element, and `input[type="email"]` is unique here.
    const emailInput = document.querySelector('input[type="email"]') as HTMLInputElement;
    expect(emailInput).not.toBeNull();
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(emailInput, { target: { value: 'alice@example.com' } });

    await user.click(screen.getByText('Sign in with a passkey'));

    expect(mockLoginWithBiometric).toHaveBeenCalledWith(undefined, expect.any(AbortSignal));
  });

  // ─── 5. Conditional mediation starts when tenant selected ──────────────────
  it('starts conditional mediation when tenant is selected and mediation is available', async () => {
    mockIsConditionalMediationAvailable.mockResolvedValue(true);
    mockStartConditionalAuthentication.mockResolvedValue(null);

    render(<LoginPage />);
    fireEvent.focus(document.querySelector('input[type="email"]') as HTMLInputElement);

    await waitFor(() => {
      expect(mockIsConditionalMediationAvailable).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mockStartConditionalAuthentication).toHaveBeenCalledWith(
        expect.any(AbortSignal),
      );
    });
  });

  it('disables conditional autofill without disabling explicit passkey login', async () => {
    conditionalAutofillEnabled = false;
    mockIsConditionalMediationAvailable.mockResolvedValue(true);
    const user = userEvent.setup();

    render(<LoginPage />);
    fireEvent.focus(document.querySelector('input[type="email"]') as HTMLInputElement);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockIsConditionalMediationAvailable).not.toHaveBeenCalled();
    expect(mockStartConditionalAuthentication).not.toHaveBeenCalled();

    await user.click(screen.getByText('Sign in with a passkey'));
    expect(mockLoginWithBiometric).toHaveBeenCalledWith(undefined, expect.any(AbortSignal));
  });

  // ─── 6. Conditional mediation aborted on unmount ───────────────────────────
  it('aborts conditional mediation on unmount', async () => {
    mockIsConditionalMediationAvailable.mockResolvedValue(true);
    // Keep the conditional auth pending so the abort ref stays active
    mockStartConditionalAuthentication.mockReturnValue(new Promise(() => {}));

    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');

    const { unmount } = render(<LoginPage />);
    fireEvent.focus(document.querySelector('input[type="email"]') as HTMLInputElement);

    await waitFor(() => {
      expect(mockStartConditionalAuthentication).toHaveBeenCalled();
    });

    unmount();

    expect(abortSpy).toHaveBeenCalled();
    abortSpy.mockRestore();
  });

  it('aborts an explicit passkey attempt when the login page unmounts', async () => {
    let receivedSignal: AbortSignal | undefined;
    mockLoginWithBiometric.mockImplementation((_email, signal: AbortSignal) => {
      receivedSignal = signal;
      return new Promise(() => {});
    });
    const user = userEvent.setup();
    const { unmount } = render(<LoginPage />);

    await user.click(screen.getByText('Sign in with a passkey'));
    await waitFor(() => expect(receivedSignal).toBeDefined());
    unmount();

    expect(receivedSignal?.aborted).toBe(true);
  });

  // ─── 6b. StrictMode double-mount must net out to ONE credential request ────
  // Pre-fix, the mount effect fired the conditional flow twice per page load
  // (two /webauthn/auth-challenge POSTs, two stacked credential requests).
  it('starts conditional mediation exactly once under StrictMode double-mount', async () => {
    const { StrictMode } = await import('react');
    mockIsConditionalMediationAvailable.mockResolvedValue(true);
    mockStartConditionalAuthentication.mockReturnValue(new Promise(() => {}));

    render(
      <StrictMode>
        <LoginPage />
      </StrictMode>,
    );
    fireEvent.focus(document.querySelector('input[type="email"]') as HTMLInputElement);

    await waitFor(() => {
      expect(mockStartConditionalAuthentication).toHaveBeenCalled();
    });
    // Settle any second deferred start before counting
    await new Promise((r) => setTimeout(r, 20));

    expect(mockStartConditionalAuthentication).toHaveBeenCalledTimes(1);
  });

  // ─── 6c. Mount must never start a MODAL credential request ─────────────────
  // Only the conditional (silent, autofill-integrated) flow may run without a
  // user click. A modal request on mount pops a native OS passkey dialog.
  it('never starts a modal credential request on mount', async () => {
    mockIsConditionalMediationAvailable.mockResolvedValue(true);

    render(<LoginPage />);

    expect(mockStartConditionalAuthentication).not.toHaveBeenCalled();
    expect(mockLoginWithBiometric).not.toHaveBeenCalled();
  });

  // ─── 6d. No conditional request when mediation is unavailable ──────────────
  // Without conditional support, ANY mount-time credential request would be
  // modal — there must be none at all.
  it('starts no credential request at all when conditional mediation is unavailable', async () => {
    mockIsConditionalMediationAvailable.mockResolvedValue(false);

    render(<LoginPage />);
    fireEvent.focus(document.querySelector('input[type="email"]') as HTMLInputElement);

    await waitFor(() => {
      expect(mockIsConditionalMediationAvailable).toHaveBeenCalled();
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(mockStartConditionalAuthentication).not.toHaveBeenCalled();
    expect(mockLoginWithBiometric).not.toHaveBeenCalled();
  });

  // ─── 7. Error toast when no passkey found ──────────────────────────────────
  it('maps the stable credential-not-found code without parsing English text', async () => {
    mockLoginWithBiometric.mockResolvedValue({
      success: false,
      error: 'Localized backend text',
      errorCode: 'AUTH_WEBAUTHN_CREDENTIAL_NOT_FOUND',
    });
    const user = userEvent.setup();

    render(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByText('Sign in with a passkey')).toBeDefined();
    });

    await user.click(screen.getByText('Sign in with a passkey'));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        'No passkey found for this account. Log in with your password, then go to Settings to register a passkey.',
      );
    });
  });

  // ─── 8. Successful passkey login navigates to dashboard ────────────────────
  it('navigates to dashboard on successful passkey login', async () => {
    mockLoginWithBiometric.mockResolvedValue({ success: true });
    const user = userEvent.setup();

    render(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByText('Sign in with a passkey')).toBeDefined();
    });

    await user.click(screen.getByText('Sign in with a passkey'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/test/feed', { replace: true });
    });
  });

  it('accepts alphanumeric backup codes and normalises them before verification', async () => {
    authOverrides = {
      status: 'requires_2fa',
      twoFactorMethods: ['totp', 'backup_code'],
    };
    mockVerify2FA.mockResolvedValue(true);
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByLabelText('Use backup code instead'));
    fireEvent.change(screen.getByLabelText('Backup Code'), {
      target: { value: 'AB12-CD34' },
    });
    await user.click(screen.getByText('Verify'));

    await waitFor(() => {
      expect(mockVerify2FA).toHaveBeenCalledWith({
        code: 'AB12CD34',
        use_backup_code: true,
        trust_device: false,
      });
    });
  });

  it('hides trusted-device opt-in when tenant policy disables it', () => {
    authOverrides = {
      status: 'requires_2fa',
      twoFactorMethods: ['totp', 'backup_code'],
      twoFactorTrustDeviceAllowed: false,
    };

    render(<LoginPage />);

    expect(screen.queryByText(/Trust this device/)).toBeNull();
  });

  it('shows the configured trusted-device duration', () => {
    authOverrides = {
      status: 'requires_2fa',
      twoFactorMethods: ['totp'],
      twoFactorTrustDeviceAllowed: true,
      twoFactorTrustedDeviceDays: 14,
    };

    render(<LoginPage />);

    expect(screen.getByText('Trust this device for 14 days')).toBeDefined();
  });
});

// ─── Awaiting-approval sign-in outcome ──────────────────────────────────────
//
// 🔴 Before these tests this file had NO coverage of loginErrorCode at all, so
// nothing noticed that a member waiting for coordinator approval was shown a
// red "Sign-in failed. Please check your details and try again." — telling them
// they had mistyped something they had typed correctly. Approval-required is
// the DEFAULT for a new community, so that was the normal new-member
// experience. Reported from a live community on 2026-08-12.
describe('LoginPage — awaiting-approval sign-in outcome', () => {
  /** The generic copy AuthContext puts in `error` for any failed sign-in. */
  const GENERIC_FAILURE = 'Sign-in failed. Please check your details and try again.';
  const PENDING_HEADLINE = "You're registered and waiting for approval";

  beforeEach(() => {
    vi.clearAllMocks();
    authOverrides = {};
    conditionalAutofillEnabled = true;
    passkeyAuthenticationEnabled = true;
    mockIsBiometricAvailable.mockResolvedValue(false);
    mockIsConditionalMediationAvailable.mockResolvedValue(false);
    mockStartConditionalAuthentication.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
  });

  async function submitLogin(errorCode: string) {
    // `error` is what AuthContext exposes; `errorCode` is what login() returns
    // and what LoginPage keys its explanation panels off. Both are needed: the
    // alert box only renders when `error` is set.
    authOverrides = { error: GENERIC_FAILURE };
    mockLogin.mockResolvedValue({ success: false, errorCode });

    const user = userEvent.setup();
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'waiting@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'the-correct-password' },
    });
    await user.click(screen.getByText('Sign In'));
  }

  it('leads with the real reason instead of "check your details"', async () => {
    await submitLogin('AUTH_ACCOUNT_PENDING_APPROVAL');

    await waitFor(() => {
      expect(screen.getByText(PENDING_HEADLINE)).toBeInTheDocument();
    });

    // The whole point: do not tell someone their correct details are wrong.
    expect(screen.queryByText(GENERIC_FAILURE)).not.toBeInTheDocument();
  });

  it('announces politely rather than as an error', async () => {
    await submitLogin('AUTH_ACCOUNT_PENDING_APPROVAL');

    await waitFor(() => {
      expect(screen.getByText(PENDING_HEADLINE)).toBeInTheDocument();
    });

    // role="status" not role="alert" — a screen reader should not hear this as
    // a failure either. Guards the calm treatment at the markup level, so a
    // restyle cannot quietly turn it back into an error.
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('still shows the generic failure for a genuinely bad sign-in', async () => {
    await submitLogin('AUTH_INVALID_CREDENTIALS');

    // Regression guard in the other direction: the calm treatment must apply
    // ONLY to pending approval. A wrong password must still say so, loudly.
    await waitFor(() => {
      expect(screen.getByText(GENERIC_FAILURE)).toBeInTheDocument();
    });

    expect(screen.queryByText(PENDING_HEADLINE)).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
