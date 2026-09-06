// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { contrastText } from '@/lib/utils/color';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Alert, Button as HeroButton, Card as HeroCard } from 'heroui-native';

import * as Haptics from '@/lib/haptics';
import { ApiResponseError } from '@/lib/api/client';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTheme } from '@/lib/hooks/useTheme';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

function makeLoginSchema(t: (key: string) => string) {
  return z.object({
    email: z.string().email(t('errors.validEmail')),
    password: z.string().min(1, t('errors.passwordRequired')),
  });
}

type LoginFormValues = { email: string; password: string };

export default function LoginScreen() {
  const { t } = useTranslation(['auth', 'common']);
  const { login: authLogin } = useAuth();
  const router = useRouter();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const loginSchema = useMemo(() => makeLoginSchema(t), [t]);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const [isLoading, setIsLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(data: LoginFormValues) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsLoading(true);
    setGlobalError(null);

    try {
      await authLogin({ email: data.email.trim().toLowerCase(), password: data.password });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      if (err instanceof ApiResponseError) {
        setGlobalError(err.message);
      } else {
        setGlobalError(t('errors.unableToSignIn'));
      }
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
        <View
          testID="login-content"
          className="flex-1 justify-center px-5 py-10"
          style={{ width: '100%', maxWidth: 720, alignSelf: 'center' }}
        >
          <HeroCard className="overflow-hidden">
            <HeroCard.Header className="items-center px-6 pt-8 pb-4">
              <View
                className="w-[72px] h-[72px] rounded-2xl items-center justify-center mb-4"
                style={{ backgroundColor: primary }}
                accessibilityRole="image"
                accessibilityLabel={t('common:appName')}
              >
                <Text className="text-[32px] font-bold" style={{ color: contrastText(primary) }}>N</Text>
              </View>
              <HeroCard.Title className="text-2xl font-bold text-center">
                {t('login.title')}
              </HeroCard.Title>
              <HeroCard.Description className="text-center mt-1">
                {t('login.subtitle')}
              </HeroCard.Description>
            </HeroCard.Header>

            <HeroCard.Body className="px-6 pb-6">
              {globalError ? (
                <Alert
                  status="danger"
                  className="mb-4"
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                >
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Description className="text-danger">{globalError}</Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : null}

              <View className="gap-1">
                <Controller
                  control={control}
                  name="email"
                  render={({ field: { onChange, onBlur, value } }) => (
                    <Input
                      testID="email-input"
                      label={t('login.email')}
                      value={value}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      error={errors.email?.message}
                      placeholder={t('login.emailPlaceholder')}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoComplete="email"
                      returnKeyType="next"
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="password"
                  render={({ field: { onChange, onBlur, value } }) => (
                    <Input
                      testID="password-input"
                      label={t('login.password')}
                      value={value}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      error={errors.password?.message}
                      placeholder={t('login.passwordPlaceholder')}
                      secureTextEntry={!showPassword}
                      autoComplete="password"
                      textContentType="password"
                      returnKeyType="done"
                      onSubmitEditing={handleSubmit(onSubmit)}
                      rightIcon={
                        <HeroButton
                          isIconOnly
                          size="sm"
                          variant="ghost"
                          onPress={() => setShowPassword((p) => !p)}
                          accessibilityLabel={t('login.togglePassword')}
                        >
                          <Ionicons
                            name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                            size={20}
                            color={theme.textMuted}
                          />
                        </HeroButton>
                      }
                    />
                  )}
                />

                <View className="mt-6">
                  <Button
                    testID="login-submit"
                    onPress={handleSubmit(onSubmit)}
                    isLoading={isLoading}
                    fullWidth
                  >
                    {t('login.submit')}
                  </Button>
                </View>

                <Button
                  variant="outline"
                  size="sm"
                  fullWidth
                  onPress={() => router.push('/forgot-password' as never)}
                  accessibilityLabel={t('login.forgotPassword')}
                  className="mt-3.5"
                >
                  {t('login.forgotPassword')}
                </Button>
              </View>
            </HeroCard.Body>

            <HeroCard.Footer className="px-6 pb-6 pt-0">
              <View className="w-full gap-3">
                <View className="items-center gap-2">
                  <Text className="text-muted-foreground text-sm text-center">
                    {t('login.noAccount')}
                  </Text>
                  <Button
                    variant="outline"
                    fullWidth
                    onPress={() => router.push('/register')}
                    accessibilityLabel={t('login.register')}
                  >
                    {t('login.register')}
                  </Button>
                </View>

                <View className="items-center gap-2">
                  <Text className="text-muted-foreground text-sm text-center">
                    {t('wrongTimebank')}
                  </Text>
                  <Button
                    variant="outline"
                    fullWidth
                    onPress={() => router.push('/select-tenant')}
                    accessibilityLabel={t('switchCommunity')}
                  >
                    {t('switchCommunity')}
                  </Button>
                </View>
              </View>
            </HeroCard.Footer>
          </HeroCard>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
