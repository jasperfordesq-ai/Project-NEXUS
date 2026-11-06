// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Turning on two-factor authentication: the screens.
 *
 * One component, two presentations, the same flow and the same server calls
 * (state lives in `useTwoFactorEnrolment`):
 *
 *  - `variant="modal"`  Settings → Security. Confirmation, set-up and backup
 *                       codes each appear in a dialog, as they always have.
 *  - `variant="inline"` The onboarding "Protect your account" step. The same
 *                       screens render in the page, one after another.
 *
 * Disabling two-factor, regenerating recovery codes and passkeys are NOT here;
 * they stay in Settings.
 */

import { useTranslation } from 'react-i18next';
import QrCode from 'lucide-react/icons/qr-code';
import Copy from 'lucide-react/icons/copy';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { InputOTP } from '@/components/ui/InputOTP';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Description } from '@/components/ui/Description';
import { Label } from '@/components/ui/Label';
import { SecurityConfirmationModal } from '@/components/security/SecurityConfirmationModal';
import { SetPasswordPrompt } from '@/components/security/SetPasswordPrompt';
import type { TwoFactorEnrolmentController } from './useTwoFactorEnrolment';

export interface TwoFactorEnrolmentProps {
  enrolment: TwoFactorEnrolmentController;
  variant: 'modal' | 'inline';
  /** Inline only: label of the button under the backup codes. */
  doneLabel?: string;
  /** Inline only: called after the member presses the button under the backup codes. */
  onDone?: () => void;
  /** Inline only: extra guidance shown with a failed confirmation. */
  confirmFailedHint?: string;
}

const modalClassNames = {
  base: 'bg-overlay border border-theme-default',
  header: 'border-b border-theme-default',
  body: 'py-6',
  footer: 'border-t border-theme-default',
};

