// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock webauthn module
const mockIsWebAuthnSupported = vi.fn();
const mockRegisterBiometric = vi.fn();
const mockGetWebAuthnCredentials = vi.fn();
const mockGetWebAuthnStatus = vi.fn();
const mockConfirmWebAuthnSecurity = vi.fn();
const mockRemoveWebAuthnCredential = vi.fn();
const mockRemoveAllWebAuthnCredentials = vi.fn();
const mockRenameWebAuthnCredential = vi.fn();
const mockDetectPlatform = vi.fn();
const mockLogout = vi.fn();
let passkeyAuthenticationEnabled = true;
let passkeyEnrollmentEnabled = true;

vi.mock('@/lib/webauthn', () => ({
  isWebAuthnSupported: (...args: unknown[]) => mockIsWebAuthnSupported(...args),
  registerBiometric: (...args: unknown[]) => mockRegisterBiometric(...args),
  getWebAuthnCredentials: (...args: unknown[]) => mockGetWebAuthnCredentials(...args),
  getWebAuthnStatus: (...args: unknown[]) => mockGetWebAuthnStatus(...args),
  confirmWebAuthnSecurity: (...args: unknown[]) => mockConfirmWebAuthnSecurity(...args),
  removeWebAuthnCredential: (...args: unknown[]) => mockRemoveWebAuthnCredential(...args),
  removeAllWebAuthnCredentials: (...args: unknown[]) => mockRemoveAllWebAuthnCredentials(...args),
  renameWebAuthnCredential: (...args: unknown[]) => mockRenameWebAuthnCredential(...args),
  detectPlatform: (...args: unknown[]) => mockDetectPlatform(...args),
}));

// Mock toast context
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('@/contexts', () => ({
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
  useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: mockLogout, register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null }),
  useTenant: () => ({
    tenant: { id: 2, name: 'Test', slug: 'test', tagline: null },
    branding: { name: 'Test', logo_url: null },
    tenantSlug: 'test',
    tenantPath: (p: string) => '/test' + p,
    authenticationConfig: { 'passkeys.enrollment_enabled': passkeyEnrollmentEnabled },
    isLoading: false,
    hasFeature: vi.fn((feature: string) => feature !== 'biometric_login' || passkeyAuthenticationEnabled),
    hasModule: vi.fn(() => true),
  }),
}));

