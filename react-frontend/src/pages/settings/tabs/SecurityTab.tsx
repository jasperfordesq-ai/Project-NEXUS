// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.


import { getFormattingLocale } from '@/lib/helpers';
import Lock from 'lucide-react/icons/lock';
import Key from 'lucide-react/icons/key';
import LogOut from 'lucide-react/icons/log-out';
import Trash2 from 'lucide-react/icons/trash-2';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Eye from 'lucide-react/icons/eye';
import EyeOff from 'lucide-react/icons/eye-off';
import Monitor from 'lucide-react/icons/monitor';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ShieldCheck from 'lucide-react/icons/shield-check';
import ShieldOff from 'lucide-react/icons/shield-off';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { InputOTP } from '@/components/ui/InputOTP';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Description } from '@/components/ui/Description';
import { Label } from '@/components/ui/Label';
import { BiometricSettings } from '@/components/security/BiometricSettings';
import { TwoFactorRecovery } from '@/components/security/TwoFactorRecovery';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionInfo {
  id: string;
  device: string;
  browser: string;
  ip_address: string;
  last_active: string;
  is_current: boolean;
}

/**
 * Re-exported for older imports: the enrolment flow (QR code, verify, backup
 * codes) moved to `@/components/security/TwoFactorEnrolment`.
 */
export type { TwoFactorSetup } from '@/components/security/useTwoFactorEnrolment';

