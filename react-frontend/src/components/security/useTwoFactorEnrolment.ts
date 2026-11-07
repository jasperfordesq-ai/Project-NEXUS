// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * State and handlers for turning on two-factor authentication (an
 * authenticator app) from a signed-in session.
 *
 * Shared by Settings → Security and the onboarding "Protect your account"
 * step, so the two can never drift apart. The flow is:
 *
 *   confirm it is you  →  scan QR / copy key  →  enter 6-digit code  →  backup codes
 *
 * E-035 F-170: enrolling an authenticator on a signed-in session needs a fresh
 * "confirm it is you" step (`POST /webauthn/security-confirm`). The resulting
 * token is held only in memory for this enrolment and is sent to both
 * `/v2/auth/2fa/setup` and `/v2/auth/2fa/verify`. Never skip or weaken this.
 * The token lasts five minutes; if it runs out while the member is in their
 * authenticator app, they are asked for their password again.
 */

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { confirmWebAuthnSecurity, getWebAuthnStatus } from '@/lib/webauthn';
import { logError } from '@/lib/logger';
import { buildSecurityConfirmationInput } from '@/components/security/SecurityConfirmationModal';
import type { SecurityConfirmationMethod } from '@/components/security/SecurityConfirmationModal';

export interface TwoFactorSetup {
  qr_code_url: string;
  secret: string;
  /** The otpauth:// link the QR code encodes (opens the authenticator app on a phone). */
  provisioning_uri?: string;
  backup_codes?: string[];
}

/**
 * - `idle`       nothing in progress
 * - `confirming` asking the member to confirm it is them
 * - `setup`      showing the QR code / key and asking for a code
 * - `codes`      enrolment succeeded; showing the backup codes once
 */
export type TwoFactorEnrolmentPhase = 'idle' | 'confirming' | 'setup' | 'codes';

export interface UseTwoFactorEnrolmentOptions {
  /** Called once the server has accepted the code and two-factor is on. */
  onEnrolled?: (backupCodes: string[]) => void;
}

export interface TwoFactorEnrolmentController {
  phase: TwoFactorEnrolmentPhase;
  /** True while `start()` is getting ready (before the first screen appears). */
  isStarting: boolean;
  /**
   * Whether the member can confirm with a password. False for a member who
   * joined with Google and never set one (F-611): the confirmation step then
   * offers "Set a password" instead of a password box.
   */
  hasPassword: boolean;
  // Confirmation step
  confirmMethod: SecurityConfirmationMethod;
  setConfirmMethod: (method: SecurityConfirmationMethod) => void;
  confirmValue: string;
  setConfirmValue: (value: string) => void;
  confirmError: string | null;
  /** A neutral note for the confirmation step, e.g. "that took too long". Not an error. */
  confirmNotice: string | null;
  isConfirming: boolean;
  // Set-up step
  setupData: TwoFactorSetup | null;
  verifyCode: string;
  setVerifyCode: (value: string) => void;
  /** Why the last code was refused, shown beside the code boxes. */
  verifyError: string | null;
  isVerifying: boolean;
  // Result
  backupCodes: string[];
  // Actions
  start: () => Promise<void>;
  submitConfirmation: () => Promise<void>;
  verify: () => Promise<void>;
  copyKey: () => Promise<void>;
  copyBackupCodes: () => Promise<void>;
  /**
   * Abandon the flow (confirmation or set-up) and forget the token. With
   * `onlyFrom`, does nothing unless the flow is still in that phase, so a
   * dialog closing late cannot undo a step that has already moved on.
   */
  cancel: (onlyFrom?: TwoFactorEnrolmentPhase) => void;
  /** Close the backup-codes view once the member has saved them. */
  finish: () => void;
}

/**
 * Ask the server whether this member has a password to confirm with. If the
 * answer cannot be read, assume they do: that is the behaviour before F-611,
 * and the server still refuses a wrong or missing password either way.
 */
async function memberHasPassword(): Promise<boolean> {
  try {
    const status = await getWebAuthnStatus();
    return status?.confirmation_methods?.password !== false;
  } catch {
    return true;
  }
}

