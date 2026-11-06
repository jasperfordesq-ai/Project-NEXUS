// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Turn on two-factor authentication from a signed-in session (November 2026).
 *
 * Used by Settings → Two-factor authentication and by the "Protect your account" step of
 * the welcome wizard. The forced set-up during sign-in is a different flow and stays in
 * `components/auth/MfaSignIn.tsx`.
 *
 * The steps:
 *   1. re-enter the password — the server demands a fresh confirmation (F-170);
 *   2. add the key to an authenticator app: "Open in authenticator app" (an `otpauth://`
 *      link), the key as large copyable text, and a QR code for an app on ANOTHER device —
 *      a phone cannot scan its own screen;
 *   3. type the 6-digit code the app shows;
 *   4. save the backup codes, shown once, with Copy and Share.
 *
 * 🔴 The confirmation token, the key and the backup codes live in this component's memory
 * only. Nothing is written to storage, and leaving the screen discards them.
 */

import { useEffect, useRef, useState } from 'react';
import { Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { useTranslation } from 'react-i18next';

import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { ApiResponseError } from '@/lib/api/client';
import { describeApiError } from '@/lib/api/describeApiError';
import {
  beginTwoFactorSetupFromSession,
  buildOtpAuthUri,
  confirmSecurityWithPassword,
  formatSetupKey,
  verifyTwoFactorSetupFromSession,
} from '@/lib/api/twoFactor';
import { openExternalUrl } from '@/lib/utils/openExternalUrl';

type Stage = 'password' | 'setup' | 'codes';

export interface TwoFactorEnrolmentProps {
  /** Shown in the authenticator app beside the issuer; the server uses the email. */
  accountLabel?: string | null;
  /** Called when the member has seen their backup codes and pressed Continue. */
  onDone: () => void;
  /** Optional "Cancel" before the codes are shown. */
  onCancel?: () => void;
}

export default function TwoFactorEnrolment({ accountLabel, onDone, onCancel }: TwoFactorEnrolmentProps) {
  const { t } = useTranslation('settings');
  const [stage, setStage] = useState<Stage>('password');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  /** Our own translated words for the refusals we can name; the server's otherwise. */
  function explain(reason: unknown, fallbackKey: string): string {
    if (reason instanceof ApiResponseError) {
      switch (reason.code) {
        case 'VERIFICATION_FAILED': return t('twoFactor.errors.codeWrong');
        case 'ALREADY_ENABLED': return t('twoFactor.errors.alreadyOn');
        case 'FEATURE_DISABLED': return t('twoFactor.errors.notAllowed');
        default: break;
      }
      if (reason.status === 429) return t('twoFactor.errors.tooMany');
    }
    return describeApiError(reason, t(fallbackKey));
  }

  function restartConfirmation(message: string) {
    setConfirmation(null);
    setSecret('');
    setCode('');
    setPassword('');
    setStage('password');
    setError(message);
  }

  async function confirmPassword() {
    if (inFlight.current || password === '') return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const token = await confirmSecurityWithPassword(password);
      if (!mounted.current) return;
      const setup = await beginTwoFactorSetupFromSession(token);
      if (!mounted.current) return;
      setPassword('');
      setConfirmation(token);
      setSecret(setup.secret);
      setStage('setup');
    } catch (reason) {
      if (!mounted.current) return;
      if (reason instanceof ApiResponseError && reason.code === 'SECURITY_CONFIRMATION_REQUIRED') {
        setError(t('twoFactor.errors.passwordWrong'));
      } else {
        setError(explain(reason, 'twoFactor.errors.generic'));
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function verify() {
    if (inFlight.current || !confirmation || !/^\d{6}$/.test(code)) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await verifyTwoFactorSetupFromSession(code, confirmation);
      if (!mounted.current) return;
      setConfirmation(null);
      setSecret('');
      setCode('');
      setBackupCodes(result.backup_codes);
      setStage('codes');
    } catch (reason) {
      if (!mounted.current) return;
      if (reason instanceof ApiResponseError && reason.code === 'SECURITY_CONFIRMATION_REQUIRED') {
        // The five-minute confirmation ran out while the member was in their authenticator.
        restartConfirmation(t('twoFactor.errors.confirmExpired'));
      } else {
        setCode('');
        setError(explain(reason, 'twoFactor.errors.generic'));
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function openInAuthenticator() {
    setNotice('');
    const outcome = await openExternalUrl(buildOtpAuthUri(secret, accountLabel), { allowSchemes: ['otpauth:'] });
    if (!mounted.current) return;
    if (outcome !== 'opened') setNotice(t('twoFactor.setup.noAuthenticatorApp'));
  }

  async function copy(value: string, doneMessage: string) {
    try {
      await Clipboard.setStringAsync(value);
      if (mounted.current) setNotice(doneMessage);
    } catch {
      if (mounted.current) setNotice(t('twoFactor.copyFailed'));
    }
  }

  async function shareCodes() {
    try {
      await Share.share({ message: `${t('twoFactor.codes.shareTitle')}\n\n${backupCodes.join('\n')}` });
    } catch {
      // The member closed the share sheet or nothing could take it; the codes are still on screen.
    }
  }

  return (
    <View className="gap-4" testID="two-factor-enrolment">
      {error ? (
        <Text testID="two-factor-error" accessibilityRole="alert" accessibilityLiveRegion="polite" className="text-sm text-danger">
          {error}
        </Text>
      ) : null}

      {stage === 'password' ? (
        <>
          <Text accessibilityRole="header" className="text-lg font-bold text-foreground">{t('twoFactor.password.title')}</Text>
          <Text className="text-sm leading-5 text-muted-foreground">{t('twoFactor.password.body')}</Text>
          <Input
            testID="two-factor-password"
            label={t('twoFactor.password.label')}
            accessibilityLabel={t('twoFactor.password.label')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            editable={!busy}
            onSubmitEditing={() => void confirmPassword()}
            containerClassName="mb-0"
          />
          <Button testID="two-factor-password-continue" fullWidth isLoading={busy} disabled={password === ''} onPress={() => void confirmPassword()}>
            {t('twoFactor.password.continue')}
          </Button>
          {onCancel ? <Button variant="ghost" disabled={busy} onPress={onCancel}>{t('twoFactor.cancel')}</Button> : null}
        </>
      ) : null}

      {stage === 'setup' ? (
        <>
          <Text accessibilityRole="header" className="text-lg font-bold text-foreground">{t('twoFactor.setup.title')}</Text>
          <Text className="text-sm leading-5 text-muted-foreground">{t('twoFactor.setup.body')}</Text>
          <Button testID="two-factor-open-authenticator" fullWidth variant="outline" onPress={() => void openInAuthenticator()}>
            {t('twoFactor.setup.openApp')}
          </Button>
          <View className="gap-2 rounded-panel-inner border border-default-200 p-3">
            <Text className="text-sm font-semibold text-foreground">{t('twoFactor.setup.keyLabel')}</Text>
            <Text testID="two-factor-secret" selectable className="text-xl font-bold tracking-wider text-foreground" style={{ fontFamily: 'monospace' }}>
              {formatSetupKey(secret)}
            </Text>
            <Button variant="ghost" size="sm" onPress={() => void copy(secret, t('twoFactor.setup.keyCopied'))}>
              {t('twoFactor.setup.copyKey')}
            </Button>
          </View>
          <View className="items-center gap-2">
            <Text className="text-center text-xs leading-5 text-muted-foreground">{t('twoFactor.setup.qrHint')}</Text>
            <View className="rounded-panel-inner bg-white p-3" accessible accessibilityLabel={t('twoFactor.setup.qrLabel')}>
              <QRCode value={buildOtpAuthUri(secret, accountLabel)} size={160} />
            </View>
          </View>
          {notice ? <Text testID="two-factor-notice" accessibilityLiveRegion="polite" className="text-sm text-muted-foreground">{notice}</Text> : null}
          <Input
            testID="two-factor-code"
            label={t('twoFactor.setup.codeLabel')}
            accessibilityLabel={t('twoFactor.setup.codeLabel')}
            value={code}
            onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
            editable={!busy}
            onSubmitEditing={() => void verify()}
            containerClassName="mb-0"
          />
          <Button testID="two-factor-verify" fullWidth isLoading={busy} disabled={!/^\d{6}$/.test(code)} onPress={() => void verify()}>
            {t('twoFactor.setup.verify')}
          </Button>
          {onCancel ? <Button variant="ghost" disabled={busy} onPress={onCancel}>{t('twoFactor.cancel')}</Button> : null}
        </>
      ) : null}

      {stage === 'codes' ? (
        <>
          <Text accessibilityRole="header" className="text-lg font-bold text-foreground">{t('twoFactor.codes.title')}</Text>
          <View accessibilityRole="alert" className="rounded-panel-inner border border-warning bg-warning/10 p-3">
            <Text className="text-sm font-semibold leading-5 text-foreground">{t('twoFactor.codes.warning')}</Text>
          </View>
          {backupCodes.length > 0 ? (
            <View className="gap-1 rounded-panel-inner border border-default-200 p-3">
              {backupCodes.map((backupCode) => (
                <Text key={backupCode} testID="two-factor-backup-code" selectable className="text-lg text-foreground" style={{ fontFamily: 'monospace' }}>
                  {backupCode}
                </Text>
              ))}
            </View>
          ) : (
            <Text className="text-sm text-muted-foreground">{t('twoFactor.codes.none')}</Text>
          )}
          {backupCodes.length > 0 ? (
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Button testID="two-factor-copy-codes" fullWidth variant="outline" onPress={() => void copy(backupCodes.join('\n'), t('twoFactor.codes.copied'))}>
                  {t('twoFactor.codes.copy')}
                </Button>
              </View>
              <View className="flex-1">
                <Button testID="two-factor-share-codes" fullWidth variant="outline" onPress={() => void shareCodes()}>
                  {t('twoFactor.codes.share')}
                </Button>
              </View>
            </View>
          ) : null}
          {notice ? <Text accessibilityLiveRegion="polite" className="text-sm text-muted-foreground">{notice}</Text> : null}
          <Button testID="two-factor-done" fullWidth onPress={onDone}>{t('twoFactor.codes.done')}</Button>
        </>
      ) : null}
    </View>
  );
}
