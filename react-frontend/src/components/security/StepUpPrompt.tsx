// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Asks for a fresh second factor when the server refuses a high-risk staff
 * action with AUTH_STEP_UP_REQUIRED (security register E-085).
 *
 * Mounted once at the root of the app. It registers itself with the API
 * client, which calls it, waits for the person to enter a code (or cancel),
 * then replays the refused request with the resulting security-confirmation
 * token. Only second factors are offered: a password alone is not accepted by
 * the server for this check.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setStepUpHandler } from '@/lib/api';
import { confirmWebAuthnSecurity, getWebAuthnStatus } from '@/lib/webauthn';
import {
  SecurityConfirmationModal,
  buildSecurityConfirmationInput,
  type SecurityConfirmationMethod,
  type SecurityConfirmationMethods,
} from './SecurityConfirmationModal';

type StepUpResult = { token: string; expiresIn: number } | null;

const SECOND_FACTOR_ONLY: SecurityConfirmationMethods = { password: false, totp: true };

export function StepUpPrompt() {
  const { t } = useTranslation('settings');
  const [isOpen, setIsOpen] = useState(false);
  const [methods, setMethods] = useState<SecurityConfirmationMethods>(SECOND_FACTOR_ONLY);
  const [method, setMethod] = useState<SecurityConfirmationMethod>('totp');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const resolverRef = useRef<((result: StepUpResult) => void) | null>(null);

  const settle = useCallback((result: StepUpResult) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setIsOpen(false);
    setValue('');
    setError(null);
    setIsConfirming(false);
    resolve?.(result);
  }, []);

  useEffect(() => {
    setStepUpHandler(() => new Promise<StepUpResult>((resolve) => {
      resolverRef.current = resolve;
      setMethods(SECOND_FACTOR_ONLY);
      setMethod('totp');
      setValue('');
      setError(null);
      setIsOpen(true);
      // An account signed in through an identity provider may hold no
      // authenticator; the modal then explains how to confirm instead.
      getWebAuthnStatus()
        .then((status) => {
          const totp = status.confirmation_methods?.totp;
          if (typeof totp === 'boolean') {
            setMethods({ password: false, totp });
          }
        })
        .catch(() => {
          // Keep offering the authenticator; the server decides.
        });
    }));

    return () => {
      setStepUpHandler(null);
      const resolve = resolverRef.current;
      resolverRef.current = null;
      resolve?.(null);
    };
  }, []);

  const handleSubmit = useCallback(async () => {
    if (value.trim() === '' || isConfirming) {
      return;
    }
    setIsConfirming(true);
    setError(null);
    const result = await confirmWebAuthnSecurity(buildSecurityConfirmationInput(method, value));
    if (result.success && result.securityConfirmationToken) {
      settle({ token: result.securityConfirmationToken, expiresIn: result.expiresIn ?? 300 });
      return;
    }
    setIsConfirming(false);
    setError(t('passkey_security_confirm_failed'));
  }, [isConfirming, method, settle, t, value]);

  return (
    <SecurityConfirmationModal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          settle(null);
        }
      }}
      methods={methods}
      method={method}
      onMethodChange={(next) => {
        setMethod(next);
        setValue('');
        setError(null);
      }}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        setError(null);
      }}
      error={error}
      isConfirming={isConfirming}
      isSubmitDisabled={value.trim() === ''}
      onSubmit={() => {
        void handleSubmit();
      }}
      onCancel={() => settle(null)}
      description={t('step_up_description')}
      noMethodMessage={t('step_up_no_method')}
    />
  );
}

export default StepUpPrompt;
