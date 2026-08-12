// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button as HeroButton, Card as HeroCard, Chip, Surface, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import SourceRepositoryLink from '@/components/SourceRepositoryLink';
import Toggle from '@/components/ui/Toggle';
import { changeLanguage, SUPPORTED_LANGUAGES } from '@/lib/i18n';
import { getUserPreferences, saveUserPreferences } from '@/lib/api/settings';
import { useTheme } from '@/lib/hooks/useTheme';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { withAlpha } from '@/lib/utils/color';

const WEB_TRANSLATION_LOCALES = ['en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar'] as const;
const MOBILE_TRANSLATION_LOCALES = WEB_TRANSLATION_LOCALES.filter((locale) => SUPPORTED_LANGUAGES.includes(locale));
type MobileTranslationLocale = (typeof MOBILE_TRANSLATION_LOCALES)[number];

function normalizeLocale(value: string | null | undefined, fallback: string): MobileTranslationLocale {
  const candidate = (value || fallback || 'en').slice(0, 2);
  return MOBILE_TRANSLATION_LOCALES.includes(candidate as MobileTranslationLocale)
    ? candidate as MobileTranslationLocale
    : 'en';
}

export default function SettingsTranslationScreen() {
  const { t, i18n } = useTranslation(['settings', 'common']);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { show: showToast } = useAppToast();
  const initialLocale = normalizeLocale(i18n.resolvedLanguage || i18n.language, 'en');
  const [prefersChronological, setPrefersChronological] = useState(false);
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [targetLocale, setTargetLocale] = useState<MobileTranslationLocale>(initialLocale);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const preferences = await getUserPreferences();
      setPrefersChronological(Boolean(preferences.feed?.prefers_chronological));
      setAutoTranslate(Boolean(preferences.translation?.auto_translate_ugc));
      setTargetLocale(normalizeLocale(preferences.translation?.auto_translate_target_locale, initialLocale));
    } catch {
      showToast({ title: t('common:errors.generic'), description: t('translation.loadError'), variant: 'danger' });
    } finally {
      setIsLoading(false);
    }
  }, [initialLocale, t, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const localeOptions = useMemo(
    () => MOBILE_TRANSLATION_LOCALES.map((locale) => ({
      value: locale,
      label: t(`translation.locales.${locale}`),
    })),
    [t],
  );

  async function handleSave() {
    setIsSaving(true);
    try {
      await saveUserPreferences({
        feed: { prefers_chronological: prefersChronological },
        translation: {
          auto_translate_ugc: autoTranslate,
          auto_translate_target_locale: targetLocale,
        },
      });
      await changeLanguage(targetLocale);
      showToast({ title: t('translation.saved'), description: t('translation.savedBody'), variant: 'success' });
    } catch {
      showToast({ title: t('common:errors.generic'), description: t('translation.saveError'), variant: 'danger' });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background">
        <AppTopBar title={t('translation.title')} backLabel={t('common:buttons.back')} fallbackHref="/(modals)/settings" />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}>
          <HeroCard className="overflow-hidden rounded-panel p-0">
            <View className="h-1.5" style={{ backgroundColor: primary }} />
            <HeroCard.Body className="gap-3 p-4">
              <View className="flex-row items-start gap-3">
                <View className="size-11 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
                  <Ionicons name="language-outline" size={22} color={primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Chip size="sm" variant="soft" color="accent">
                    <Chip.Label>{t('translation.badge')}</Chip.Label>
                  </Chip>
                  <Text className="mt-2 text-xl font-bold" style={{ color: theme.text }}>{t('translation.title')}</Text>
                  <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('translation.subtitle')}</Text>
                </View>
              </View>
            </HeroCard.Body>
          </HeroCard>

          {isLoading ? (
            <LoadingSpinner />
          ) : (
            <>
              <HeroCard className="rounded-panel p-0">
                <HeroCard.Body className="gap-3 p-4">
                  <Text className="text-base font-bold" style={{ color: theme.text }}>{t('translation.feedTitle')}</Text>
                  <Surface variant="secondary" className="rounded-panel-inner px-3 py-2.5">
                    <Toggle
                      label={t('translation.latestFeed')}
                      value={prefersChronological}
                      onValueChange={setPrefersChronological}
                      disabled={isSaving}
                    />
                  </Surface>
                  <Text className="text-xs leading-4" style={{ color: theme.textSecondary }}>{t('translation.latestFeedHint')}</Text>
                </HeroCard.Body>
              </HeroCard>

              <HeroCard className="rounded-panel p-0">
                <HeroCard.Body className="gap-3 p-4">
                  <Text className="text-base font-bold" style={{ color: theme.text }}>{t('translation.autoTitle')}</Text>
                  <Surface variant="secondary" className="rounded-panel-inner px-3 py-2.5">
                    <Toggle
                      label={t('translation.autoTranslate')}
                      value={autoTranslate}
                      onValueChange={setAutoTranslate}
                      disabled={isSaving}
                    />
                  </Surface>
                  <Text className="text-xs leading-4" style={{ color: theme.textSecondary }}>{t('translation.autoTranslateHint')}</Text>

                  <Text className="mt-2 text-sm font-semibold" style={{ color: theme.text }}>{t('translation.targetLocale')}</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {localeOptions.map((option) => {
                      const isSelected = targetLocale === option.value;
                      return (
                        <HeroButton
                          key={option.value}
                          size="sm"
                          variant={isSelected ? 'primary' : 'secondary'}
                          onPress={() => setTargetLocale(option.value)}
                          isDisabled={isSaving || !autoTranslate}
                          accessibilityLabel={option.label}
                          style={isSelected ? { backgroundColor: primary } : undefined}
                        >
                          <HeroButton.Label>{option.label}</HeroButton.Label>
                        </HeroButton>
                      );
                    })}
                  </View>
                </HeroCard.Body>
              </HeroCard>

              <HeroButton variant="primary" onPress={handleSave} isDisabled={isSaving} style={{ backgroundColor: primary }}>
                <HeroButton.Label>{isSaving ? t('translation.saving') : t('translation.save')}</HeroButton.Label>
              </HeroButton>
            </>
          )}

          <SourceRepositoryLink />
        </ScrollView>
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}
