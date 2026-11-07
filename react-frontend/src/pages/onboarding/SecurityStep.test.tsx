// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for the onboarding "Protect your account" step, which uses the shared
 * TwoFactorEnrolment flow (the same one Settings → Security uses).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, userEvent, within } from '@/test/test-utils';

// HeroUI's InputOTP (input-otp) polls document.elementFromPoint on a timer
// once focused; jsdom has none. Stubbed per file, as src/test/setup.ts asks.
if (typeof document.elementFromPoint !== 'function') {
  Object.defineProperty(document, 'elementFromPoint', {
    writable: true,
    configurable: true,
    value: () => null,
  });
}

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

const mockConfirm = vi.fn();
vi.mock('@/lib/webauthn', () => ({
  confirmWebAuthnSecurity: (...args: unknown[]) => mockConfirm(...args),
  // The server only offers this step to members with a password.
  getWebAuthnStatus: () => Promise.resolve({ confirmation_methods: { password: true, totp: false, passkey: false } }),
}));

const stableToastValue = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () => ({
  useToast: vi.fn(() => stableToastValue),
  useAuth: vi.fn(() => ({ user: { id: 1 }, isAuthenticated: true, refreshUser: vi.fn() })),
  useTenant: vi.fn(() => ({ tenant: { id: 2, name: 'Test' }, tenantPath: (p: string) => p, hasFeature: vi.fn(() => true), hasModule: vi.fn(() => true) })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
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

vi.mock('@/contexts/ToastContext', () => ({
  useToast: vi.fn(() => stableToastValue),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { SecurityStep } from './SecurityStep';

function statusResponse(data: Record<string, unknown>) {
  return { success: true, data: { enabled: false, enrollment_allowed: true, backup_codes_remaining: 0, ...data } };
}

function renderStep() {
  const onNext = vi.fn();
  const onBack = vi.fn();
  const onUnavailable = vi.fn();
  const onProtected = vi.fn();
  render(<SecurityStep onNext={onNext} onBack={onBack} onUnavailable={onUnavailable} onProtected={onProtected} />);
  return { onNext, onBack, onUnavailable, onProtected };
}

function postedTo(url: string) {
  return mockPost.mock.calls.filter(([u]) => u === url);
}

const SECRET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const OTPAUTH = `otpauth://totp/Project%20NEXUS:member%40example.com?secret=${SECRET}&issuer=Project%20NEXUS`;

/** Server answers for a set-up that reaches the code screen; override `verify` per test. */
function serverWith(verify: () => unknown, setupData: Record<string, unknown> = { qr_code_url: 'data:image/svg+xml;base64,AAAA', secret: SECRET, provisioning_uri: OTPAUTH }) {
  mockPost.mockImplementation((url: string) => {
    if (url === '/v2/auth/2fa/setup') return Promise.resolve({ success: true, data: setupData });
    if (url === '/v2/auth/2fa/verify') return Promise.resolve(verify());
    return Promise.resolve({ success: true, data: {} });
  });
}

/** Click "Set it up", confirm with a password, and wait for the code screen. */
async function reachCodeScreen(user: ReturnType<typeof userEvent.setup>) {
  mockConfirm
    .mockResolvedValueOnce({ success: false, errorCode: 'SECURITY_CONFIRMATION_REQUIRED' })
    .mockResolvedValueOnce({ success: true, securityConfirmationToken: 'conf-tok', expiresIn: 300 });
  await user.click(await screen.findByRole('button', { name: /Set it up/ }));
  await user.type(await screen.findByLabelText('Current password'), 'CurrentPassword!123');
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
  await screen.findByTestId('twofa-enrol-setup');
  await waitFor(() => expect(document.querySelector('input[name="twofa-enrol-code"]')).not.toBeNull());
  return document.querySelector('input[name="twofa-enrol-code"]') as HTMLInputElement;
}

describe('SecurityStep (onboarding "Protect your account")', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue(statusResponse({}));
    mockPost.mockResolvedValue({ success: true, data: {} });
    // No recent passkey sign-in: the silent confirmation attempt is refused.
    mockConfirm.mockResolvedValue({ success: false, errorCode: 'SECURITY_CONFIRMATION_REQUIRED' });
  });

  it('explains two-step sign-in and offers "Set it up" and "Not now"', async () => {
    renderStep();
    expect(await screen.findByText('Protect your account')).toBeInTheDocument();
    expect(screen.getByText(/a 6-digit code from an authenticator app on your phone/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Set it up/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Not now/ })).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/v2/auth/2fa/status');
  });

  it('when two-factor is already on it says so and offers Back and Continue, instead of bouncing the member elsewhere', async () => {
    // Happens after turning it on earlier in this wizard and coming back
    // (Back, or the "Security" dot): this used to skip to the step before.
    mockGet.mockResolvedValue(statusResponse({ enabled: true }));
    const user = userEvent.setup();
    const { onUnavailable, onNext, onBack, onProtected } = renderStep();

    expect(await screen.findByText('Two-factor authentication is on')).toBeInTheDocument();
    expect(onUnavailable).not.toHaveBeenCalled();
    expect(onProtected).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Set it up/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Not now/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Continue/ }));
    expect(onNext).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: /Back/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('shows that "Set it up" is working while it gets ready', async () => {
    // Two calls run before anything changes on screen; without this the
    // button looked dead on a slow connection.
    let release: (value: unknown) => void = () => {};
    mockConfirm.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const user = userEvent.setup();
    renderStep();

    const setUp = await screen.findByRole('button', { name: /Set it up/ });
    await user.click(setUp);
    await waitFor(() => expect(setUp).toHaveAttribute('data-pending', 'true'));

    release({ success: false, errorCode: 'SECURITY_CONFIRMATION_REQUIRED' });
    expect(await screen.findByLabelText('Current password')).toBeInTheDocument();
  });

  it('asks for the password in a plain sentence, not a "Confirm Your Password" title', async () => {
    const user = userEvent.setup();
    renderStep();
    await user.click(await screen.findByRole('button', { name: /Set it up/ }));

    expect(await screen.findByText('Enter the password you use for this account.')).toBeInTheDocument();
    expect(screen.queryByText('Confirm Your Password')).not.toBeInTheDocument();
  });

  it('on a wrong code it says so beside the code boxes and clears them for another try', async () => {
    const user = userEvent.setup();
    serverWith(() => ({ success: false, code: 'VERIFICATION_FAILED', error: 'Invalid code. Please check the code and try again.' }));
    renderStep();

    const codeInput = await reachCodeScreen(user);
    await user.type(codeInput, '000000');
    await user.click(screen.getByRole('button', { name: 'Verify & Enable' }));

    const setup = screen.getByTestId('twofa-enrol-setup');
    expect(await within(setup).findByRole('alert')).toHaveTextContent('Invalid code. Please check the code and try again.');
    await waitFor(() => expect(codeInput.value).toBe(''));
    expect(stableToastValue.error).not.toHaveBeenCalled();
  });

  it('pressing Enter after typing the code verifies it', async () => {
    const user = userEvent.setup();
    serverWith(() => ({ success: true, data: { backup_codes: ['AAAA-1111'] } }));
    renderStep();

    const codeInput = await reachCodeScreen(user);
    await user.type(codeInput, '123456{Enter}');

    await waitFor(() => expect(postedTo('/v2/auth/2fa/verify')).toEqual([
      ['/v2/auth/2fa/verify', { code: '123456', security_confirmation_token: 'conf-tok' }],
    ]));
    expect(await screen.findByText('AAAA-1111')).toBeInTheDocument();
  });

  it('when the five-minute confirmation runs out, it asks for the password again instead of failing every code', async () => {
    // A new member installing an authenticator app can easily take longer.
    const user = userEvent.setup();
    serverWith(() => ({ success: false, code: 'SECURITY_CONFIRMATION_REQUIRED', error: 'Confirm it is you.' }));
    renderStep();

    const codeInput = await reachCodeScreen(user);
    await user.type(codeInput, '123456');
    await user.click(screen.getByRole('button', { name: 'Verify & Enable' }));

    expect(await screen.findByLabelText('Current password')).toBeInTheDocument();
    expect(screen.getByText('That took longer than five minutes, so please enter your password again.')).toBeInTheDocument();
    expect(screen.queryByTestId('twofa-enrol-setup')).not.toBeInTheDocument();
  });

  it('on the code screen: the key in groups of four, Copy key, Open in authenticator app, and readable code boxes', async () => {
    const user = userEvent.setup();
    serverWith(() => ({ success: true, data: { backup_codes: [] } }));
    renderStep();
    await reachCodeScreen(user);
    const setup = screen.getByTestId('twofa-enrol-setup');

    expect(within(setup).getByText('ABCD EFGH IJKL MNOP QRST UVWX YZ23 4567')).toBeInTheDocument();

    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    await user.click(within(setup).getByRole('button', { name: 'Copy key' }));
    expect(writeText).toHaveBeenCalledWith(SECRET);

    // A phone cannot scan its own screen: the otpauth:// link opens the app.
    expect(within(setup).getByRole('link', { name: /Open in authenticator app/ })).toHaveAttribute('href', OTPAUTH);

    // Google Authenticator's own page covers both Android and iPhone.
    expect(within(setup).getByRole('link', { name: 'Google Authenticator' }))
      .toHaveAttribute('href', 'https://support.google.com/accounts/answer/1066447');

    // HeroUI: inside a surface (this card, or a dialog) use the secondary variant.
    expect(setup.querySelector('.input-otp--secondary')).not.toBeNull();
  });

  it('offers no "Open in authenticator app" link unless the server sends a genuine otpauth link', async () => {
    const user = userEvent.setup();
    serverWith(() => ({ success: true, data: { backup_codes: [] } }), {
      qr_code_url: 'data:image/svg+xml;base64,AAAA', secret: SECRET, provisioning_uri: 'javascript:alert(1)',
    });
    renderStep();
    await reachCodeScreen(user);

    expect(screen.queryByRole('link', { name: /Open in authenticator app/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy key' })).toBeInTheDocument();
  });

  it('tells the wizard once two-factor has been turned on, so the step shows as done', async () => {
    const user = userEvent.setup();
    serverWith(() => ({ success: true, data: { backup_codes: ['AAAA-1111'] } }));
    const { onProtected } = renderStep();

    const codeInput = await reachCodeScreen(user);
    expect(onProtected).not.toHaveBeenCalled();
    await user.type(codeInput, '123456');
    await user.click(screen.getByRole('button', { name: 'Verify & Enable' }));

    await screen.findByText('AAAA-1111');
    expect(onProtected).toHaveBeenCalledTimes(1);
  });

  it('skips itself when the community does not allow setting it up', async () => {
    mockGet.mockResolvedValue(statusResponse({ enrollment_allowed: false }));
    const { onUnavailable } = renderStep();
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: /Set it up/ })).not.toBeInTheDocument();
  });

  it('"Not now" moves on without finishing onboarding or recording anything', async () => {
    const user = userEvent.setup();
    const { onNext, onUnavailable } = renderStep();
    await user.click(await screen.findByRole('button', { name: /Not now/ }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onUnavailable).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
    expect(postedTo('/v2/onboarding/complete')).toHaveLength(0);
  });

  it('asks the member to confirm it is them before set-up, then sends that token to setup and verify', async () => {
    const user = userEvent.setup();
    mockConfirm
      .mockResolvedValueOnce({ success: false, errorCode: 'SECURITY_CONFIRMATION_REQUIRED' })
      .mockResolvedValueOnce({ success: true, securityConfirmationToken: 'conf-tok', expiresIn: 300 });
    mockPost.mockImplementation((url: string) => {
      if (url === '/v2/auth/2fa/setup') {
        return Promise.resolve({ success: true, data: { qr_code_url: 'data:image/png;base64,AAAA', secret: SECRET } });
      }
      if (url === '/v2/auth/2fa/verify') {
        return Promise.resolve({ success: true, data: { backup_codes: ['AAAA-1111', 'BBBB-2222'] } });
      }
      return Promise.resolve({ success: true, data: {} });
    });
    const { onNext } = renderStep();

    await user.click(await screen.findByRole('button', { name: /Set it up/ }));

    // F-170: no set-up call until the member has confirmed it is them.
    const password = await screen.findByLabelText('Current password');
    expect(postedTo('/v2/auth/2fa/setup')).toHaveLength(0);
    await user.type(password, 'CurrentPassword!123');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(mockConfirm).toHaveBeenLastCalledWith({ current_password: 'CurrentPassword!123' });
    await waitFor(() => expect(postedTo('/v2/auth/2fa/setup')).toEqual([
      ['/v2/auth/2fa/setup', { security_confirmation_token: 'conf-tok' }],
    ]));

    // QR code and manual key (in groups of four) are shown inline.
    expect(await screen.findByText('ABCD EFGH IJKL MNOP QRST UVWX YZ23 4567')).toBeInTheDocument();
    const codeInput = document.querySelector('input[name="twofa-enrol-code"]') as HTMLInputElement;
    expect(codeInput).not.toBeNull();
    await user.type(codeInput, '123456');
    await user.click(screen.getByRole('button', { name: 'Verify & Enable' }));

    await waitFor(() => expect(postedTo('/v2/auth/2fa/verify')).toEqual([
      ['/v2/auth/2fa/verify', { code: '123456', security_confirmation_token: 'conf-tok' }],
    ]));

    // Backup codes are shown once, with the copy button.
    expect(await screen.findByText('AAAA-1111')).toBeInTheDocument();
    expect(screen.getByText('BBBB-2222')).toBeInTheDocument();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    await user.click(screen.getByRole('button', { name: /Copy All Codes/ }));
    expect(writeText).toHaveBeenCalledWith('AAAA-1111\nBBBB-2222');
    // No "Not now" once it is on: the only way forward is Continue.
    expect(screen.queryByRole('button', { name: /Not now/ })).not.toBeInTheDocument();

    expect(onNext).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(postedTo('/v2/onboarding/complete')).toHaveLength(0);
  });

  it('when confirmation fails (e.g. no password of their own) it says they can do it later and lets them carry on', async () => {
    const user = userEvent.setup();
    mockConfirm.mockResolvedValue({ success: false, errorCode: 'SECURITY_CONFIRMATION_REQUIRED' });
    const { onNext } = renderStep();

    await user.click(await screen.findByRole('button', { name: /Set it up/ }));
    await user.type(await screen.findByLabelText('Current password'), 'not-my-password');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText(/You can set this up later in Settings, under Security/)).toBeInTheDocument();
    // The check is never skipped: set-up was not attempted.
    expect(postedTo('/v2/auth/2fa/setup')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /Not now/ }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(postedTo('/v2/onboarding/complete')).toHaveLength(0);
  });
});