interface SecurityTabProps {
  // 2FA
  twoFactorRequired?: boolean;
  onRecoveryCodesChanged?: (count: number) => void;
  twoFactorEnabled: boolean;
  twoFactorLoading: boolean;
  twoFactorDisablePassword: string;
  twoFactorDisableCode: string;
  isDisabling2FA: boolean;
  backupCodesRemaining: number;
  // Sessions
  sessions: SessionInfo[];
  sessionsLoading: boolean;
  sessionsError: string | null;
  onReloadSessions: () => void;
  // Password
  passwordData: { current_password: string; new_password: string; confirm_password: string };
  showCurrentPassword: boolean;
  showNewPassword: boolean;
  isChangingPassword: boolean;
  // Modal disclosure objects
  passwordModalOpen: boolean;
  passwordModalOnClose: () => void;
  passwordModalOnOpen: () => void;
  logoutModalOpen: boolean;
  logoutModalOnClose: () => void;
  logoutModalOnOpen: () => void;
  // Delete Account modal lives at the page level (SettingsPage) so it can also
  // be opened from the Privacy tab; this tab only triggers it.
  deleteModalOnOpen: () => void;
  twoFactorDisableModalOpen: boolean;
  twoFactorDisableModalOnClose: () => void;
  twoFactorDisableModalOnOpen: () => void;
  // Handlers. Turning two-factor ON is handled by the page's shared
  // TwoFactorEnrolment; this tab only starts it (onSetup2FA).
  onPasswordDataChange: (updater: (prev: { current_password: string; new_password: string; confirm_password: string }) => { current_password: string; new_password: string; confirm_password: string }) => void;
  onShowCurrentPasswordToggle: () => void;
  onShowNewPasswordToggle: () => void;
  onChangePassword: () => void;
  onLogout: () => void;
  onSetup2FA: () => void;
  onDisable2FA: () => void;
  onTwoFactorDisablePasswordChange: (value: string) => void;
  onTwoFactorDisableCodeChange: (value: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Common style classNames
// ─────────────────────────────────────────────────────────────────────────────

const inputClassNames = {
  input: 'bg-transparent text-theme-primary',
  inputWrapper: 'bg-theme-elevated border-theme-default',
  label: 'text-theme-muted',
};

const modalClassNames = {
  base: 'bg-overlay border border-theme-default',
  header: 'border-b border-theme-default',
  body: 'py-6',
  footer: 'border-t border-theme-default',
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function SecurityTab({
  twoFactorRequired = false,
  onRecoveryCodesChanged,
  twoFactorEnabled,
  twoFactorLoading,
  twoFactorDisablePassword,
  twoFactorDisableCode,
  isDisabling2FA,
  backupCodesRemaining,
  sessions,
  sessionsLoading,
  sessionsError,
  onReloadSessions,
  passwordData,
  showCurrentPassword,
  showNewPassword,
  isChangingPassword,
  passwordModalOpen,
  passwordModalOnClose,
  passwordModalOnOpen,
  logoutModalOpen,
  logoutModalOnClose,
  logoutModalOnOpen,
  deleteModalOnOpen,
  twoFactorDisableModalOpen,
  twoFactorDisableModalOnClose,
  twoFactorDisableModalOnOpen,
  onPasswordDataChange,
  onShowCurrentPasswordToggle,
  onShowNewPasswordToggle,
  onChangePassword,
  onLogout,
  onSetup2FA,
  onDisable2FA,
  onTwoFactorDisablePasswordChange,
  onTwoFactorDisableCodeChange,
}: SecurityTabProps) {
  const { t } = useTranslation('settings');
  const { hasFeature } = useTenant();
  const twoFactorEnrollmentAllowed = twoFactorRequired || hasFeature('two_factor_authentication');

  return (
    <>
      <div className="space-y-6">
        {/* Password & 2FA */}
        <GlassCard className="p-6">
          <h2 className="text-lg font-semibold text-theme-primary mb-6">{t('security_settings')}</h2>

          <div className="space-y-4">
            {/* Change Password */}
            <Button
              variant="secondary"
              className="w-full min-h-16 justify-between px-4 py-4 text-left"
              onPress={passwordModalOnOpen}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="p-2 rounded-lg bg-accent/20">
                  <Lock className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                </div>
                <div className="min-w-0 leading-tight">
                  <p className="font-medium text-theme-primary">{t('change_password')}</p>
                  <p className="text-sm text-theme-subtle leading-snug">{t('change_password_subtitle')}</p>
                </div>
              </div>
            </Button>

            {/* Two-Factor Authentication. Keep existing enrollments manageable
                even if the tenant stops accepting new enrollment. */}
            {(twoFactorEnrollmentAllowed || twoFactorEnabled) && (
            <div className="w-full p-4 rounded-lg bg-theme-elevated text-left">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-500/20">
                    <Key className="w-5 h-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="font-medium text-theme-primary">{t('twofa_title')}</p>
                    <p className="text-sm text-theme-subtle">
                      {twoFactorLoading ? (
                        t('twofa_checking')
                      ) : twoFactorEnabled ? (
                        <span className="flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3 text-emerald-500" aria-hidden="true" />
                          {t('twofa_enabled')}
                          {backupCodesRemaining > 0 && (
                            <span className="text-theme-subtle">
                              {' '}&mdash; {t('twofa_backup_remaining', { count: backupCodesRemaining })}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <ShieldOff className="w-3 h-3 text-[var(--color-warning)]" aria-hidden="true" />
                          {t('twofa_not_enabled')}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                {!twoFactorLoading && (
                  <div>
                    {twoFactorRequired && twoFactorEnabled ? <p className="text-sm">{t('twofa_required_policy')}</p> : twoFactorEnabled ? (
                      <Button
                        size="sm"
                        variant="danger-soft"
                        onPress={twoFactorDisableModalOnOpen}
                      >
                        {t('twofa_disable')}
                      </Button>
                    ) : twoFactorEnrollmentAllowed ? (
                      <Button
                        size="sm"
                        className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white"
                        onPress={onSetup2FA}
                      >
                        {t('twofa_enable')}
                      </Button>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
            )}

            {/* Biometric / Passkey Authentication */}
            {twoFactorEnabled && <TwoFactorRecovery onCodesChanged={onRecoveryCodesChanged} />}
            <BiometricSettings />
          </div>
        </GlassCard>

        {/* Active Sessions */}
        <GlassCard className="p-6">
          <h2 className="text-lg font-semibold text-theme-primary mb-4 flex items-center gap-2">
            <Monitor className="w-5 h-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            {t('active_sessions')}
          </h2>

          {sessionsLoading ? (
            <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex items-center justify-center py-8">
              <Spinner size="lg" />
            </div>
          ) : sessionsError ? (
            <div role="alert" className="text-center py-6">
              <AlertTriangle className="w-10 h-10 text-[var(--color-warning)] mx-auto mb-3" aria-hidden="true" />
              <p className="text-theme-muted mb-4">{sessionsError}</p>
              <Button
                size="sm"
                variant="secondary"
                startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
                onPress={onReloadSessions}
              >
                {t('sessions_retry')}
              </Button>
            </div>
          ) : sessions.length > 0 ? (
            <div className="space-y-3">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-theme-elevated"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-theme-hover">
                      <Monitor className="w-4 h-4 text-theme-muted" aria-hidden="true" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-theme-primary flex items-center gap-2">
                        {session.browser} {t('session_on')} {session.device}
                        {session.is_current && (
                          <Chip size="sm" color="success" variant="soft">{t('session_current')}</Chip>
                        )}
                      </div>
                      <p className="text-xs text-theme-subtle">
                        {session.ip_address} - {t('session_last_active')} {new Date(session.last_active).toLocaleDateString(getFormattingLocale())}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6">
              <Monitor className="w-10 h-10 text-theme-subtle mx-auto mb-3" aria-hidden="true" />
              <p className="text-theme-muted">{t('sessions_empty')}</p>
            </div>
          )}
        </GlassCard>

        {/* Account Actions */}
        <GlassCard className="p-6">
          <h2 className="text-lg font-semibold text-theme-primary mb-4">{t('account_actions')}</h2>

          <div className="space-y-3">
            <Button
              variant="secondary"
              className="w-full justify-start"
              startContent={<LogOut className="w-4 h-4" aria-hidden="true" />}
              onPress={logoutModalOnOpen}
            >
              {t('log_out')}
            </Button>

            <Button
              variant="danger-soft"
              className="w-full justify-start"
              startContent={<Trash2 className="w-4 h-4" aria-hidden="true" />}
              onPress={deleteModalOnOpen}
            >
              {t('delete_account')}
            </Button>
          </div>
        </GlassCard>
      </div>

      {/* ─── Modals ─────────────────────────────────────────────────────────── */}

      {/* Change Password Modal */}
      <Modal isOpen={passwordModalOpen} onClose={passwordModalOnClose} classNames={modalClassNames}>
        <ModalContent>
          <ModalHeader className="text-theme-primary">{t('password_modal.title')}</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              <Input
                type={showCurrentPassword ? 'text' : 'password'}
                label={t('password.current')}
                value={passwordData.current_password}
                onChange={(e) => onPasswordDataChange((prev) => ({ ...prev, current_password: e.target.value }))}
                isRequired
                autoComplete="current-password"
                endContent={
                  <Button
                    isIconOnly
                    size="sm"
                    variant="tertiary"
                    className="min-h-8 min-w-8 p-0"
                    onPress={onShowCurrentPasswordToggle}
                    aria-label={showCurrentPassword ? t('password.hide_current') : t('password.show_current')}
                  >
                    {showCurrentPassword ? <EyeOff className="w-4 h-4 text-theme-subtle" aria-hidden="true" /> : <Eye className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
                  </Button>
                }
                classNames={inputClassNames}
              />
              <Input
                type={showNewPassword ? 'text' : 'password'}
                label={t('password.new')}
                value={passwordData.new_password}
                onChange={(e) => onPasswordDataChange((prev) => ({ ...prev, new_password: e.target.value }))}
                isRequired
                autoComplete="new-password"
                endContent={
                  <Button
                    isIconOnly
                    size="sm"
                    variant="tertiary"
                    className="min-h-8 min-w-8 p-0"
                    onPress={onShowNewPasswordToggle}
                    aria-label={showNewPassword ? t('password.hide_new') : t('password.show_new')}
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4 text-theme-subtle" aria-hidden="true" /> : <Eye className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
                  </Button>
                }
                classNames={inputClassNames}
              />
              <Input
                type="password"
                label={t('password.confirm')}
                value={passwordData.confirm_password}
                onChange={(e) => onPasswordDataChange((prev) => ({ ...prev, confirm_password: e.target.value }))}
                isRequired
                autoComplete="new-password"
                classNames={inputClassNames}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={passwordModalOnClose}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              onPress={onChangePassword}
              isLoading={isChangingPassword}
            >
              {t('password_modal.submit')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Logout Confirmation Modal */}
      <Modal isOpen={logoutModalOpen} onClose={logoutModalOnClose} classNames={modalClassNames}>
        <ModalContent>
          <ModalHeader className="text-theme-primary">{t('logout_modal.title')}</ModalHeader>
          <ModalBody>
            <p className="text-theme-muted">
              {t('logout_modal.confirm_message')}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={logoutModalOnClose}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              onPress={onLogout}
            >
              {t('logout_modal.submit')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 2FA Disable Modal */}
      <Modal isOpen={twoFactorDisableModalOpen} onClose={twoFactorDisableModalOnClose} classNames={modalClassNames}>
        <ModalContent>
          <ModalHeader className="text-red-600 dark:text-red-400 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" aria-hidden="true" />
            {t('twofa_disable_title')}
          </ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <p className="text-theme-warning font-medium">{t('twofa_disable_warning')}</p>
                <p className="text-theme-muted text-sm mt-1">
                  {t('twofa_disable_desc')}
                </p>
              </div>
              <Input
                type="password"
                label={t('twofa_confirm_password')}
                value={twoFactorDisablePassword}
                onChange={(e) => onTwoFactorDisablePasswordChange(e.target.value)}
                autoComplete="current-password"
                classNames={inputClassNames}
              />
              {/* Possession of the factor being removed: a current code, like login. */}
              <div className="flex flex-col gap-2 items-center">
                <Label className="self-start text-sm">{t('twofa_verification_code')}</Label>
                <InputOTP
                  maxLength={6}
                  name="disable-code"
                  value={twoFactorDisableCode}
                  onChange={(val) => onTwoFactorDisableCodeChange(val.replace(/\D/g, '').slice(0, 6))}
                >
                  <InputOTP.Group>
                    <InputOTP.Slot index={0} />
                    <InputOTP.Slot index={1} />
                    <InputOTP.Slot index={2} />
                  </InputOTP.Group>
                  <InputOTP.Separator />
                  <InputOTP.Group>
                    <InputOTP.Slot index={3} />
                    <InputOTP.Slot index={4} />
                    <InputOTP.Slot index={5} />
                  </InputOTP.Group>
                </InputOTP>
                <Description className="self-start">{t('twofa_code_description')}</Description>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={twoFactorDisableModalOnClose}>
              {t('twofa_cancel')}
            </Button>
            <Button
              variant="danger"
              onPress={onDisable2FA}
              isLoading={isDisabling2FA}
              isDisabled={!twoFactorDisablePassword || twoFactorDisableCode.length < 6}
            >
              {t('twofa_disable_confirm')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* GDPR Request Modal is kept in SettingsPage (triggered from PrivacyTab) */}
    </>
  );
}
