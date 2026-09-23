// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const {
  mockCreateOAuthBrowserBinding,
  mockClearOAuthBrowserVerifier,
  mockConfirmWebAuthnSecurity,
  mockGetWebAuthnStatus,
} = vi.hoisted(() => ({
  mockCreateOAuthBrowserBinding: vi.fn().mockResolvedValue({
    challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  }),
  mockClearOAuthBrowserVerifier: vi.fn(),
  mockConfirmWebAuthnSecurity: vi.fn(),
  mockGetWebAuthnStatus: vi.fn(),
}));

vi.mock('@/lib/webauthn', () => ({
  confirmWebAuthnSecurity: mockConfirmWebAuthnSecurity,
  getWebAuthnStatus: mockGetWebAuthnStatus,
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

vi.mock('@/lib/oauth-browser-binding', () => ({
  createOAuthBrowserBinding: mockCreateOAuthBrowserBinding,
  clearOAuthBrowserVerifier: mockClearOAuthBrowserVerifier,
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  })
);

import userEvent from '@testing-library/user-event';
import { api } from '@/lib/api';
import { ConnectedAccountsTab } from './ConnectedAccountsTab';

const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const makeIdentitiesResponse = (overrides: Partial<{
  identities: object[];
  enabled_providers: string[];
  supported_providers: string[];
}> = {}) => ({
  identities: [],
  enabled_providers: ['google', 'facebook'],
  supported_providers: ['google', 'facebook'],
  ...overrides,
});

const makeIdentity = (provider = 'google', overrides = {}) => ({
  provider,
  provider_email: `user@${provider}.com`,
  avatar_url: null,
  linked_at: '2024-01-15T10:00:00Z',
  last_used_at: null,
  ...overrides,
});

describe('ConnectedAccountsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateOAuthBrowserBinding.mockResolvedValue({ challenge: CHALLENGE });
    // Default: the session is recent enough for a silent confirmation.
    mockConfirmWebAuthnSecurity.mockResolvedValue({
      success: true,
      securityConfirmationToken: 'silent-token',
      expiresIn: 300,
    });
    mockGetWebAuthnStatus.mockResolvedValue({
      registered: false,
      count: 0,
      confirmation_methods: { password: true, passkey: false, totp: false },
    });
  });

  it('shows provider list while loading', () => {
    // Never resolves → component stays in loading state, but still renders
    // the UI skeleton with the supported providers from defaults
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<ConnectedAccountsTab />);
    // Before data loads, providers fall back to default list ['google','facebook']
    // so list items are rendered immediately
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0);
  });

  it('renders both supported providers when data loads', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: makeIdentitiesResponse(),
    });

    render(<ConnectedAccountsTab />);

    await waitFor(() => {
      // Google / Facebook labels are rendered via t('oauth.provider_google') etc.
      // In test environment i18n returns the key itself or falls back — check list items
      expect(screen.getAllByRole('listitem').length).toBe(2);
    });
  });

  it('shows connected email when an account is linked', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: makeIdentitiesResponse({
        identities: [makeIdentity('google', { provider_email: 'jasper@gmail.com' })],
      }),
    });

    render(<ConnectedAccountsTab />);

    await waitFor(() => {
      expect(screen.getByText('jasper@gmail.com')).toBeInTheDocument();
    });
  });

  it('shows "not connected" text for unlinked providers that are enabled', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: makeIdentitiesResponse({
        identities: [],
        enabled_providers: ['google'],
      }),
    });

    render(<ConnectedAccountsTab />);

    await waitFor(() => {
      // Multiple "not connected" labels for unlinked-but-enabled providers
      const notConnected = screen.getAllByText(/oauth\.not_connected|not.connected/i);
      expect(notConnected.length).toBeGreaterThan(0);
    });
  });

  it('shows "provider unavailable" for disabled providers', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: makeIdentitiesResponse({
        identities: [],
        enabled_providers: [],
        supported_providers: ['google'],
      }),
    });

    render(<ConnectedAccountsTab />);

    // i18n resolves 'oauth.provider_unavailable' → "Not available for this community"
    await waitFor(() => {
      const unavailable = screen.getAllByText(/Not available for this community/i);
      expect(unavailable.length).toBeGreaterThan(0);
    });
  });

  it('shows Disconnect button for a linked account', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: makeIdentitiesResponse({
        identities: [makeIdentity('google'), makeIdentity('facebook')],
      }),
    });

    render(<ConnectedAccountsTab />);

    await waitFor(() => {
      // When more than 1 identity is linked, disconnect button should NOT be disabled
      const disconnectBtns = screen.getAllByRole('button');
      expect(disconnectBtns.length).toBeGreaterThan(0);
    });
  });

  it('calls DELETE /v2/auth/oauth/:provider/unlink on disconnect', async () => {
    // Two identities so the disconnect isn't blocked (not the only auth method)
    vi.mocked(api.get)
      .mockResolvedValueOnce({
        success: true,
        data: makeIdentitiesResponse({
          identities: [makeIdentity('google'), makeIdentity('facebook')],
        }),
      })
      .mockResolvedValueOnce({
        success: true,
        data: makeIdentitiesResponse({
          identities: [makeIdentity('facebook')],
        }),
      });

    vi.mocked(api.delete).mockResolvedValueOnce({ success: true });

    render(<ConnectedAccountsTab />);

    await waitFor(() => {
      expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    });

    // Find the disconnect/connect buttons; first linked identity gets "Disconnect"
    const buttons = screen.getAllByRole('button');
    // Click the first button that corresponds to a connected account
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith(
        expect.stringContaining('/v2/auth/oauth/'),
      );
    });

    expect(mockToast.success).toHaveBeenCalled();
  });

  it('calls POST /v2/auth/oauth/:provider/link on connect (redirect initiated)', async () => {
    const originalLocation = window.location;
    // Allow setting window.location.href
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, href: '' },
    });

    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: makeIdentitiesResponse({ identities: [] }),
    });
    vi.mocked(api.post).mockResolvedValueOnce({
      success: true,
      data: { redirect_url: 'https://accounts.google.com/o/oauth2/auth?...' },
    });

    render(<ConnectedAccountsTab />);

    await waitFor(() => {
      expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    });

    // All providers are unlinked so "Connect" buttons should appear
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining('/v2/auth/oauth/'),
        {
          browser_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
          security_confirmation_token: 'silent-token',
        },
      );
    });
    // The silent attempt carries no credentials.
    expect(mockConfirmWebAuthnSecurity).toHaveBeenCalledWith();
    expect(screen.queryByText('Confirm it is you')).not.toBeInTheDocument();

    // Restore
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('shows error toast when connect API call fails', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: makeIdentitiesResponse({ identities: [] }),
    });
    vi.mocked(api.post).mockRejectedValueOnce(new Error('Network error'));

    render(<ConnectedAccountsTab />);

    await waitFor(() => {
      expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    });

    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    expect(mockClearOAuthBrowserVerifier).toHaveBeenCalledWith(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('shows error toast when disconnect API call fails', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: makeIdentitiesResponse({
        identities: [makeIdentity('google'), makeIdentity('facebook')],
      }),
    });
    vi.mocked(api.delete).mockRejectedValueOnce(new Error('Network error'));

    render(<ConnectedAccountsTab />);

    await waitFor(() => {
      expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    });

    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('disables disconnect button when it is the only remaining auth method', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: makeIdentitiesResponse({
        identities: [makeIdentity('google')], // only one identity → only auth method
        enabled_providers: ['google', 'facebook'],
      }),
    });

    render(<ConnectedAccountsTab />);

    await waitFor(() => {
      expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    });

    // The disconnect button for the sole identity should be aria-disabled
    const disconnectBtn = screen.getAllByRole('button').find((b) => {
      const txt = b.textContent ?? '';
      return /cannot.disconnect|oauth\.cannot_disconnect/i.test(txt);
    });
    expect(disconnectBtn).toBeTruthy();
  });
  // F-056: linking a provider needs a fresh security confirmation.
  describe('security confirmation before linking (F-056)', () => {
    const renderWithNoLinks = async () => {
      vi.mocked(api.get).mockResolvedValueOnce({
        success: true,
        data: makeIdentitiesResponse({ identities: [], supported_providers: ['google'] }),
      });
      render(<ConnectedAccountsTab />);
      const connect = await screen.findByRole('button', { name: 'Connect' });
      await waitFor(() => expect(connect).not.toBeDisabled());
      return connect;
    };

    let originalLocation: Location;
    beforeEach(() => {
      originalLocation = window.location;
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...originalLocation, href: '' },
      });
    });
    afterEach(() => {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    });

    it('asks for a confirmation when the silent attempt fails, then sends the token', async () => {
      mockConfirmWebAuthnSecurity
        .mockResolvedValueOnce({ success: false, errorCode: 'SECURITY_CONFIRMATION_REQUIRED' })
        .mockResolvedValueOnce({ success: true, securityConfirmationToken: 'typed-token', expiresIn: 300 });
      vi.mocked(api.post).mockResolvedValueOnce({
        success: true,
        data: { redirect_url: 'https://accounts.google.com/o/oauth2/auth?x=1' },
      });
      const user = userEvent.setup();
      const connect = await renderWithNoLinks();

      await user.click(connect);

      expect(await screen.findByText('Confirm it is you')).toBeInTheDocument();
      expect(screen.getByText('Confirm your identity before connecting a new sign-in method.')).toBeInTheDocument();
      // Nothing is linked (and no browser binding is minted) until confirmed.
      expect(api.post).not.toHaveBeenCalled();
      expect(mockCreateOAuthBrowserBinding).not.toHaveBeenCalled();

      await user.type(screen.getByLabelText('Current password'), 'correct horse');
      await user.click(screen.getByRole('button', { name: 'Confirm' }));

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/v2/auth/oauth/google/link', {
          browser_challenge: CHALLENGE,
          security_confirmation_token: 'typed-token',
        });
      });
      expect(mockConfirmWebAuthnSecurity).toHaveBeenLastCalledWith({ current_password: 'correct horse' });
      expect(window.location.href).toBe('https://accounts.google.com/o/oauth2/auth?x=1');
    });

    it('keeps the modal open with an error when the confirmation is rejected', async () => {
      mockConfirmWebAuthnSecurity
        .mockResolvedValueOnce({ success: false })
        .mockResolvedValueOnce({ success: false, errorCode: 'SECURITY_CONFIRMATION_FAILED' });
      const user = userEvent.setup();
      const connect = await renderWithNoLinks();

      await user.click(connect);
      await user.type(await screen.findByLabelText('Current password'), 'wrong');
      await user.click(screen.getByRole('button', { name: 'Confirm' }));

      expect(await screen.findByText('We could not confirm your identity. Check your details and try again.')).toBeInTheDocument();
      expect(screen.getByText('Confirm it is you')).toBeInTheDocument();
      expect(api.post).not.toHaveBeenCalled();
    });

    it('cancel closes the modal and leaves nothing pending', async () => {
      mockConfirmWebAuthnSecurity.mockResolvedValueOnce({ success: false });
      const user = userEvent.setup();
      const connect = await renderWithNoLinks();

      await user.click(connect);
      await user.type(await screen.findByLabelText('Current password'), 'half-typed');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(screen.queryByText('Confirm it is you')).not.toBeInTheDocument());
      expect(api.post).not.toHaveBeenCalled();
      expect(mockCreateOAuthBrowserBinding).not.toHaveBeenCalled();
      expect(mockToast.error).not.toHaveBeenCalled();
      const connectAgain = screen.getByRole('button', { name: 'Connect' });
      expect(connectAgain).not.toBeDisabled();

      // Re-opening starts from a clean form (the silent attempt is not repeated).
      await user.click(connectAgain);
      expect(await screen.findByLabelText('Current password')).toHaveValue('');
      expect(mockConfirmWebAuthnSecurity).toHaveBeenCalledTimes(1);
    });

    it('re-prompts when the server refuses the token as stale', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        success: false,
        code: 'SECURITY_CONFIRMATION_REQUIRED',
        error: 'SECURITY_CONFIRMATION_REQUIRED',
      });
      const user = userEvent.setup();
      const connect = await renderWithNoLinks();

      await user.click(connect);

      expect(await screen.findByText('Confirm it is you')).toBeInTheDocument();
      expect(screen.getByText('We could not confirm your identity. Check your details and try again.')).toBeInTheDocument();
      expect(mockClearOAuthBrowserVerifier).toHaveBeenCalledWith(CHALLENGE);
      expect(mockToast.error).not.toHaveBeenCalled();
    });

    it('offers authenticator and backup codes when the account has TOTP', async () => {
      mockConfirmWebAuthnSecurity
        .mockResolvedValueOnce({ success: false })
        .mockResolvedValueOnce({ success: true, securityConfirmationToken: 'totp-token', expiresIn: 300 });
      mockGetWebAuthnStatus.mockResolvedValue({
        registered: false,
        count: 0,
        confirmation_methods: { password: false, passkey: false, totp: true },
      });
      vi.mocked(api.post).mockResolvedValueOnce({
        success: true,
        data: { redirect_url: 'https://accounts.google.com/o/oauth2/auth?x=2' },
      });
      const user = userEvent.setup();
      const connect = await renderWithNoLinks();

      await user.click(connect);
      expect(await screen.findByRole('button', { name: 'Backup code' })).toBeInTheDocument();
      await user.type(screen.getByLabelText('Authenticator code'), '123 456');
      await user.click(screen.getByRole('button', { name: 'Confirm' }));

      await waitFor(() => {
        expect(mockConfirmWebAuthnSecurity).toHaveBeenLastCalledWith({ totp_code: '123456' });
      });
      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/v2/auth/oauth/google/link', {
          browser_challenge: CHALLENGE,
          security_confirmation_token: 'totp-token',
        });
      });
    });
  });
});
