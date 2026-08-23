// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner, Surface, Text } from 'heroui-native';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';

import { setupFederation, type FederationSettings } from '@/lib/api/federation';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import Toggle from '@/components/ui/Toggle';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import AccentIcon from '@/components/ui/AccentIcon';

type Step = 0 | 1 | 2 | 3;

const defaultSettings: FederationSettings = {
  federation_optin: true,
  profile_visible_federated: true,
  appear_in_federated_search: true,
  show_skills_federated: true,
  show_location_federated: true,
  show_reviews_federated: true,
  messaging_enabled_federated: true,
  transactions_enabled_federated: true,
  email_notifications: true,
  service_reach: 'local_only',
  travel_radius_km: 25,
};

const privacyKeys: (keyof FederationSettings)[] = [
  'profile_visible_federated',
  'appear_in_federated_search',
  'show_skills_federated',
  'show_location_federated',
  'show_reviews_federated',
];

const communicationKeys: (keyof FederationSettings)[] = [
  'messaging_enabled_federated',
  'transactions_enabled_federated',
  'email_notifications',
];

export default function FederationOnboardingRoute() {
  return (
    <ModalErrorBoundary>
      <FederationOnboardingScreen />
    </ModalErrorBoundary>
  );
}

function FederationOnboardingScreen() {
  const { t } = useTranslation(['federation', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const [step, setStep] = useState<Step>(0);
  const [settings, setSettings] = useState<FederationSettings>(defaultSettings);
  const [isSaving, setIsSaving] = useState(false);

  function updateSetting(key: keyof FederationSettings, value: boolean | FederationSettings['service_reach']) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  async function finish() {
    setIsSaving(true);
    try {
      await setupFederation(settings);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(modals)/federation');
    } catch {
      showToast({ title: t('directory.onboarding.failedTitle'), description: t('directory.onboarding.failedDescription'), variant: 'danger' });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('directory.onboarding.title')} backLabel={t('common:back')} fallbackHref="/(modals)/federation" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <HeroCard className="mb-4 overflow-hidden rounded-panel p-0">
          <View className="h-1.5" style={{ backgroundColor: primary }} />
          <HeroCard.Body className="gap-4 p-4">
            <View className="flex-row items-start gap-3">
              <View className="size-14 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                <Ionicons name="git-network-outline" size={27} color={primary} />
              </View>
              <View className="min-w-0 flex-1 gap-1">
                <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('directory.onboarding.eyebrow')}</Text>
                <Text className="text-2xl font-bold" style={{ color: theme.text }}>{t('directory.onboarding.title')}</Text>
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('directory.onboarding.subtitle')}</Text>
              </View>
            </View>
            <View className="flex-row gap-2">
              {[0, 1, 2, 3].map((index) => (
                <View key={index} className="h-2 flex-1 rounded-full" style={{ backgroundColor: index <= step ? primary : theme.border }} />
              ))}
            </View>
          </HeroCard.Body>
        </HeroCard>

        {step === 0 ? (
          <View className="gap-3">
            {['discover', 'message', 'exchange'].map((item) => (
              <Surface key={item} variant="secondary" className="flex-row items-center gap-3 rounded-panel p-4">
                <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                  <Ionicons name={item === 'discover' ? 'search-outline' : item === 'message' ? 'chatbubble-ellipses-outline' : 'swap-horizontal-outline'} size={20} color={primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-base font-bold" style={{ color: theme.text }}>{t(`directory.onboarding.benefits.${item}.title`)}</Text>
                  <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t(`directory.onboarding.benefits.${item}.description`)}</Text>
                </View>
              </Surface>
            ))}
          </View>
        ) : null}

        {step === 1 ? (
          <SettingsList keys={privacyKeys} settings={settings} theme={theme} t={t} onChange={updateSetting} prefix="privacy" />
        ) : null}

        {step === 2 ? (
          <View className="gap-4">
            <SettingsList keys={communicationKeys} settings={settings} theme={theme} t={t} onChange={updateSetting} prefix="communication" />
            <View className="gap-2">
              <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('directory.onboarding.reach')}</Text>
              <View className="flex-row flex-wrap gap-2">
                {(['local_only', 'remote_ok', 'travel_ok'] as const).map((reach) => (
                  <HeroButton key={reach} variant={settings.service_reach === reach ? 'primary' : 'secondary'} onPress={() => updateSetting('service_reach', reach)}>
                    <HeroButton.Label>{t(`directory.settings.reach.${reach}`)}</HeroButton.Label>
                  </HeroButton>
                ))}
              </View>
            </View>
            <Chip size="sm" variant="secondary" color="success">
              <Ionicons name="shield-checkmark-outline" size={13} color={theme.success} />
              <Chip.Label>{t('directory.onboarding.ready')}</Chip.Label>
            </Chip>
          </View>
        ) : null}

        {step === 3 ? (
          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-4 p-4">
              <View className="flex-row items-start gap-3">
                <View className="size-12 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(theme.success, 0.14) }}>
                  <Ionicons name="checkmark-circle-outline" size={25} color={theme.success} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-lg font-bold" style={{ color: theme.text }}>{t('directory.onboarding.review')}</Text>
                  <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }}>{t('directory.onboarding.reviewDescription')}</Text>
                </View>
              </View>

              <SummarySection
                title={t('directory.onboarding.privacy')}
                rows={privacyKeys.map((key) => ({
                  label: t(`directory.settings.${key}.label`),
                  enabled: settings[key] === true,
                }))}
                theme={theme}
                t={t}
              />
              <SummarySection
                title={t('directory.onboarding.communication')}
                rows={communicationKeys.map((key) => ({
                  label: t(`directory.settings.${key}.label`),
                  enabled: settings[key] === true,
                }))}
                theme={theme}
                t={t}
              />
              <Surface variant="secondary" className="rounded-panel-inner p-3">
                <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('directory.onboarding.reach')}</Text>
                <Text className="mt-1 text-sm font-semibold" style={{ color: theme.text }}>
                  {t(`directory.settings.reach.${settings.service_reach ?? 'local_only'}`)}
                </Text>
              </Surface>
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        <View className="mt-5 flex-row gap-3">
          <HeroButton className="flex-1" variant="secondary" onPress={() => setStep((value) => Math.max(0, value - 1) as Step)} isDisabled={step === 0 || isSaving}>
            <Ionicons name="arrow-back-outline" size={16} color={primary} />
            <HeroButton.Label>{t('common:back')}</HeroButton.Label>
          </HeroButton>
          <HeroButton className="flex-1" variant="primary" onPress={step === 3 ? finish : () => setStep((value) => Math.min(3, value + 1) as Step)} isDisabled={isSaving}>
            {isSaving ? <Spinner size="sm" /> : <AccentIcon name={step === 3 ? 'checkmark-outline' : 'arrow-forward-outline'} size={16} />}
            <HeroButton.Label>{step === 3 ? t('directory.onboarding.finish') : t('directory.onboarding.next')}</HeroButton.Label>
          </HeroButton>
        </View>
        <HeroButton className="mt-3" variant="ghost" onPress={() => router.replace('/(modals)/federation')} isDisabled={isSaving}>
          <HeroButton.Label>{t('directory.onboarding.doLater')}</HeroButton.Label>
        </HeroButton>
      </ScrollView>
    </SafeAreaView>
  );
}