const AUTHENTICATOR_APPS = [
  { key: 'twofa_app_google', href: 'https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2' },
  { key: 'twofa_app_microsoft', href: 'https://www.microsoft.com/en-us/security/mobile-authenticator-app' },
  { key: 'twofa_app_authy', href: 'https://authy.com/download/' },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Shared pieces
// ─────────────────────────────────────────────────────────────────────────────

function SetupBody({ enrolment }: { enrolment: TwoFactorEnrolmentController }) {
  const { t } = useTranslation('settings');
  const { setupData, verifyCode, setVerifyCode } = enrolment;

  if (!setupData) {
    return (
      <div className="flex items-center justify-center py-12">
        <div role="status" aria-busy="true" aria-label={t('twofa_loading_setup')}>
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* What is an authenticator app? */}
      <div className="p-4 rounded-lg bg-accent/10 border border-accent/20">
        <p className="text-sm font-medium text-theme-primary mb-2">{t('twofa_what_is')}</p>
        <p className="text-xs text-theme-muted mb-3">{t('twofa_what_is_desc')}</p>
        <p className="text-xs text-theme-muted mb-2">{t('twofa_download_prompt')}</p>
        <div className="flex flex-wrap gap-2">
          {AUTHENTICATOR_APPS.map((app) => (
            <Button
              key={app.key}
              as="a"
              href={app.href}
              target="_blank"
              rel="noopener noreferrer"
              size="sm"
              variant="secondary"
              className="min-h-9"
            >
              {t(app.key)}
            </Button>
          ))}
        </div>
      </div>

      <div className="text-center">
        <p className="text-theme-muted mb-4">{t('twofa_scan_qr')}</p>
        <div className="inline-block p-4 bg-white rounded-xl">
          <img
            src={setupData.qr_code_url}
            alt={t('twofa_qr_alt')}
            className="w-48 h-48"
            loading="lazy"
          />
        </div>
      </div>

      <div className="p-3 rounded-lg bg-theme-elevated">
        <p className="text-xs text-theme-subtle mb-1">{t('twofa_manual_key')}</p>
        <p className="font-mono text-sm text-theme-primary break-all select-all">{setupData.secret}</p>
      </div>

      <div className="flex flex-col gap-2 items-center">
        <Label className="self-start text-sm">{t('twofa_verification_code')}</Label>
        <InputOTP
          maxLength={6}
          name="twofa-enrol-code"
          value={verifyCode}
          onChange={(val) => setVerifyCode(val.replace(/\D/g, '').slice(0, 6))}
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
        <Description className="self-start text-xs">{t('twofa_code_description')}</Description>
      </div>
    </div>
  );
}

function BackupCodesBody({ enrolment }: { enrolment: TwoFactorEnrolmentController }) {
  const { t } = useTranslation('settings');

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
        <p className="text-theme-warning font-medium">{t('backup_codes_warning')}</p>
        <p className="text-theme-muted text-sm mt-1">{t('backup_codes_desc')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-4 rounded-lg bg-theme-elevated">
        {enrolment.backupCodes.map((code) => (
          <p key={code} className="font-mono text-sm text-theme-primary text-center py-1">
            {code}
          </p>
        ))}
      </div>

      <Button
        variant="secondary"
        className="w-full"
        startContent={<Copy className="w-4 h-4" aria-hidden="true" />}
        onPress={() => { void enrolment.copyBackupCodes(); }}
      >
        {t('backup_codes_copy')}
      </Button>
    </div>
  );
}

function VerifyButton({ enrolment }: { enrolment: TwoFactorEnrolmentController }) {
  const { t } = useTranslation('settings');
  return (
    <Button
      variant="primary"
      onPress={() => { void enrolment.verify(); }}
      isLoading={enrolment.isVerifying}
      isDisabled={!enrolment.setupData || enrolment.verifyCode.length < 6}
    >
      {t('twofa_verify_enable')}
    </Button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function TwoFactorEnrolment({
  enrolment,
  variant,
  doneLabel,
  onDone,
  confirmFailedHint,
}: TwoFactorEnrolmentProps) {
  const { t } = useTranslation('settings');
  const { phase } = enrolment;

  if (variant === 'modal') {
    return (
      <>
        {/* E-035 F-170: fresh confirmation before enrolling an authenticator. */}
        <SecurityConfirmationModal
          isOpen={phase === 'confirming'}
          onOpenChange={(open) => { if (!open) enrolment.cancel('confirming'); }}
          /* F-611: no password → "Set a password" instead of a password box. */
          methods={{ password: enrolment.hasPassword, totp: false }}
          noMethodMessage={t('twofa_needs_password')}
          method={enrolment.confirmMethod}
          onMethodChange={enrolment.setConfirmMethod}
          value={enrolment.confirmValue}
          onValueChange={enrolment.setConfirmValue}
          error={enrolment.confirmError}
          isConfirming={enrolment.isConfirming}
          isSubmitDisabled={!enrolment.confirmValue.trim() || enrolment.isConfirming}
          onSubmit={() => { void enrolment.submitConfirmation(); }}
          onCancel={() => enrolment.cancel('confirming')}
          description={t('twofa_confirm_password')}
        />

        {/* 2FA Setup Modal */}
        <Modal isOpen={phase === 'setup'} onClose={() => enrolment.cancel('setup')} size="lg" classNames={modalClassNames}>
          <ModalContent>
            <ModalHeader className="text-theme-primary flex items-center gap-2">
              <QrCode className="w-5 h-5 text-emerald-500" aria-hidden="true" />
              {t('twofa_setup_title')}
            </ModalHeader>
            <ModalBody>
              <SetupBody enrolment={enrolment} />
            </ModalBody>
            <ModalFooter>
              <Button variant="tertiary" onPress={() => enrolment.cancel('setup')}>
                {t('twofa_cancel')}
              </Button>
              <VerifyButton enrolment={enrolment} />
            </ModalFooter>
          </ModalContent>
        </Modal>

        {/* Backup Codes Modal */}
        <Modal isOpen={phase === 'codes'} onClose={enrolment.finish} size="lg" classNames={modalClassNames}>
          <ModalContent>
            <ModalHeader className="text-theme-primary flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-500" aria-hidden="true" />
              {t('backup_codes_title')}
            </ModalHeader>
            <ModalBody>
              <BackupCodesBody enrolment={enrolment} />
            </ModalBody>
            <ModalFooter>
              <Button variant="primary" onPress={enrolment.finish}>
                {t('backup_codes_saved')}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </>
    );
  }

  // ── Inline ────────────────────────────────────────────────────────────────

  if (phase === 'confirming' && !enrolment.hasPassword) {
    // F-611: a member who joined with Google has no password to type here.
    return (
      <div className="space-y-4" data-testid="twofa-enrol-confirm">
        <h3 className="font-semibold text-theme-primary">{t('passkey_security_confirm_title')}</h3>
        <SetPasswordPrompt reason={t('twofa_needs_password')} />
        <div className="flex justify-end">
          <Button variant="tertiary" onPress={() => enrolment.cancel('confirming')}>
            {t('cancel')}
          </Button>
        </div>
      </div>
    );
  }

  if (phase === 'confirming') {
    return (
      <div className="space-y-4" data-testid="twofa-enrol-confirm">
        <h3 className="font-semibold text-theme-primary">{t('passkey_security_confirm_title')}</h3>
        <p className="text-sm text-theme-subtle">{t('twofa_confirm_password')}</p>
        <Input
          autoFocus
          type="password"
          autoComplete="current-password"
          label={t('passkey_security_confirm_password')}
          value={enrolment.confirmValue}
          onValueChange={enrolment.setConfirmValue}
          isInvalid={enrolment.confirmError !== null}
          errorMessage={enrolment.confirmError ?? undefined}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void enrolment.submitConfirmation();
            }
          }}
        />
        {enrolment.confirmError && confirmFailedHint && (
          <p role="alert" className="text-sm text-theme-muted">{confirmFailedHint}</p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="tertiary" onPress={() => enrolment.cancel('confirming')} isDisabled={enrolment.isConfirming}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            onPress={() => { void enrolment.submitConfirmation(); }}
            isLoading={enrolment.isConfirming}
            isDisabled={!enrolment.confirmValue.trim() || enrolment.isConfirming}
          >
            {t('passkey_security_confirm_action')}
          </Button>
        </div>
      </div>
    );
  }

  if (phase === 'setup') {
    return (
      <div className="space-y-4" data-testid="twofa-enrol-setup">
        <h3 className="font-semibold text-theme-primary flex items-center gap-2">
          <QrCode className="w-5 h-5 text-emerald-500" aria-hidden="true" />
          {t('twofa_setup_title')}
        </h3>
        <SetupBody enrolment={enrolment} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="tertiary" onPress={() => enrolment.cancel('setup')}>
            {t('twofa_cancel')}
          </Button>
          <VerifyButton enrolment={enrolment} />
        </div>
      </div>
    );
  }

  if (phase === 'codes') {
    return (
      <div className="space-y-4" data-testid="twofa-enrol-codes">
        <h3 className="font-semibold text-theme-primary flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-emerald-500" aria-hidden="true" />
          {t('backup_codes_title')}
        </h3>
        <BackupCodesBody enrolment={enrolment} />
        <div className="flex justify-end">
          <Button
            variant="primary"
            onPress={() => {
              enrolment.finish();
              onDone?.();
            }}
          >
            {doneLabel ?? t('backup_codes_saved')}
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

export default TwoFactorEnrolment;
