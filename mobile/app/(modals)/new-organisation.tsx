// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Spinner, Surface, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';
import * as Haptics from '@/lib/haptics';

import { createOrganisation } from '@/lib/api/organisations';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme, type Theme } from '@/lib/hooks/useTheme';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { withAlpha } from '@/lib/utils/color';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import AccentIcon from '@/components/ui/AccentIcon';

type FormField = 'name' | 'description' | 'contact_email' | 'website' | 'terms';
type FormErrors = Partial<Record<FormField, string>>;

interface FormState {
  name: string;
  description: string;
  contact_email: string;
  website: string;
}

const INITIAL_FORM: FormState = {
  name: '',
  description: '',
  contact_email: '',
  website: '',
};

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isValidWebsite(value: string) {
  return value.trim() === '' || /^https?:\/\/.+/i.test(value.trim());
}

export default function NewOrganisationScreen() {
  return (
    <ModalErrorBoundary>
      <NewOrganisationInner />
    </ModalErrorBoundary>
  );
}

function NewOrganisationInner() {
  const { t } = useTranslation(['organisations', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);

  // 🔴 Cancel and Back used to drop a half-written registration without a word (S4-04).
  const isDirty = form.name !== '' || form.description !== '' || form.contact_email !== '' || form.website !== '' || agreedTerms;
  useUnsavedChangesGuard({
    isDirty,
    isBusy: isSubmitting || hasSaved,
    confirm,
    title: t('register.unsavedTitle'),
    message: t('register.unsavedMessage'),
    discardLabel: t('register.discard'),
    cancelLabel: t('common:buttons.cancel'),
  });

  const trimmed = useMemo(() => ({
    name: form.name.trim(),
    description: form.description.trim(),
    contact_email: form.contact_email.trim(),
    website: form.website.trim(),
  }), [form]);

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function validate(): boolean {
    const nextErrors: FormErrors = {};

    if (!trimmed.name) {
      nextErrors.name = t('register.errors.nameRequired');
    } else if (trimmed.name.length < 3) {
      nextErrors.name = t('register.errors.nameMin');
    }

    if (!trimmed.description) {
      nextErrors.description = t('register.errors.descriptionRequired');
    } else if (trimmed.description.length < 20) {
      nextErrors.description = t('register.errors.descriptionMin');
    }

    if (!trimmed.contact_email) {
      nextErrors.contact_email = t('register.errors.emailRequired');
    } else if (!isEmail(trimmed.contact_email)) {
      nextErrors.contact_email = t('register.errors.emailInvalid');
    }

    if (!isValidWebsite(trimmed.website)) {
      nextErrors.website = t('register.errors.websiteInvalid');
    }

    if (!agreedTerms) {
      nextErrors.terms = t('register.errors.termsRequired');
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function submit() {
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const response = await createOrganisation({
        name: trimmed.name,
        description: trimmed.description,
        contact_email: trimmed.contact_email,
        ...(trimmed.website ? { website: trimmed.website } : {}),
      });
      const organisation = response.data;
      setHasSaved(true);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('register.successTitle'), description: t('register.successMessage'), variant: 'success' });
      router.replace({
        pathname: '/(modals)/volunteering',
        params: { tab: 'organisations', submitted: String(organisation.id) },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : t('register.saveFailedMessage');
      showToast({ title: t('register.saveFailedTitle'), description: message, variant: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={t('register.title')} backLabel={t('common:back')} fallbackHref="/(modals)/organisations" />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.bg }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{ flexGrow: 1, padding: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <HeroCard className="mb-4 overflow-hidden rounded-panel p-0">
          <View className="h-1.5" style={{ backgroundColor: primary }} />
          <HeroCard.Body className="gap-3 p-4">
            <View className="flex-row items-start gap-3">
              <View className="size-12 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                <Ionicons name="business-outline" size={24} color={primary} />
              </View>
              <View className="min-w-0 flex-1 gap-1">
                <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('register.eyebrow')}</Text>
                <Text className="text-2xl font-bold" style={{ color: theme.text }}>{t('register.title')}</Text>
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('register.subtitle')}</Text>
              </View>
            </View>
          </HeroCard.Body>
        </HeroCard>

        <HeroCard className="rounded-panel p-0">
          <HeroCard.Body className="gap-4 p-4">
            <FormInput
              label={t('register.nameLabel')}
              value={form.name}
              onChangeText={(value) => updateField('name', value)}
              placeholder={t('register.namePlaceholder')}
              error={errors.name}
              theme={theme}
              autoCapitalize="words"
            />

            <FormInput
              label={t('register.descriptionLabel')}
              value={form.description}
              onChangeText={(value) => updateField('description', value)}
              placeholder={t('register.descriptionPlaceholder')}
              error={errors.description}
              theme={theme}
              multiline
              minHeight={120}
            />

            <FormInput
              label={t('register.emailLabel')}
              value={form.contact_email}
              onChangeText={(value) => updateField('contact_email', value)}
              placeholder={t('register.emailPlaceholder')}
              error={errors.contact_email}
              theme={theme}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <FormInput
              label={t('register.websiteLabel')}
              value={form.website}
              onChangeText={(value) => updateField('website', value)}
              placeholder={t('register.websitePlaceholder')}
              error={errors.website}
              theme={theme}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <TermsCard
              agreedTerms={agreedTerms}
              error={errors.terms}
              primary={primary}
              theme={theme}
              t={t}
              onToggle={() => {
                setAgreedTerms((current) => !current);
                setErrors((current) => ({ ...current, terms: undefined }));
              }}
            />

            <Surface variant="secondary" className="flex-row items-start gap-3 rounded-panel-inner p-4">
              <Ionicons name="time-outline" size={18} color="#f59e0b" />
              <Text className="flex-1 text-sm leading-5" style={{ color: theme.textSecondary }}>
                {t('register.pendingApprovalNotice')}
              </Text>
            </Surface>

            <View className="flex-row gap-3 pt-2">
              <HeroButton className="flex-1" variant="secondary" onPress={() => router.back()} isDisabled={isSubmitting}>
                <HeroButton.Label>{t('register.cancel')}</HeroButton.Label>
              </HeroButton>
              <HeroButton className="flex-1" variant="primary" onPress={submit} isDisabled={isSubmitting}>
                {isSubmitting ? <Spinner size="sm" /> : <AccentIcon name="save-outline" size={16} />}
                <HeroButton.Label>{t('register.submit')}</HeroButton.Label>
              </HeroButton>
            </View>
          </HeroCard.Body>
        </HeroCard>
      </ScrollView>
      </KeyboardAvoidingView>
      {confirmDialog}
    </SafeAreaView>
  );
}

function FormInput({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  theme,
  multiline,
  minHeight,
  keyboardType,
  autoCapitalize,
  autoCorrect,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  error?: string;
  theme: Theme;
  multiline?: boolean;
  minHeight?: number;
  keyboardType?: 'default' | 'email-address' | 'url';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
}) {
  return (
    <View>
      <Input
        label={label}
        error={error}
        style={{
          color: theme.text,
          minHeight: minHeight ?? 48,
          textAlignVertical: multiline ? 'top' : 'center',
        }}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
      />
    </View>
  );
}

function TermsCard({
  agreedTerms,
  error,
  primary,
  theme,
  t,
  onToggle,
}: {
  agreedTerms: boolean;
  error?: string;
  primary: string;
  theme: Theme;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onToggle: () => void;
}) {
  return (
    <Surface variant="secondary" className="gap-3 rounded-panel-inner p-4">
      <View className="flex-row items-center gap-2">
        <Ionicons name="shield-checkmark-outline" size={18} color={primary} />
        <Text className="text-sm font-bold" style={{ color: theme.text }}>{t('register.termsTitle')}</Text>
      </View>
      <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('register.termsSummary')}</Text>
      <Checkbox checked={agreedTerms} onPress={onToggle} label={t('register.termsAgreement')} />
      {error ? <Text className="text-xs" style={{ color: theme.error }}>{error}</Text> : null}
    </Surface>
  );
}
