// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { contrastText } from '@/lib/utils/color';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Card as HeroCard, Spinner } from 'heroui-native';

import { resendVerificationByEmail, verifyEmail } from '@/lib/api/auth';
import { describeApiError } from '@/lib/api/describeApiError';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

type VerifyState = 'loading' | 'success' | 'error' | 'invalid';

export default function VerifyEmailScreen() {
  const { t } = useTranslation(['auth', 'common']);
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = typeof params.token === 'string' ? params.token : '';
  const primary = usePrimaryColor();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<VerifyState>(token ? 'loading' : 'invalid');
  const [message, setMessage] = useState<string | null>(null);

  /*
    🔴 The advice on this screen used to be "sign in to request another verification
    email from your account settings" — advice the member cannot follow, because signing
    in is the thing the unverified address is blocking. An expired or already-used link
    left them with a dead end and a suggestion that leads back to it.

    `/auth/resend-verification-by-email` is public precisely so it can be used from
    here. It is asked for the address because this screen arrives from a deep link and
    knows nothing about who opened it. The reply is the same whether or not the address
    is registered, deliberately, so this cannot be used to find out who is a member —
    which is also why the confirmation below says a message was sent rather than
    claiming the account exists.
  */
  const [resendEmail, setResendEmail] = useState('');
  const [isResending, setIsResending] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  async function resend() {
    const address = resendEmail.trim().toLowerCase();
    if (isResending || !address) return;
    setIsResending(true);
    setResendError(null);
    setResendNotice(null);
    try {
      await resendVerificationByEmail(address);
      setResendNotice(t('verifyEmail.resendSent'));
    } catch (err) {
      setResendError(describeApiError(err, t('verifyEmail.resendFailed')));
    } finally {
      setIsResending(false);
    }
  }

  useEffect(() => {
    if (!token) {
      setState('invalid');
      return;
    }

    let cancelled = false;
    async function run() {
      setState('loading');
      setMessage(null);
      try {
        const response = await verifyEmail(token);
        if (cancelled) return;
        if (response.success === false) {
          setMessage(response.error ?? t('verifyEmail.genericError'));
          setState('error');
          return;
        }
        setMessage(response.data?.message ?? response.message ?? null);
        setState('success');
      } catch (err) {
        if (cancelled) return;
        // describeApiError keeps the server's wording and hides raw JavaScript error text.
        setMessage(describeApiError(err, t('verifyEmail.genericError')));
        setState('error');
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [token, t]);

  // `tone` fills a 72x72 tile behind a white icon, so it must clear 3:1 against
  // white. The literals here were #16A34A and #DC2626 — the exact values replaced
  // on 2026-08-18 for failing contrast, left behind in this file. The tokens are
  // 5.8:1 and 6.5:1 against white respectively.
  const tone = state === 'success'
    ? theme.success
    : state === 'error' || state === 'invalid' ? theme.error : primary;
  const icon = state === 'success' ? 'checkmark-outline' : state === 'error' || state === 'invalid' ? 'alert-outline' : 'mail-outline';
  const title =
    state === 'success'
      ? t('verifyEmail.successTitle')
      : state === 'invalid'
        ? t('verifyEmail.invalidTitle')
        : state === 'error'
          ? t('verifyEmail.errorTitle')
          : t('verifyEmail.loadingTitle');
  const subtitle =
    state === 'success'
      ? t('verifyEmail.successSubtitle')
      : state === 'invalid'
        ? t('verifyEmail.invalidSubtitle')
        : state === 'error'
          ? message ?? t('verifyEmail.genericError')
          : t('verifyEmail.loadingSubtitle');

  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top, paddingBottom: insets.bottom }} className="flex-grow">
        <View className="flex-1 justify-center px-5 py-10">
          <HeroCard className="overflow-hidden">
            <HeroCard.Header className="items-center px-6 pt-8 pb-4">
              <View className="mb-4 h-[72px] w-[72px] items-center justify-center rounded-2xl" style={{ backgroundColor: tone }}>
                {state === 'loading' ? (
                  <Spinner color="white" />
                ) : (
                  <Ionicons name={icon} size={32} color={contrastText(primary)} />
                )}
              </View>
              <HeroCard.Title className="text-center text-2xl font-bold">{title}</HeroCard.Title>
              <HeroCard.Description className="mt-1 text-center">{subtitle}</HeroCard.Description>
            </HeroCard.Header>

            <HeroCard.Body className="gap-3 px-6 pb-6">
              {state === 'success' ? (
                <Button fullWidth onPress={() => router.replace('/login')}>
                  {t('verifyEmail.signIn')}
                </Button>
              ) : null}
              {state === 'error' || state === 'invalid' ? (
                <>
                  <Text className="text-center text-sm leading-5 text-muted-foreground">
                    {t('verifyEmail.resendHint')}
                  </Text>
                  <Input
                    value={resendEmail}
                    onChangeText={setResendEmail}
                    placeholder={t('verifyEmail.resendEmailPlaceholder')}
                    accessibilityLabel={t('verifyEmail.resendEmailLabel')}
                    autoCapitalize="none"
                    autoComplete="email"
                    keyboardType="email-address"
                    testID="verify-email-resend-input"
                  />
                  {resendNotice ? (
                    <Text accessibilityRole="alert" className="text-center text-sm" style={{ color: theme.success }}>
                      {resendNotice}
                    </Text>
                  ) : null}
                  {resendError ? (
                    <Text accessibilityRole="alert" className="text-center text-sm" style={{ color: theme.error }}>
                      {resendError}
                    </Text>
                  ) : null}
                  <Button
                    fullWidth
                    disabled={isResending || resendEmail.trim().length === 0}
                    onPress={() => void resend()}
                    accessibilityLabel={t('verifyEmail.resendAction')}
                    testID="verify-email-resend"
                  >
                    {isResending ? t('verifyEmail.resendSending') : t('verifyEmail.resendAction')}
                  </Button>
                  <Button variant="outline" fullWidth onPress={() => router.replace('/login')}>
                    {t('verifyEmail.backToLogin')}
                  </Button>
                </>
              ) : null}
            </HeroCard.Body>
          </HeroCard>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
