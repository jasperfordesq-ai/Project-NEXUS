// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Alert, Card as HeroCard } from 'heroui-native';

import { forgotPassword } from '@/lib/api/auth';
import { ApiResponseError } from '@/lib/api/client';
import { useTheme } from '@/lib/hooks/useTheme';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

type ForgotPasswordFormValues = { email: string };

function makeForgotPasswordSchema(t: (key: string) => string) {
  return z.object({
    email: z.string().email(t('errors.validEmail')),
  });
}

export default function ForgotPasswordScreen() {
  const { t } = useTranslation(['auth', 'common']);
  const router = useRouter();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const schema = useMemo(() => makeForgotPasswordSchema(t), [t]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  async function onSubmit(data: ForgotPasswordFormValues) {
    setIsLoading(true);
    setSubmitError(null);
    try {
      const response = await forgotPassword(data.email.trim().toLowerCase());
      if (response.success === false) {
        setSubmitError(response.code === 'RATE_LIMIT_EXCEEDED' ? t('forgotPassword.rateLimited') : response.error ?? t('forgotPassword.genericError'));
        return;
      }
      setIsSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof ApiResponseError ? err.message : t('forgotPassword.genericError'));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
        className="flex-grow"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View className="flex-1 justify-center px-5 py-10">
          <HeroCard className="overflow-hidden">
            <HeroCard.Header className="items-center px-6 pt-8 pb-4">
              <View
                className="mb-4 h-[72px] w-[72px] items-center justify-center rounded-2xl"
                style={{ backgroundColor: isSubmitted ? theme.success : primary }}
              >
                <Ionicons name={isSubmitted ? 'checkmark-outline' : 'mail-outline'} size={32} color="#fff" />
              </View>
              <HeroCard.Title className="text-center text-2xl font-bold">
                {isSubmitted ? t('forgotPassword.successTitle') : t('forgotPassword.title')}
              </HeroCard.Title>
              <HeroCard.Description className="mt-1 text-center">
                {isSubmitted ? t('forgotPassword.successSubtitle') : t('forgotPassword.subtitle')}
              </HeroCard.Description>
            </HeroCard.Header>

            <HeroCard.Body className="px-6 pb-6">
              {isSubmitted ? (
                <View className="gap-4">
                  <Text className="text-center text-sm leading-5 text-muted-foreground">
                    {t('forgotPassword.helpText')}
                  </Text>
                  <Button variant="outline" fullWidth onPress={() => setIsSubmitted(false)}>
                    {t('forgotPassword.tryAgain')}
                  </Button>
                  <Button fullWidth onPress={() => router.replace('/login')}>
                    {t('forgotPassword.backToLogin')}
                  </Button>
                </View>
              ) : (
                <View className="gap-1">
                  {submitError ? (
                    <Alert status="danger" className="mb-4" accessibilityRole="alert" accessibilityLiveRegion="polite">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Description className="text-danger">{submitError}</Alert.Description>
                      </Alert.Content>
                    </Alert>
                  ) : null}

                  <Controller
                    control={control}
                    name="email"
                    render={({ field: { onChange, onBlur, value } }) => (
                      <Input
                        label={t('forgotPassword.email')}
                        value={value}
                        onChangeText={(next) => {
                          onChange(next);
                          setSubmitError(null);
                        }}
                        onBlur={onBlur}
                        error={errors.email?.message}
                        placeholder={t('forgotPassword.emailPlaceholder')}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoComplete="email"
                        returnKeyType="send"
                        onSubmitEditing={handleSubmit(onSubmit)}
                        leftIcon={<Ionicons name="mail-outline" size={18} color={theme.textMuted} />}
                      />
                    )}
                  />

                  <View className="mt-6 gap-3">
                    <Button onPress={handleSubmit(onSubmit)} isLoading={isLoading} fullWidth>
                      {t('forgotPassword.submit')}
                    </Button>
                    <Button variant="ghost" fullWidth onPress={() => router.replace('/login')}>
                      {t('forgotPassword.backToLogin')}
                    </Button>
                  </View>
                </View>
              )}
            </HeroCard.Body>
          </HeroCard>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
