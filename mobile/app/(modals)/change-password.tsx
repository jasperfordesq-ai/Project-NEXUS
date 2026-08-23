// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import * as Haptics from '@/lib/haptics';
import { Card as HeroCard, Description, Text } from 'heroui-native';

import { useTranslation } from 'react-i18next';

import { updatePassword } from '@/lib/api/profile';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import FormActionFooter from '@/components/ui/FormActionFooter';
import Input from '@/components/ui/Input';
import OfflineBanner from '@/components/OfflineBanner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';

function ChangePasswordScreenInner() {
  const { t } = useTranslation(['settings', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    currentPassword?: string;
    newPassword?: string;
    confirmPassword?: string;
  }>({});

  async function handleSubmit() {
    const errors: typeof fieldErrors = {};
    if (!currentPassword.trim()) {
      errors.currentPassword = t('password.validation.currentRequired');
    }
    if (!newPassword.trim()) {
      errors.newPassword = t('password.validation.newRequired');
    } else if (newPassword.length < 12) {
      errors.newPassword = t('password.validation.tooShort');
    }
    if (newPassword.trim() && newPassword !== confirmPassword) {
      errors.confirmPassword = t('password.validation.mismatch');
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    setIsLoading(true);
    try {
      await updatePassword({
        current_password: currentPassword,
        new_password: newPassword,
        new_password_confirmation: confirmPassword,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('password.success'), description: t('password.successMessage'), variant: 'success' });
      router.back();
    } catch (err: unknown) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const message =
        err instanceof Error ? err.message : t('password.changeError');
      showToast({ title: t('common:errors.generic'), description: message, variant: 'danger' });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('password.title')} backLabel={t('common:buttons.back')} fallbackHref="/(modals)/settings" />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 12 }}
          keyboardShouldPersistTaps="handled"
        >
          <OfflineBanner />

          <HeroCard className="overflow-hidden rounded-panel p-0">
            <View className="h-1.5" style={{ backgroundColor: primary }} />
            <HeroCard.Body className="gap-4 p-4">
              <View className="flex-row items-start gap-3">
                <View className="size-13 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                  <Ionicons name="shield-checkmark-outline" size={25} color={primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('password.eyebrow')}</Text>
                  <Text className="text-2xl font-bold" style={{ color: theme.text }}>{t('password.title')}</Text>
                  <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('password.hint')}</Text>
                </View>
              </View>
            </HeroCard.Body>
          </HeroCard>

          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-4 p-4">
              <PasswordField
                label={t('password.currentLabel')}
                placeholder={t('password.currentPlaceholder')}
                value={currentPassword}
                onChangeText={(v) => { setCurrentPassword(v); setFieldErrors((e) => ({ ...e, currentPassword: undefined })); }}
                error={fieldErrors.currentPassword}
                theme={theme}
              />
              <PasswordField
                label={t('password.newLabel')}
                placeholder={t('password.newPlaceholder')}
                value={newPassword}
                onChangeText={(v) => { setNewPassword(v); setFieldErrors((e) => ({ ...e, newPassword: undefined })); }}
                error={fieldErrors.newPassword}
                helper={t('password.newHint')}
                theme={theme}
              />
              <PasswordField
                label={t('password.confirmLabel')}
                placeholder={t('password.confirmPlaceholder')}
                value={confirmPassword}
                onChangeText={(v) => { setConfirmPassword(v); setFieldErrors((e) => ({ ...e, confirmPassword: undefined })); }}
                error={fieldErrors.confirmPassword}
                theme={theme}
              />
            </HeroCard.Body>
          </HeroCard>
        </ScrollView>
        <FormActionFooter
          title={t('password.reviewTitle')}
          subtitle={t('password.reviewSubtitle')}
          submitLabel={isLoading ? t('password.saving') : t('password.save')}
          secondaryLabel={t('common:buttons.cancel')}
          primary={primary}
          isSubmitting={isLoading}
          onSubmit={() => void handleSubmit()}
          onSecondary={() => router.back()}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PasswordField({
  label,
  value,
  placeholder,
  onChangeText,
  error,
  helper,
  theme,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
  error?: string;
  helper?: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View className="gap-1.5">
      <Input
        label={label}
        error={error}
        style={{ color: theme.text }}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label}
      />
      {helper ? (
        <Description isInvalid={!!error} hideOnInvalid className="text-xs">{helper}</Description>
      ) : null}
    </View>
  );
}

export default function ChangePasswordScreen() {
  return (
    <ModalErrorBoundary>
      <ChangePasswordScreenInner />
    </ModalErrorBoundary>
  );
}
