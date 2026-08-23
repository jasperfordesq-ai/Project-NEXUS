// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Card as HeroCard, Spinner } from 'heroui-native';

import { verifyEmail } from '@/lib/api/auth';
import { ApiResponseError } from '@/lib/api/client';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import Button from '@/components/ui/Button';

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
        setMessage(err instanceof ApiResponseError || err instanceof Error ? err.message : t('verifyEmail.genericError'));
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
      <ScrollView contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom }} className="flex-grow">
        <View className="flex-1 justify-center px-5 py-10">
          <HeroCard className="overflow-hidden">
            <HeroCard.Header className="items-center px-6 pt-8 pb-4">
              <View className="mb-4 h-[72px] w-[72px] items-center justify-center rounded-2xl" style={{ backgroundColor: tone }}>
                {state === 'loading' ? (
                  <Spinner color="white" />
                ) : (
                  <Ionicons name={icon} size={32} color="#fff" />
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
                  <Button fullWidth onPress={() => router.replace('/login')}>
                    {t('verifyEmail.backToLogin')}
                  </Button>
                  <Text className="text-center text-xs leading-5 text-muted-foreground">
                    {t('verifyEmail.resendHint')}
                  </Text>
                </>
              ) : null}
            </HeroCard.Body>
          </HeroCard>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
