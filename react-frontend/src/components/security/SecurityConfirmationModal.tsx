// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Step-up security confirmation modal.
 *
 * Presentational only: the caller owns the state (chosen method, typed value,
 * error, busy flags) and decides what the resulting
 * `POST /webauthn/security-confirm` token is used for. Shared by passkey
 * management (BiometricSettings) and provider linking (ConnectedAccountsTab).
 */

import { useTranslation } from 'react-i18next';
import { Button, Input, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui';
import type { WebAuthnSecurityConfirmationInput } from '@/lib/webauthn';

export type SecurityConfirmationMethod = 'password' | 'totp' | 'backup';

export interface SecurityConfirmationMethods {
  password: boolean;
  totp: boolean;
  passkey?: boolean;
}

/** The first method to offer for a given set of available methods. */
export function defaultSecurityConfirmationMethod(
  methods: SecurityConfirmationMethods,
): SecurityConfirmationMethod {
  return methods.password ? 'password' : methods.totp ? 'totp' : 'backup';
}

/** Build the `/webauthn/security-confirm` body for the chosen method. */
export function buildSecurityConfirmationInput(
  method: SecurityConfirmationMethod,
  rawValue: string,
): WebAuthnSecurityConfirmationInput {
  const value = rawValue.trim();
  if (method === 'password') return { current_password: rawValue };
  if (method === 'totp') return { totp_code: value.replace(/\s+/g, '') };
  return { backup_code: value };
}

export interface SecurityConfirmationModalProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  methods: SecurityConfirmationMethods;
  method: SecurityConfirmationMethod;
  onMethodChange: (method: SecurityConfirmationMethod) => void;
  value: string;
  onValueChange: (value: string) => void;
  error: string | null;
  isConfirming: boolean;
  isSubmitDisabled: boolean;
  onSubmit: () => void;
  /** Called when the user presses Cancel, before the modal closes. */
  onCancel: () => void;
  /** Overrides the default (passkey-specific) explanation. */
  description?: string;
}

export function SecurityConfirmationModal({
  isOpen,
  onOpenChange,
  methods,
  method,
  onMethodChange,
  value,
  onValueChange,
  error,
  isConfirming,
  isSubmitDisabled,
  onSubmit,
  onCancel,
  description,
}: SecurityConfirmationModalProps) {
  const { t } = useTranslation('settings');
  const hasMethod = methods.password || methods.totp;

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              {t('passkey_security_confirm_title')}
            </ModalHeader>
            <ModalBody className="space-y-4">
              <p className="text-sm text-theme-subtle">
                {description ?? t('passkey_security_confirm_description')}
              </p>

              {!hasMethod ? (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-theme-subtle" role="alert">
                  {t('passkey_security_confirm_no_method')}
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2" role="group" aria-label={t('passkey_security_confirm_method_label')}>
                    {methods.password && (
                      <Button
                        size="sm"
                        variant={method === 'password' ? 'primary' : 'secondary'}
                        aria-pressed={method === 'password'}
                        onPress={() => onMethodChange('password')}
                      >
                        {t('passkey_security_confirm_password')}
                      </Button>
                    )}
                    {methods.totp && (
                      <>
                        <Button
                          size="sm"
                          variant={method === 'totp' ? 'primary' : 'secondary'}
                          aria-pressed={method === 'totp'}
                          onPress={() => onMethodChange('totp')}
                        >
                          {t('passkey_security_confirm_totp')}
                        </Button>
                        <Button
                          size="sm"
                          variant={method === 'backup' ? 'primary' : 'secondary'}
                          aria-pressed={method === 'backup'}
                          onPress={() => onMethodChange('backup')}
                        >
                          {t('passkey_security_confirm_backup')}
                        </Button>
                      </>
                    )}
                  </div>

                  <Input
                    autoFocus
                    type={method === 'password' ? 'password' : 'text'}
                    inputMode={method === 'totp' ? 'numeric' : 'text'}
                    autoComplete={method === 'password' ? 'current-password' : 'one-time-code'}
                    label={method === 'password'
                      ? t('passkey_security_confirm_password')
                      : method === 'totp'
                        ? t('passkey_security_confirm_totp')
                        : t('passkey_security_confirm_backup')}
                    value={value}
                    onValueChange={onValueChange}
                    isInvalid={error !== null}
                    errorMessage={error ?? undefined}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        onSubmit();
                      }
                    }}
                  />
                </>
              )}
            </ModalBody>
            <ModalFooter>
              <Button
                variant="light"
                onPress={() => {
                  onCancel();
                  onClose();
                }}
                isDisabled={isConfirming}
              >
                {t('cancel')}
              </Button>
              {hasMethod && (
                <Button
                  color="primary"
                  onPress={onSubmit}
                  isLoading={isConfirming}
                  isDisabled={isSubmitDisabled}
                >
                  {t('passkey_security_confirm_action')}
                </Button>
              )}
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

export default SecurityConfirmationModal;