// Mock i18next
const settingsTranslations: Record<string, string> = {
  'biometric.platform_windows_title': 'Setting up on Windows',
  'biometric.platform_windows_step1': 'Click "This PC" to create a passkey stored on this computer. You\'ll confirm with your Windows Hello PIN, fingerprint, or face.',
  'biometric.platform_windows_step2': 'Requirement: You must have Windows Hello set up first. Go to Windows Settings > Accounts > Sign-in options > PIN to set it up.',
  'biometric.platform_windows_step3': 'Or click "Phone, tablet, or security key" to scan a QR code with your phone instead.',
  'biometric.platform_windows_step4': 'To set up passkeys on your phone too, open this page on your phone and tap "This device".',
  biometric_all_removed: 'Removed {{count}} passkey(s).',
  biometric_checking: 'Checking passkey support...',
  biometric_enabled: '{{count}} passkey(s) registered',
  biometric_last_used: 'Last used',
  biometric_not_enabled: 'Sign in faster with fingerprint, face, or PIN.',
  biometric_not_supported: 'Passkeys are not supported in this browser.',
  biometric_registered: 'Passkey registered successfully.',
  biometric_registered_on: 'Registered',
  biometric_remove: 'Remove passkey',
  biometric_remove_all: 'Remove All Passkeys',
  biometric_removed: 'Passkey removed.',
  biometric_title: 'Passkey Login',
  cancel: 'Cancel',
  try_again: 'Try Again',
  passkey_add_another: 'Add another passkey',
  passkey_create: 'Create a passkey',
  passkey_device_tip: 'Register a passkey on each device you use. To add your phone, open this page on your phone.',
  passkey_enrollment_disabled: 'Your community has paused new passkey setup. Existing passkeys can still be managed.',
  passkey_default_device_name: 'This device',
  passkey_limit_reached: 'You have reached the limit of {{count}} passkeys. Remove one before adding another.',
  passkey_rp_label: 'Works on {{rpId}}',
  passkey_rp_mismatch: 'This passkey was created for {{rpId}} and will not work on {{currentRpId}}. Add a new passkey on this domain.',
  passkey_rp_unknown: 'This older passkey may not appear at signed-out login and its original domain cannot be verified. While signed in, add a new passkey, then remove this one.',
  passkey_load_failed: 'We could not load your passkeys.',
  passkey_multi_device_note: 'You can register passkeys on multiple devices. Each device needs its own passkey unless your passkey provider syncs them (e.g., iCloud Keychain syncs across Apple devices, Google Password Manager syncs across Android and Chrome).',
  passkey_registration_failed: 'Registration failed',
  passkey_remove_all_confirm: 'Remove All',
  passkey_remove_all_failed: 'Failed to remove credentials',
  passkey_remove_all_title: 'Remove All Passkeys',
  passkey_remove_all_warning: 'Are you sure you want to remove all passkeys? You\'ll need to set them up again on each device.',
  passkey_remove_failed: 'Failed to remove credential',
  passkey_remove_named: 'Remove {{name}}',
  passkey_remove_warning: 'Remove {{name}}? You will no longer be able to use it to sign in.',
  passkey_rename: 'Rename passkey',
  passkey_rename_named: 'Rename {{name}}',
  passkey_rename_failed: 'Failed to rename passkey',
  passkey_rename_input: 'New passkey name',
  passkey_renamed: 'Passkey renamed.',
  passkey_setup_guide: 'Setup guide',
  passkey_setup_subtitle: 'Setup for this device',
  passkey_setup_tooltip: 'Show passkey setup guide',
  passkey_show_instructions: 'Show passkey setup instructions',
  passkey_security_confirm_title: 'Confirm it is you',
  passkey_security_confirm_description: 'Confirm your identity before changing passkeys.',
  passkey_security_confirm_method_label: 'Confirmation method',
  passkey_security_confirm_password: 'Current password',
  passkey_security_confirm_totp: 'Authenticator code',
  passkey_security_confirm_backup: 'Backup code',
  passkey_security_confirm_action: 'Confirm',
  passkey_security_confirm_failed: 'We could not confirm your identity.',
  passkey_security_confirm_no_method: 'Sign out and sign in again with your passkey before making this change.',
  passkey_sessions_revoked: 'Your passkey changed. Sign in again on every device.',
};

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, opts?: { fallbackValue?: string; count?: number; name?: string; rpId?: string; currentRpId?: string }) => {
      const template = settingsTranslations[key] ?? opts?.fallbackValue ?? key;
      return template
        .replace('{{count}}', String(opts?.count ?? ''))
        .replace('{{name}}', opts?.name ?? '')
        .replace('{{rpId}}', opts?.rpId ?? '')
        .replace('{{currentRpId}}', opts?.currentRpId ?? '');
    },
  }),
}));

// Mock HeroUI components minimally
vi.mock('@/components/ui', async () => {
  const React = await import('react');
  return {
    Button: ({ children, onPress, isDisabled, isLoading, ...props }: Record<string, unknown>) =>
      React.createElement('button', {
        onClick: onPress as (() => void) | undefined,
        disabled: isDisabled || isLoading,
        'data-testid': props['data-testid'],
        'aria-label': props['aria-label'],
        'aria-pressed': props['aria-pressed'],
      }, isLoading ? 'Loading...' : children),
    Spinner: () => React.createElement('div', { 'data-testid': 'spinner' }, 'Loading...'),
    Tooltip: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
      isOpen ? React.createElement('div', { 'data-testid': 'modal', role: 'dialog' }, children) : null,
    ModalContent: ({ children }: { children: ((onClose: () => void) => React.ReactNode) | React.ReactNode }) =>
      React.createElement('div', null, typeof children === 'function' ? children(() => {}) : children),
    ModalHeader: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'modal-header' }, children),
    ModalBody: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'modal-body' }, children),
    ModalFooter: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'modal-footer' }, children),
    Input: ({ label, value, onValueChange, ...props }: Record<string, unknown>) =>
      React.createElement('label', null,
        label as React.ReactNode,
        React.createElement('input', {
          value: value as string,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => (onValueChange as ((value: string) => void))?.(event.target.value),
          type: props.type as string,
          'aria-label': label as string,
        }),
      ),
    useDisclosure: () => {
      const [isOpen, setIsOpen] = React.useState(false);
      return {
        isOpen,
        onOpen: () => setIsOpen(true),
        onOpenChange: (open: boolean) => setIsOpen(open),
        onClose: () => setIsOpen(false),
      };
    },
  };
});

