// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { contrastText } from '@/lib/utils/color';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Alert, Card as HeroCard } from 'heroui-native';
import { Button as HeroButton } from '@/components/ui/NativeButton';

import { resetPassword } from '@/lib/api/auth';
import { ApiResponseError } from '@/lib/api/client';
import { useTheme } from '@/lib/hooks/useTheme';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

type ResetPasswordFormValues = {
  password: string;
  passwordConfirmation: string;
};

function makeResetPasswordSchema(t: (key: string) => string) {
  return z.object({
    // 12 matches the backend PasswordResetController::MIN_PASSWORD_LENGTH —
    // a lower client minimum just turns into a server 422 after submit.
    password: z.string().min(12, t('errors.weakPassword')),
    passwordConfirmation: z.string().min(1, t('resetPassword.confirmRequired')),
  }).refine((data) => data.password === data.passwordConfirmation, {
    path: ['passwordConfirmation'],
    message: t('resetPassword.passwordsNoMatch'),
  });
}

export default function ResetPasswordScreen() {
  const { t } = useTranslation(['auth', 'common']);
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = typeof params.token === 'string' ? params.token : '';
  const primary = usePrimaryColor();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const schema = useMemo(() => makeResetPasswordSchema(t), [t]);
  const routeTokenRef = useRef(token);
  routeTokenRef.current = token;
  const pending = useRef<object | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pending.current = null; };
  }, []);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isTokenInvalid, setIsTokenInvalid] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const {
    control,
    handleSubmit,
    reset: resetForm,
    formState: { errors },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', passwordConfirmation: '' },
  });

  useEffect(() => {
    // Expo Router can replace the query on the existing screen instance. A second
    // recovery credential must never inherit the first credential's secret fields,
    // success state or refusal state.
    pending.current = null;
    resetForm({ password: '', passwordConfirmation: '' });
    setIsLoading(false);
    setIsSubmitted(false);
    setIsTokenInvalid(false);
    setSubmitError(null);
    setShowPassword(false);
  }, [resetForm, token]);

  async function onSubmit(data: ResetPasswordFormValues) {
    if (!token || pending.current || !mounted.current) return;
    const submittedToken = token;
    const operation = {};
    pending.current = operation;
    const isCurrent = () => mounted.current && pending.current === operation && routeTokenRef.current === submittedToken;
    setIsLoading(true);
    setSubmitError(null);
    try {
      const response = await resetPassword({
        token,
        password: data.password,
        password_confirmation: data.passwordConfirmation,
      });
      if (!isCurrent()) return;
      if (response.success === false) {
        if (response.code === 'AUTH_TOKEN_INVALID') {
          setIsTokenInvalid(true);
          return;
        }
        setSubmitError(response.error ?? t('resetPassword.genericError'));
        return;
      }
      setIsSubmitted(true);
    } catch (err) {
      if (!isCurrent()) return;
      if (err instanceof ApiResponseError && err.code === 'AUTH_TOKEN_INVALID') {
        setIsTokenInvalid(true);
        return;
      }
      setSubmitError(err instanceof ApiResponseError ? err.message : t('resetPassword.genericError'));
    } finally {
      if (isCurrent()) {
        pending.current = null;
        setIsLoading(false);
      }
    }
  }

  if (!token || isTokenInvalid) {
    return (
      <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top, paddingBottom: insets.bottom }} className="flex-grow">
          <View className="flex-1 justify-center px-5 py-10">
            <HeroCard className="overflow-hidden" style={{ flexShrink: 0 }}>
              <HeroCard.Header className="items-center px-6 pt-8 pb-4">
                <View
                  className="mb-4 h-[72px] w-[72px] items-center justify-center rounded-2xl"
                  style={{ backgroundColor: theme.error }}
                >
                  <Ionicons name="alert-outline" size={32} color={contrastText(theme.error)} />
                </View>
                <HeroCard.Title className="text-center text-2xl font-bold">{t('resetPassword.invalidTitle')}</HeroCard.Title>
                <HeroCard.Description className="mt-1 text-center">{t('resetPassword.invalidSubtitle')}</HeroCard.Description>
              </HeroCard.Header>
              <HeroCard.Body className="px-6 pb-6">
                <Button fullWidth onPress={() => router.replace('/forgot-password' as Href)}>
                  {t('resetPassword.requestNewLink')}
                </Button>
              </HeroCard.Body>
            </HeroCard>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top, paddingBottom: insets.bottom }}
        className="flex-grow"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View className="flex-1 justify-center px-5 py-10">
          <HeroCard className="overflow-hidden" style={{ flexShrink: 0 }}>
            <HeroCard.Header className="items-center px-6 pt-8 pb-4">
              <View
                className="mb-4 h-[72px] w-[72px] items-center justify-center rounded-2xl"
                style={{ backgroundColor: isSubmitted ? theme.success : primary }}
              >
                <Ionicons
                  name={isSubmitted ? 'checkmark-outline' : 'lock-closed-outline'}
                  size={32}
                  color={contrastText(isSubmitted ? theme.success : primary)}
                />
              </View>
              <HeroCard.Title className="text-center text-2xl font-bold">
                {isSubmitted ? t('resetPassword.successTitle') : t('resetPassword.title')}
              </HeroCard.Title>
              <HeroCard.Description className="mt-1 text-center">
                {isSubmitted ? t('resetPassword.successSubtitle') : t('resetPassword.subtitle')}
              </HeroCard.Description>
            </HeroCard.Header>

            <HeroCard.Body className="px-6 pb-6">
              {isSubmitted ? (
                <Button fullWidth onPress={() => router.replace('/login')}>
                  {t('resetPassword.signIn')}
                </Button>
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
                    name="password"
                    render={({ field: { onChange, onBlur, value } }) => (
                      <Input
                        label={t('resetPassword.password')}
                        value={value}
                        onChangeText={(next) => {
                          onChange(next);
                          setSubmitError(null);
                        }}
                        onBlur={onBlur}
                        error={errors.password?.message}
                        placeholder={t('resetPassword.passwordPlaceholder')}
                        secureTextEntry={!showPassword}
                        autoComplete="new-password"
                        returnKeyType="next"
                        leftIcon={<Ionicons name="lock-closed-outline" size={18} color={theme.textMuted} />}
                        rightIcon={(
                          <HeroButton isIconOnly variant="secondary" accessibilityLabel={showPassword ? t('login.hidePassword') : t('login.showPassword')} onPress={() => setShowPassword((current) => !current)}>
                            <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={theme.textMuted} />
                          </HeroButton>
                        )}
                      />
                    )}
                  />

                  <Controller
                    control={control}
                    name="passwordConfirmation"
                    render={({ field: { onChange, onBlur, value } }) => (
                      <Input
                        label={t('resetPassword.confirmPassword')}
                        value={value}
                        onChangeText={(next) => {
                          onChange(next);
                          setSubmitError(null);
                        }}
                        onBlur={onBlur}
                        error={errors.passwordConfirmation?.message}
                        placeholder={t('resetPassword.confirmPasswordPlaceholder')}
                        secureTextEntry={!showPassword}
                        autoComplete="new-password"
                        returnKeyType="send"
                        onSubmitEditing={isLoading ? undefined : handleSubmit(onSubmit)}
                        leftIcon={<Ionicons name="lock-closed-outline" size={18} color={theme.textMuted} />}
                      />
                    )}
                  />

                  <View className="mt-6 gap-3">
                    <Button onPress={handleSubmit(onSubmit)} isLoading={isLoading} accessibilityLabel={t('resetPassword.submit')} fullWidth>
                      {t('resetPassword.submit')}
                    </Button>
                    <Button variant="ghost" fullWidth onPress={() => router.replace('/login')}>
                      {t('resetPassword.backToLogin')}
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