function SummarySection({
  title,
  rows,
  theme,
  t,
}: {
  title: string;
  rows: { label: string; enabled: boolean }[];
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <Surface variant="secondary" className="gap-2 rounded-panel-inner p-3">
      <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{title}</Text>
      <View className="flex-row flex-wrap gap-2">
        {rows.map((row) => (
          <Chip key={row.label} size="sm" variant="secondary" color={row.enabled ? 'success' : undefined}>
            <Chip.Label>{row.label}: {row.enabled ? t('directory.onboarding.on') : t('directory.onboarding.off')}</Chip.Label>
          </Chip>
        ))}
      </View>
    </Surface>
  );
}

function SettingsList({
  keys,
  settings,
  theme,
  t,
  onChange,
  prefix,
}: {
  keys: (keyof FederationSettings)[];
  settings: FederationSettings;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onChange: (key: keyof FederationSettings, value: boolean) => void;
  prefix: 'privacy' | 'communication';
}) {
  return (
    <HeroCard className="rounded-panel p-0">
      <HeroCard.Body className="gap-1 p-4">
        <Text className="mb-2 text-lg font-bold" style={{ color: theme.text }}>{t(`directory.onboarding.${prefix}`)}</Text>
        {keys.map((key) => (
          <Surface key={key} variant="transparent" className="flex-row items-center justify-between gap-3 rounded-panel-inner p-3">
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-semibold" style={{ color: theme.text }}>{t(`directory.settings.${key}.label`)}</Text>
              <Text className="text-xs leading-4" style={{ color: theme.textSecondary }}>{t(`directory.settings.${key}.description`)}</Text>
            </View>
            <Toggle value={settings[key] === true} onValueChange={(value) => onChange(key, value)} />
          </Surface>
        ))}
      </HeroCard.Body>
    </HeroCard>
  );
}