import { BiometricSettings } from './BiometricSettings';

describe('BiometricSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectPlatform.mockReturnValue('windows');
    mockIsWebAuthnSupported.mockReturnValue(true);
    passkeyAuthenticationEnabled = true;
    passkeyEnrollmentEnabled = true;
    // getWebAuthnCredentials returns Credential[] directly (not {credentials, count})
    mockGetWebAuthnCredentials.mockResolvedValue([]);
    mockGetWebAuthnStatus.mockResolvedValue({
      registered: false,
      count: 0,
      current_rp_id: 'localhost',
      max_credentials: 10,
      confirmation_methods: { password: true, passkey: false, totp: false },
    });
    mockConfirmWebAuthnSecurity.mockResolvedValue({
      success: true,
      securityConfirmationToken: 'security-token',
      expiresIn: 300,
    });
    mockRemoveWebAuthnCredential.mockResolvedValue({ success: true });
    mockRemoveAllWebAuthnCredentials.mockResolvedValue({ success: true, removedCount: 0 });
    mockRenameWebAuthnCredential.mockResolvedValue({ success: true });
    mockLogout.mockResolvedValue(undefined);
  });

  it('renders loading state initially', () => {
    mockGetWebAuthnCredentials.mockReturnValue(new Promise(() => {})); // never resolves
    render(<BiometricSettings />);
    expect(screen.getByTestId('spinner')).toBeDefined();
  });

  it('shows a retryable error instead of treating a credential-list failure as empty', async () => {
    mockGetWebAuthnCredentials
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([]);
    const user = userEvent.setup();
    render(<BiometricSettings />);

    expect(await screen.findByText('We could not load your passkeys.')).toBeDefined();
    await user.click(screen.getByText('Try Again'));
    expect(await screen.findByText('Create a passkey')).toBeDefined();
    expect(mockGetWebAuthnCredentials).toHaveBeenCalledTimes(2);
  });

  it('renders empty state when no credentials', async () => {
    render(<BiometricSettings />);
    await waitFor(() => {
      expect(screen.getByText('Create a passkey')).toBeDefined();
    });
  });

  it('shows "Add another passkey" when credentials exist', async () => {
    mockGetWebAuthnCredentials.mockResolvedValue([
      { credential_id: 'abc123', device_name: 'Windows Hello', authenticator_type: 'platform', created_at: '2026-01-01', last_used_at: null },
    ]);
    render(<BiometricSettings />);
    await waitFor(() => {
      expect(screen.getByText('Add another passkey')).toBeDefined();
    });
  });

  it('calls registerBiometric when create button is clicked', async () => {
    mockRegisterBiometric.mockResolvedValue({ success: true });
    const user = userEvent.setup();

    render(<BiometricSettings />);
    await waitFor(() => {
      expect(screen.getByText('Create a passkey')).toBeDefined();
    });

    await user.click(screen.getByText('Create a passkey'));
    await waitFor(() => {
      expect(mockRegisterBiometric).toHaveBeenCalledWith('This device', undefined, 'security-token');
    });
  });

  it('prevents a second sensitive action while recent-session confirmation is in flight', async () => {
    let resolveConfirmation: ((value: {
      success: boolean;
      securityConfirmationToken: string;
      expiresIn: number;
    }) => void) | undefined;
    mockConfirmWebAuthnSecurity.mockReturnValue(new Promise((resolve) => {
      resolveConfirmation = resolve;
    }));
    mockRegisterBiometric.mockResolvedValue({ success: true });
    render(<BiometricSettings />);
    const button = await screen.findByText('Create a passkey');

    fireEvent.click(button);
    fireEvent.click(button);

    expect(mockConfirmWebAuthnSecurity).toHaveBeenCalledTimes(1);
    resolveConfirmation?.({
      success: true,
      securityConfirmationToken: 'single-token',
      expiresIn: 300,
    });
    await waitFor(() => expect(mockRegisterBiometric).toHaveBeenCalledTimes(1));
  });

  it('maps the credential-limit error to a specific translated explanation', async () => {
    mockRegisterBiometric.mockResolvedValue({
      success: false,
      errorCode: 'WEBAUTHN_CREDENTIAL_LIMIT',
    });
    const user = userEvent.setup();
    render(<BiometricSettings />);

    await user.click(await screen.findByText('Create a passkey'));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        'You have reached the limit of 10 passkeys. Remove one before adding another.',
      );
    });
  });

  it('hides enrollment and explains when the configured credential limit is reached', async () => {
    mockGetWebAuthnCredentials.mockResolvedValue([
      { credential_id: 'abc123', device_name: 'Windows Hello', authenticator_type: 'platform', created_at: '2026-01-01', last_used_at: null },
    ]);
    mockGetWebAuthnStatus.mockResolvedValue({
      registered: true,
      count: 1,
      max_credentials: 1,
      current_rp_id: 'localhost',
      confirmation_methods: { password: true, passkey: true, totp: false },
    });

    render(<BiometricSettings />);

    expect(await screen.findByText(/reached the limit of 1 passkeys/i)).toBeDefined();
    expect(screen.queryByText('Add another passkey')).toBeNull();
  });

  it('identifies credentials bound to a different relying-party domain', async () => {
    mockGetWebAuthnCredentials.mockResolvedValue([
      { credential_id: 'abc123', device_name: 'Old domain', authenticator_type: 'platform', created_at: '2026-01-01', last_used_at: null, rp_id: 'old.example.org' },
    ]);
    mockGetWebAuthnStatus.mockResolvedValue({
      registered: true,
      count: 1,
      max_credentials: 10,
      current_rp_id: 'new.example.org',
      confirmation_methods: { password: true, passkey: true, totp: false },
    });

    render(<BiometricSettings />);

    expect(await screen.findByText(/created for old\.example\.org/i)).toHaveTextContent('new.example.org');
  });

  it('explains when a legacy credential has no relying-party metadata', async () => {
    mockGetWebAuthnCredentials.mockResolvedValue([
      { credential_id: 'legacy123', device_name: 'Older passkey', authenticator_type: 'platform', created_at: '2025-01-01', last_used_at: null, rp_id: null },
    ]);

    render(<BiometricSettings />);

    expect(await screen.findByText(/may not appear at signed-out login/i)).toBeDefined();
  });

  it('prompts re-enrollment for a pre-discoverable credential even when its domain is known', async () => {
    mockGetWebAuthnCredentials.mockResolvedValue([
      {
        credential_id: 'legacy-known-rp',
        device_name: 'Older security key',
        authenticator_type: 'cross-platform',
        created_at: '2025-01-01',
        last_used_at: null,
        rp_id: 'localhost',
        credential_discoverable: null,
      },
    ]);

    render(<BiometricSettings />);

    expect(await screen.findByText(/may not appear at signed-out login/i)).toBeDefined();
  });

  it('requires and submits step-up confirmation when the current session is not recent', async () => {
    mockConfirmWebAuthnSecurity
      .mockResolvedValueOnce({ success: false, errorCode: 'SECURITY_CONFIRMATION_REQUIRED' })
      .mockResolvedValueOnce({
        success: true,
        securityConfirmationToken: 'confirmed-token',
        expiresIn: 300,
      });
    mockRegisterBiometric.mockResolvedValue({ success: true });
    const user = userEvent.setup();

    render(<BiometricSettings />);
    await user.click(await screen.findByText('Create a passkey'));

    expect(await screen.findByText('Confirm it is you')).toBeDefined();
    await user.type(screen.getByLabelText('Current password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(mockConfirmWebAuthnSecurity).toHaveBeenLastCalledWith({ current_password: 'correct horse' });
      expect(mockRegisterBiometric).toHaveBeenCalledWith('This device', undefined, 'confirmed-token');
    });
  });

  it('exposes the selected step-up method through aria-pressed', async () => {
    mockGetWebAuthnStatus.mockResolvedValue({
      registered: false,
      count: 0,
      current_rp_id: 'localhost',
      max_credentials: 10,
      confirmation_methods: { password: true, passkey: false, totp: true },
    });
    mockConfirmWebAuthnSecurity.mockResolvedValue({
      success: false,
      errorCode: 'SECURITY_CONFIRMATION_REQUIRED',
    });
    const user = userEvent.setup();
    render(<BiometricSettings />);

    await user.click(await screen.findByText('Create a passkey'));
    const password = await screen.findByRole('button', { name: 'Current password' });
    const totp = screen.getByRole('button', { name: 'Authenticator code' });
    expect(password).toHaveAttribute('aria-pressed', 'true');
    expect(totp).toHaveAttribute('aria-pressed', 'false');

    await user.click(totp);
    expect(password).toHaveAttribute('aria-pressed', 'false');
    expect(totp).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows success toast on registration', async () => {
    mockRegisterBiometric.mockResolvedValue({ success: true });
    const user = userEvent.setup();

    render(<BiometricSettings />);
    await waitFor(() => {
      expect(screen.getByText('Create a passkey')).toBeDefined();
    });

    await user.click(screen.getByText('Create a passkey'));
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith('Passkey registered successfully.');
    });
  });

  it('shows error toast on registration failure', async () => {
    mockRegisterBiometric.mockResolvedValue({ success: false, error: 'Aborted' });
    const user = userEvent.setup();

    render(<BiometricSettings />);
    await waitFor(() => {
      expect(screen.getByText('Create a passkey')).toBeDefined();
    });

    await user.click(screen.getByText('Create a passkey'));
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Registration failed');
    });
  });

  it('shows confirmation modal when "Remove All Passkeys" is clicked', async () => {
    mockGetWebAuthnCredentials.mockResolvedValue([
      { credential_id: 'abc', device_name: 'Test', authenticator_type: 'platform', created_at: '2026-01-01', last_used_at: null },
      { credential_id: 'def', device_name: 'Test 2', authenticator_type: 'cross-platform', created_at: '2026-01-02', last_used_at: null },
    ]);
    const user = userEvent.setup();

    render(<BiometricSettings />);
    // Wait for credentials to load (button only shows when > 1 credential)
    await waitFor(() => {
      expect(screen.getByText('Test')).toBeDefined();
    });

    // The button text is "Remove All Passkeys"
    const removeAllBtn = screen.getByText('Remove All Passkeys');
    await user.click(removeAllBtn);
    await waitFor(() => {
      expect(screen.getByTestId('modal')).toBeDefined();
    });
  });

  it('renders not-supported message when WebAuthn unavailable', async () => {
    mockIsWebAuthnSupported.mockReturnValue(false);

    render(<BiometricSettings />);
    await waitFor(() => {
      expect(screen.getByText(/passkeys are not supported/i)).toBeDefined();
    });
  });

  it('shows credential device name', async () => {
    mockGetWebAuthnCredentials.mockResolvedValue([
      { credential_id: 'a', device_name: 'Device A', authenticator_type: 'platform', created_at: '2026-01-01', last_used_at: null },
    ]);

    render(<BiometricSettings />);
    await waitFor(() => {
      expect(screen.getByText('Device A')).toBeDefined();
    });
  });

  it('shows setup instructions by default', async () => {
    render(<BiometricSettings />);
    await waitFor(() => {
      // showInstructions defaults to true, so multi-device note is visible
      expect(screen.getByText(/iCloud Keychain syncs across Apple devices/)).toBeDefined();
    });
  });

  it('hides empty passkey settings when the tenant master switch is disabled', async () => {
    passkeyAuthenticationEnabled = false;
    render(<BiometricSettings />);

    await waitFor(() => {
      expect(screen.queryByText('Create a passkey')).toBeNull();
      expect(screen.queryByText('Passkey Login')).toBeNull();
    });
  });

  it('retains credential management when passkey sign-in is disabled', async () => {
    passkeyAuthenticationEnabled = false;
    mockGetWebAuthnCredentials.mockResolvedValue([
      { credential_id: 'existing', device_name: 'Existing key', authenticator_type: 'platform', created_at: '2026-01-01', last_used_at: null },
    ]);
    render(<BiometricSettings />);
    expect(await screen.findByText('Existing key')).toBeDefined();
    expect(screen.queryByText('Create a passkey')).toBeNull();
    expect(screen.queryByText('Add another passkey')).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove Existing key' })).toBeDefined();
  });

  it('keeps existing passkeys manageable even when this browser cannot create another', async () => {
    mockIsWebAuthnSupported.mockReturnValue(false);
    mockGetWebAuthnCredentials.mockResolvedValue([
      { credential_id: 'cross-platform', device_name: 'Security key', authenticator_type: 'cross-platform', created_at: '2026-01-01', last_used_at: null },
    ]);

    render(<BiometricSettings />);

    expect(await screen.findByText(/Security key/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Remove Security key' })).toBeDefined();
    expect(screen.queryByText('Add another passkey')).toBeNull();
  });

  it('keeps existing passkeys manageable and explains when new enrollment is disabled', async () => {
    passkeyEnrollmentEnabled = false;
    mockGetWebAuthnCredentials.mockResolvedValue([
      { credential_id: 'abc123', device_name: 'Windows Hello', authenticator_type: 'platform', created_at: '2026-01-01', last_used_at: null },
    ]);

    render(<BiometricSettings />);

    await waitFor(() => {
      expect(screen.getByText(/Windows Hello/)).toBeDefined();
    });
    expect(screen.queryByText('Add another passkey')).toBeNull();
    expect(screen.queryByText(/iCloud Keychain syncs across Apple devices/)).toBeNull();
    expect(screen.getByText(/paused new passkey setup/i)).toBeDefined();
  });

  it('explains when the final sign-in method cannot be removed', async () => {
    mockGetWebAuthnCredentials.mockResolvedValue([
      { credential_id: 'abc123', device_name: 'Windows Hello', authenticator_type: 'platform', created_at: '2026-01-01', last_used_at: null },
    ]);
    mockRemoveWebAuthnCredential.mockResolvedValue({
      success: false,
      errorCode: 'LAST_SIGN_IN_METHOD',
    });
    const user = userEvent.setup();

    render(<BiometricSettings />);
    const removeButton = await screen.findByRole('button', { name: 'Remove Windows Hello' });
    await user.click(removeButton);

    expect(mockRemoveWebAuthnCredential).not.toHaveBeenCalled();
    expect(screen.getByText(/Remove Windows Hello\?/)).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Remove passkey' }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('common:oauth.cannot_disconnect_last');
    });
  });

  it('clears local authentication when passkey removal revokes all sessions', async () => {
    mockGetWebAuthnCredentials.mockResolvedValue([
      { credential_id: 'abc123', device_name: 'Windows Hello', authenticator_type: 'platform', created_at: '2026-01-01', last_used_at: null },
    ]);
    mockRemoveWebAuthnCredential.mockResolvedValue({
      success: true,
      sessionsRevoked: true,
    });
    const user = userEvent.setup();

    render(<BiometricSettings />);
    await user.click(await screen.findByRole('button', { name: 'Remove Windows Hello' }));
    await user.click(screen.getByRole('button', { name: 'Remove passkey' }));

    await waitFor(() => {
      expect(mockRemoveWebAuthnCredential).toHaveBeenCalledWith('abc123', 'security-token');
      expect(mockLogout).toHaveBeenCalledTimes(1);
      expect(mockToast.success).toHaveBeenCalledWith('Your passkey changed. Sign in again on every device.');
    });
  });
});
