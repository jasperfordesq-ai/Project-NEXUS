// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { beginMfaSetup, verifyMfa, type LoginChallenge, type MfaSession } from '@/lib/api/auth';
import { ApiResponseError } from '@/lib/api/client';
import { describeApiError } from '@/lib/api/describeApiError';
import { useAuth } from '@/lib/hooks/useAuth';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

/** Challenge, setup secret and recovery codes never leave this screen's memory. */
type MfaSignInProps = {
  challenge: LoginChallenge;
  onCancel: () => void;
};

export default function MfaSignIn(props: MfaSignInProps) {
  return <MfaChallenge key={props.challenge.two_factor_token} {...props} />;
}

function MfaChallenge({ challenge, onCancel }: MfaSignInProps) {
  const { t } = useTranslation('auth');
  const { completeMfa, captureSessionGuard } = useAuth();
  const sessionOwner = useRef<(() => boolean) | null>(null);
  sessionOwner.current ??= captureSessionGuard();
  const insets = useSafeAreaInsets();
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState(challenge.methods?.includes('totp') === false && challenge.methods.includes('backup_code'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [issued, setIssued] = useState<MfaSession | null>(null);
  const initialised = useRef(false);
  const requestInFlight = useRef(false);
  const mounted = useRef(true);
  const setup = challenge.requires_2fa_setup === true;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function ownsSession() {
    if (!mounted.current) return false;
    if (sessionOwner.current?.()) return true;
    setIssued(null);
    setSecret('');
    setCode('');
    setExpired(true);
    setError(t('mfa.login.twofa_session_expired'));
    return false;
  }

  useEffect(() => {
    // Auth context changes re-render this screen even if navigation retains it.
    if (!expired) ownsSession();
  });

  function showError(reason: unknown) {
    if (!ownsSession()) return;
    const isExpired = reason instanceof ApiResponseError
      && ['AUTH_2FA_TOKEN_EXPIRED', 'AUTH_2FA_EXPIRED'].includes(reason.code ?? '');
    setExpired(isExpired);
    if (isExpired) { setSecret(''); setCode(''); }
    setError(isExpired ? t('mfa.login.twofa_session_expired')
      : describeApiError(reason, t('mfa.setup.failed')));
  }

  async function loadSetup() {
    if (requestInFlight.current || !ownsSession() || expired) return;
    requestInFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await beginMfaSetup(challenge.two_factor_token);
      if (ownsSession()) setSecret(response.data.secret);
    } catch (reason) { showError(reason); }
    finally { requestInFlight.current = false; if (mounted.current) setBusy(false); }
  }

  useEffect(() => {
    if (setup && !initialised.current) {
      initialised.current = true;
      void loadSetup();
    }
    // A setup POST creates a secret; never repeat it on field edits or re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    if (requestInFlight.current || !ownsSession() || expired) return;
    if (!issued && (backup ? !code.trim() : !/^\d{6}$/.test(code))) return;
    requestInFlight.current = true;
    setBusy(true);
    setError('');
    let completingSession = false;
    try {
      const session = issued ?? await verifyMfa(challenge, code.trim(), backup);
      if (!ownsSession()) return;
      setIssued(session);
      setCode('');
      setSecret('');
      // A setup code has now been consumed. Preserve its issued session for a
      // profile-load retry and wait until recovery codes have been saved.
      if (!issued && session.backup_codes?.length) return;
      completingSession = true;
      const completion = completeMfa(session);
      // Provider completion advances its generation before any asynchronous work.
      // Retain that ownership for retry, but never accept a later sign-in/logout.
      sessionOwner.current = captureSessionGuard();
      await completion;
      if (!ownsSession()) return;
    } catch (reason) {
      if (!ownsSession()) return;
      if (completingSession && reason instanceof ApiResponseError && reason.status === 401) {
        setIssued(null);
        setExpired(true);
        setError(t('mfa.login.twofa_session_expired'));
      } else showError(reason);
    }
    finally { requestInFlight.current = false; if (mounted.current) setBusy(false); }
  }

  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}>
        <View className="gap-4 px-5" style={{ width: '100%', maxWidth: 720, alignSelf: 'center' }}>
          <Text accessibilityRole="header" className="text-2xl font-bold text-foreground">
            {t(issued?.backup_codes?.length ? 'mfa.setup.recovery_title' : setup ? 'mfa.setup.title' : 'mfa.login.twofa_title')}
          </Text>
          {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" className="text-danger">{error}</Text> : null}
          {issued ? <>
            {issued.backup_codes?.length ? <>
              <Text className="text-foreground">{t('mfa.setup.recovery_help')}</Text>
              <Text selectable className="text-foreground text-lg">{issued.backup_codes.join('\n')}</Text>
            </> : null}
            <Button isLoading={busy} accessibilityLabel={t(issued.backup_codes?.length ? 'mfa.setup.saved' : 'mfa.login.twofa_verify')} onPress={() => void submit()}>{t(issued.backup_codes?.length ? 'mfa.setup.saved' : 'mfa.login.twofa_verify')}</Button>
          </> : <>
            <Text className="text-foreground">{t(setup ? 'mfa.setup.reason' : 'mfa.login.twofa_subtitle')}</Text>
            {setup && secret ? <>
              <Text className="text-foreground">{t('mfa.setup.manual')}</Text>
              <Text testID="mfa-setup-secret" selectable className="text-foreground text-lg">{secret}</Text>
            </> : null}
            {setup && !secret && !expired ? <Button isLoading={busy} accessibilityLabel={t('mfa.setup.retry')} onPress={() => void loadSetup()}>{t('mfa.setup.retry')}</Button> : null}
            {(!setup || secret) && !expired ? <>
              <Input testID="mfa-code" label={t(backup ? 'mfa.login.twofa_backup_code_label' : 'mfa.login.twofa_code_label')}
                value={code} onChangeText={setCode} editable={!busy} autoCapitalize="none" autoCorrect={false}
                keyboardType={backup ? 'default' : 'number-pad'} autoComplete="one-time-code" textContentType="oneTimeCode"
                maxLength={backup ? 32 : 6} onSubmitEditing={() => void submit()} />
              <Button isLoading={busy} accessibilityLabel={t('mfa.login.twofa_verify')} disabled={backup ? !code.trim() : !/^\d{6}$/.test(code)} onPress={() => void submit()}>{t('mfa.login.twofa_verify')}</Button>
              {!setup && (challenge.methods ?? ['totp', 'backup_code']).includes('backup_code') && (challenge.methods ?? ['totp']).includes('totp') ? <Button variant="outline" disabled={busy}
                onPress={() => { setBackup(!backup); setCode(''); setError(''); }}>
                {t(backup ? 'mfa.login.twofa_code_label' : 'mfa.login.twofa_use_backup')}
              </Button> : null}
            </> : null}
            {!setup ? <Text className="text-muted-foreground">{t('mfa.login.twofa_help')}</Text> : null}
            <Button variant="ghost" disabled={busy} onPress={onCancel}>{t('mfa.setup.cancel')}</Button>
          </>}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