export function useTwoFactorEnrolment(options: UseTwoFactorEnrolmentOptions = {}): TwoFactorEnrolmentController {
  const { onEnrolled } = options;
  const { t } = useTranslation('settings');
  const toast = useToast();

  const [phase, setPhaseState] = useState<TwoFactorEnrolmentPhase>('idle');
  const phaseRef = useRef<TwoFactorEnrolmentPhase>('idle');
  const setPhase = useCallback((next: TwoFactorEnrolmentPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);
  const confirmTokenRef = useRef<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [hasPassword, setHasPassword] = useState(true);
  const [confirmMethod, setConfirmMethod] = useState<SecurityConfirmationMethod>('password');
  const [confirmValue, setConfirmValue] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmNotice, setConfirmNotice] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [setupData, setSetupData] = useState<TwoFactorSetup | null>(null);
  const [verifyCode, setVerifyCodeState] = useState('');
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  const setVerifyCode = useCallback((value: string) => {
    setVerifyCodeState(value);
    // Typing a new code clears the complaint about the last one.
    setVerifyError(null);
  }, []);

  const startSetup = useCallback(async () => {
    try {
      setSetupData(null);
      setVerifyCodeState('');
      setVerifyError(null);
      setPhase('setup');

      const response = await api.post<TwoFactorSetup>('/v2/auth/2fa/setup', {
        security_confirmation_token: confirmTokenRef.current ?? undefined,
      });
      if (response.success && response.data) {
        setSetupData(response.data);
      } else {
        toast.error(t('toasts.twofa_setup_failed'), response.error || t('toasts.twofa_setup_failed_desc'));
        setPhase('idle');
      }
    } catch (error) {
      logError('Failed to setup 2FA', error);
      toast.error(t('toasts.twofa_setup_failed'), t('toasts.twofa_setup_failed_desc'));
      setPhase('idle');
    }
  }, [setPhase, t, toast]);

  const start = useCallback(async () => {
    confirmTokenRef.current = null;
    setConfirmError(null);
    setConfirmNotice(null);
    setConfirmValue('');
    setConfirmMethod('password');
    setIsStarting(true);
    try {
      // A recent passkey sign-in can confirm silently; otherwise ask.
      try {
        const silent = await confirmWebAuthnSecurity({});
        if (silent.success && silent.securityConfirmationToken) {
          confirmTokenRef.current = silent.securityConfirmationToken;
          await startSetup();
          return;
        }
      } catch {
        // Fall through to the explicit confirmation prompt.
      }
      // F-611 (E-121): a member who joined with Google has no password to type.
      setHasPassword(await memberHasPassword());
      setPhase('confirming');
    } finally {
      setIsStarting(false);
    }
  }, [setPhase, startSetup]);

  const submitConfirmation = useCallback(async () => {
    if (!confirmValue.trim() || isConfirming) return;
    setIsConfirming(true);
    setConfirmError(null);
    try {
      const result = await confirmWebAuthnSecurity(
        buildSecurityConfirmationInput(confirmMethod, confirmValue),
      );
      if (!result.success || !result.securityConfirmationToken) {
        setConfirmError(t('passkey_security_confirm_failed'));
        return;
      }
      confirmTokenRef.current = result.securityConfirmationToken;
      setConfirmValue('');
      setConfirmNotice(null);
      await startSetup();
    } catch {
      setConfirmError(t('passkey_security_confirm_failed'));
    } finally {
      setIsConfirming(false);
    }
  }, [confirmMethod, confirmValue, isConfirming, startSetup, t]);

  const verify = useCallback(async () => {
    if (isVerifying) return;
    if (!verifyCode || verifyCode.length < 6) {
      setVerifyError(t('toasts.invalid_code_desc'));
      return;
    }

    try {
      setIsVerifying(true);
      const response = await api.post<{ backup_codes: string[] }>('/v2/auth/2fa/verify', {
        code: verifyCode,
        security_confirmation_token: confirmTokenRef.current ?? undefined,
      });

      if (response.success) {
        confirmTokenRef.current = null;
        const codes = response.data?.backup_codes ?? [];
        setBackupCodes(codes);
        setSetupData(null);
        setVerifyCodeState('');
        setVerifyError(null);
        toast.success(t('toasts.twofa_enabled'), t('toasts.twofa_enabled_desc'));
        setPhase(codes.length > 0 ? 'codes' : 'idle');
        onEnrolled?.(codes);
      } else if (response.code === 'SECURITY_CONFIRMATION_REQUIRED') {
        // The five-minute confirmation ran out while the member was in their
        // authenticator app. Every code would now be refused, so ask again.
        confirmTokenRef.current = null;
        setSetupData(null);
        setVerifyCodeState('');
        setVerifyError(null);
        setConfirmValue('');
        setConfirmError(null);
        setConfirmNotice(t('twofa_confirm_expired'));
        setPhase('confirming');
      } else {
        setVerifyCodeState('');
        setVerifyError(response.error || t('toasts.verification_failed_desc'));
      }
    } catch (error) {
      logError('Failed to verify 2FA', error);
      setVerifyError(t('toasts.verification_failed_desc'));
    } finally {
      setIsVerifying(false);
    }
  }, [isVerifying, onEnrolled, setPhase, t, toast, verifyCode]);

  const copyKey = useCallback(async () => {
    if (!setupData?.secret) return;
    try {
      await navigator.clipboard.writeText(setupData.secret);
      toast.success(t('toasts.copied'), t('toasts.key_copied_desc'));
    } catch {
      toast.error(t('toasts.copy_failed'), t('toasts.copy_failed_desc'));
    }
  }, [setupData, t, toast]);

  const copyBackupCodes = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      toast.success(t('toasts.copied'), t('toasts.backup_codes_copied_desc'));
    } catch {
      toast.error(t('toasts.copy_failed'), t('toasts.copy_failed_desc'));
    }
  }, [backupCodes, t, toast]);

  const cancel = useCallback((onlyFrom?: TwoFactorEnrolmentPhase) => {
    if (onlyFrom !== undefined && phaseRef.current !== onlyFrom) return;
    if (phaseRef.current === 'codes') return;
    confirmTokenRef.current = null;
    setConfirmValue('');
    setConfirmError(null);
    setConfirmNotice(null);
    setSetupData(null);
    setVerifyCodeState('');
    setVerifyError(null);
    setPhase('idle');
  }, [setPhase]);

  const finish = useCallback(() => {
    if (phaseRef.current === 'codes') setPhase('idle');
  }, [setPhase]);

  return {
    phase,
    isStarting,
    hasPassword,
    confirmMethod,
    setConfirmMethod,
    confirmValue,
    setConfirmValue,
    confirmError,
    confirmNotice,
    isConfirming,
    setupData,
    verifyCode,
    setVerifyCode,
    verifyError,
    isVerifying,
    backupCodes,
    start,
    submitConfirmation,
    verify,
    copyKey,
    copyBackupCodes,
    cancel,
    finish,
  };
}
