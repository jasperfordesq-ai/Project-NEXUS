// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { render, screen } from '@/test/test-utils';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { SecurityTab } from './SecurityTab';

let twoFactorEnrollmentAllowed = true;

vi.mock('@/contexts', () => ({
  useTenant: () => ({
    hasModule: vi.fn((_key: string) => true),
    hasFeature: (feature: string) => feature !== 'two_factor_authentication' || twoFactorEnrollmentAllowed,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.count !== undefined) return `${key}:${opts.count}`;
      return key;
    },
    i18n: { changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('@/components/security/BiometricSettings', () => ({
  BiometricSettings: () => <div data-testid="biometric-settings" />,
}));

// Use the shared lightweight UI mock so modal content (which only renders when
// the overlay is open) is queryable in jsdom and labeled inputs resolve via
// getByLabelText. The overlay stub returns null when isOpen is false, matching
// the real "closed modal renders nothing" behaviour the other tests rely on.
vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

const defaultProps = {
  // 2FA
  twoFactorEnabled: false,
  twoFactorLoading: false,
  twoFactorSetupData: null,
  twoFactorVerifyCode: '',
  isVerifying2FA: false,
  twoFactorDisablePassword: '',
  isDisabling2FA: false,
  backupCodes: [],
  backupCodesRemaining: 0,
  // Sessions
  sessions: [],
  sessionsLoading: false,
  sessionsError: null,
  onReloadSessions: vi.fn(),
  // Password
  passwordData: { current_password: '', new_password: '', confirm_password: '' },
  showCurrentPassword: false,
  showNewPassword: false,
  isChangingPassword: false,
  // Modals
  passwordModalOpen: false,
  passwordModalOnClose: vi.fn(),
  passwordModalOnOpen: vi.fn(),
  logoutModalOpen: false,
  logoutModalOnClose: vi.fn(),
  logoutModalOnOpen: vi.fn(),
  deleteModalOnOpen: vi.fn(),
  twoFactorSetupModalOpen: false,
  twoFactorSetupModalOnClose: vi.fn(),
  twoFactorDisableModalOpen: false,
  twoFactorDisableModalOnClose: vi.fn(),
  twoFactorDisableModalOnOpen: vi.fn(),
  backupCodesModalOpen: false,
  backupCodesModalOnClose: vi.fn(),
  // Handlers
  onPasswordDataChange: vi.fn(),
  onShowCurrentPasswordToggle: vi.fn(),
  onShowNewPasswordToggle: vi.fn(),
  onChangePassword: vi.fn(),
  onLogout: vi.fn(),
  onSetup2FA: vi.fn(),
  onVerify2FA: vi.fn(),
  onDisable2FA: vi.fn(),
  onTwoFactorVerifyCodeChange: vi.fn(),
  onTwoFactorDisablePasswordChange: vi.fn(),
  onCopyBackupCodes: vi.fn(),
};

describe('SecurityTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    twoFactorEnrollmentAllowed = true;
  });

  it('explains the requirement and hides disable when MFA is mandatory', () => {
    render(<SecurityTab {...defaultProps} twoFactorEnabled={true} twoFactorRequired={true} />);
    expect(screen.getByText('twofa_required_policy')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'twofa_disable' })).not.toBeInTheDocument();
  });

  it('renders security settings heading', () => {
    render(<SecurityTab {...defaultProps} />);
    expect(screen.getByText('security_settings')).toBeDefined();
  });

  it('renders Change Password button', () => {
    render(<SecurityTab {...defaultProps} />);
    expect(screen.getByText('change_password')).toBeDefined();
  });

  it('calls passwordModalOnOpen when Change Password clicked', async () => {
    const { userEvent } = await import('@/test/test-utils');
    const user = userEvent.setup();
    render(<SecurityTab {...defaultProps} />);
    await user.click(screen.getByText('change_password'));
    expect(defaultProps.passwordModalOnOpen).toHaveBeenCalled();
  });

  it('shows 2FA not enabled state when twoFactorEnabled is false', () => {
    render(<SecurityTab {...defaultProps} twoFactorEnabled={false} />);
    expect(screen.getByText('twofa_not_enabled')).toBeDefined();
    expect(screen.getByText('twofa_enable')).toBeDefined();
  });

  it('shows 2FA enabled state when twoFactorEnabled is true', () => {
    render(<SecurityTab {...defaultProps} twoFactorEnabled={true} />);
    expect(screen.getByText('twofa_enabled')).toBeDefined();
    expect(screen.getByText('twofa_disable')).toBeDefined();
  });

  it('shows checking state when twoFactorLoading is true', () => {
    render(<SecurityTab {...defaultProps} twoFactorLoading={true} />);
    expect(screen.getByText('twofa_checking')).toBeDefined();
  });

  it('shows backup codes remaining when 2FA enabled and has codes', () => {
    render(<SecurityTab {...defaultProps} twoFactorEnabled={true} backupCodesRemaining={5} />);
    expect(screen.getByText(/twofa_backup_remaining:5/)).toBeDefined();
  });

  it('calls onSetup2FA when Enable 2FA button clicked', async () => {
    const { userEvent } = await import('@/test/test-utils');
    const user = userEvent.setup();
    render(<SecurityTab {...defaultProps} twoFactorEnabled={false} />);
    await user.click(screen.getByText('twofa_enable'));
    expect(defaultProps.onSetup2FA).toHaveBeenCalled();
  });

  it('calls twoFactorDisableModalOnOpen when Disable 2FA clicked', async () => {
    const { userEvent } = await import('@/test/test-utils');
    const user = userEvent.setup();
    render(<SecurityTab {...defaultProps} twoFactorEnabled={true} />);
    await user.click(screen.getByText('twofa_disable'));
    expect(defaultProps.twoFactorDisableModalOnOpen).toHaveBeenCalled();
  });

  it('hides new 2FA enrollment when the tenant feature is off', () => {
    twoFactorEnrollmentAllowed = false;
    render(<SecurityTab {...defaultProps} twoFactorEnabled={false} />);

    expect(screen.queryByText('twofa_not_enabled')).toBeNull();
    expect(screen.queryByText('twofa_enable')).toBeNull();
  });

  it('keeps existing 2FA enrollment manageable when the tenant feature is off', () => {
    twoFactorEnrollmentAllowed = false;
    render(<SecurityTab {...defaultProps} twoFactorEnabled={true} />);

    expect(screen.getByText('twofa_enabled')).toBeDefined();
    expect(screen.getByText('twofa_disable')).toBeDefined();
  });

  it('renders sessions section', () => {
    render(<SecurityTab {...defaultProps} />);
    expect(screen.getByText('active_sessions')).toBeDefined();
  });

  it('shows sessions loading state', () => {
    render(<SecurityTab {...defaultProps} sessionsLoading={true} />);
    // Should show spinner/loading indicator
    expect(screen.queryByText('sessions_error')).toBeNull();
  });

  it('shows sessions error when sessionsError is set', () => {
    render(<SecurityTab {...defaultProps} sessionsError="Failed to load sessions" />);
    expect(screen.getByText('Failed to load sessions')).toBeDefined();
  });

  it('shows a retry button alongside the sessions error and wires it to onReloadSessions', async () => {
    const { userEvent } = await import('@/test/test-utils');
    const user = userEvent.setup();
    render(<SecurityTab {...defaultProps} sessionsError="Failed to load sessions" />);
    const retryBtn = screen.getByText('sessions_retry');
    await user.click(retryBtn);
    expect(defaultProps.onReloadSessions).toHaveBeenCalled();
  });

  it('shows a genuine empty state (not "coming soon") when sessions load succeeds with no rows', () => {
    // Regression: the sessions endpoint is live; the empty branch used to render
    // t('sessions_coming_soon'), mislabelling a working feature as unbuilt.
    render(<SecurityTab {...defaultProps} sessions={[]} sessionsError={null} />);
    expect(screen.getByText('sessions_empty')).toBeDefined();
    expect(screen.queryByText('sessions_coming_soon')).toBeNull();
  });

  it('renders session list when sessions provided', () => {
    const sessions = [
      { id: 'sess-1', device: 'Chrome', browser: 'Chrome 120', ip_address: '192.168.1.1', last_active: '2026-01-01', is_current: true },
      { id: 'sess-2', device: 'Firefox', browser: 'Firefox 119', ip_address: '10.0.0.1', last_active: '2026-01-02', is_current: false },
    ];
    render(<SecurityTab {...defaultProps} sessions={sessions} />);
    // The session renders as "{browser} {t('session_on')} {device}" in a single text node,
    // so use partial matching to find the browser/device text.
    expect(screen.getByText(/Chrome 120/)).toBeDefined();
    expect(screen.getByText(/Firefox 119/)).toBeDefined();
  });

  it('renders danger zone with logout and delete actions', () => {
    render(<SecurityTab {...defaultProps} />);
    // Component uses t('log_out') for the logout button, not 'logout_all_devices'
    expect(screen.getByText('log_out')).toBeDefined();
    expect(screen.getByText('delete_account')).toBeDefined();
  });

  it('renders BiometricSettings component', () => {
    render(<SecurityTab {...defaultProps} />);
    expect(screen.getByTestId('biometric-settings')).toBeDefined();
  });

  // The Delete Account modal now lives at the page level (SettingsPage) so it
  // can also be opened from the Privacy tab; this tab only triggers it. The
  // modal contents + password re-auth (H1 regression) are covered there.
  it('triggers deleteModalOnOpen when the delete account button is clicked', async () => {
    const { userEvent } = await import('@/test/test-utils');
    const user = userEvent.setup();
    render(<SecurityTab {...defaultProps} />);
    await user.click(screen.getByText('delete_account'));
    expect(defaultProps.deleteModalOnOpen).toHaveBeenCalled();
  });
});
