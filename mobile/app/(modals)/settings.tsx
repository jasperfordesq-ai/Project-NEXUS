// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import ErrorState from '@/components/ui/ErrorState';
import { Children, Fragment, useEffect, useState } from 'react';
import {
  View,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import * as Haptics from '@/lib/haptics';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { Button as HeroButton, Card as HeroCard, ListGroup, Text } from 'heroui-native';
import { Chip } from '@/components/ui/StatusChip';

import { api } from '@/lib/api/client';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme, useThemeController } from '@/lib/hooks/useTheme';
import type { ThemeMode } from '@/lib/theme/themeStore';
import { API_V2, IDENTITY_VERIFICATION_AVAILABLE_IN_APP } from '@/lib/constants';
import { withAlpha } from '@/lib/utils/color';
import { describeApiError } from '@/lib/api/describeApiError';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import Toggle from '@/components/ui/Toggle';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import SourceRepositoryLink from '@/components/SourceRepositoryLink';
import {
  biometricCapability,
  isBiometricLockEnabled,
  setBiometricLockEnabled,
} from '@/lib/biometricLock';
import {
  isPushPermissionGranted,
  registerForPushNotifications,
  unregisterPushNotifications,
} from '@/lib/notifications';

interface NotificationPrefs {
  email_messages: boolean;
  email_connections: boolean;
  email_transactions: boolean;
  email_reviews: boolean;
  push_enabled: boolean;
  push_campaigns_opted_in: boolean;
}

type PrivacyVisibility = 'public' | 'members' | 'connections';

interface PrivacyPrefs {
  privacy_profile: PrivacyVisibility;
  privacy_search: boolean;
}

interface PreferencesResponse {
  privacy: PrivacyPrefs;
}

function getPrefs(): Promise<{ data: NotificationPrefs }> {
  return api.get<{ data: NotificationPrefs }>(`${API_V2}/users/me/notifications`);
}

function savePrefs(prefs: Partial<NotificationPrefs>): Promise<void> {
  return api.put<void>(`${API_V2}/users/me/notifications`, prefs);
}

function getPreferences(): Promise<{ data: PreferencesResponse }> {
  return api.get<{ data: PreferencesResponse }>(`${API_V2}/users/me/preferences`);
}

function savePrivacyPrefs(prefs: PrivacyPrefs): Promise<void> {
  return api.put<void>(`${API_V2}/users/me/preferences`, { privacy: prefs });
}

export default function SettingsScreen() {
  const { t } = useTranslation(['settings', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { mode: themeMode, setMode: setThemeMode } = useThemeController();

  function selectThemeMode(nextMode: ThemeMode) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setThemeMode(nextMode);
  }

  /*
    Journey 1.6 — unlocking the app with a fingerprint. Kept entirely on the device: the
    switch is only offered when the phone has biometrics enrolled, and turning it ON has
    to pass the check first, so nobody can enable a lock they cannot then satisfy.
  */
  const [biometricUsable, setBiometricUsable] = useState(false);
  const [biometricLockOn, setBiometricLockOn] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [capability, enabled] = await Promise.all([
        biometricCapability(),
        isBiometricLockEnabled(),
      ]);
      if (cancelled) return;
      setBiometricUsable(capability.usable);
      setBiometricLockOn(enabled);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleBiometricLock() {
    const next = !biometricLockOn;
    setBiometricBusy(true);
    try {
      const result = await setBiometricLockEnabled(next, t('biometricLock.prompt'));
      if (!result.ok) {
        // Say which of the phone's answers it was, rather than a generic failure.
        showToast({
          title: t(`biometricLock.errors.${result.reason ?? 'failed'}`),
          variant: result.reason === 'cancelled' ? 'warning' : 'danger',
        });
        return;
      }
      setBiometricLockOn(next);
    } finally {
      setBiometricBusy(false);
    }
  }

  const { data, isLoading, error: prefsError, refresh: refreshPrefs } = useApi(() => getPrefs());
  const { data: preferencesData, isLoading: isLoadingPreferences, error: preferencesError, refresh: refreshPreferences } = useApi(() => getPreferences());
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [privacyPrefs, setPrivacyPrefs] = useState<PrivacyPrefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [devicePushEnabled, setDevicePushEnabled] = useState(false);
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const constants = Constants as typeof Constants & { default?: typeof Constants };
  const appVersion = Constants.expoConfig?.version ?? constants.default?.expoConfig?.version ?? t('unknownVersion');

  // Use server data as initial state once loaded
  const current = prefs ?? data?.data ?? null;
  const currentPrivacy = privacyPrefs ?? preferencesData?.data?.privacy ?? null;

  useEffect(() => {
    let cancelled = false;
    void isPushPermissionGranted().then((granted) => {
      if (!cancelled) setDevicePushEnabled(granted);
    });
    return () => { cancelled = true; };
  }, []);

  async function toggle(key: keyof NotificationPrefs) {
    if (!current) return;
    // Haptic feedback is handled by the Toggle component
    const updated = { ...current, [key]: !current[key] };
    setPrefs(updated);
    setSaving(true);
    try {
      await savePrefs({ [key]: updated[key] });
    } catch (err) {
      // Revert
      setPrefs(current);
      showToast({ title: t('common:errors.generic'), description: describeApiError(err, t('saveError')), variant: 'danger' });
    } finally {
      setSaving(false);
    }
  }

  async function toggleDevicePush() {
    if (!current) return;
    const currentlyEnabled = current.push_enabled && devicePushEnabled;
    setSaving(true);
    try {
      if (currentlyEnabled) {
        await savePrefs({ push_enabled: false });
        await unregisterPushNotifications();
        setPrefs({ ...current, push_enabled: false });
        setDevicePushEnabled(false);
        return;
      }

      const result = await registerForPushNotifications(true);
      if (result !== 'registered') {
        /*
          🔴 S3-26: every non-registered outcome was reported as "permission needed", which
          is wrong on a simulator or after a network failure, and sent the member to a system
          setting that was never the problem.
        */
        const failed = result === 'failed';
        const unavailable = result === 'unavailable';
        showToast({
          title: failed ? t('push.registerFailed') : unavailable ? t('push.unavailable') : t('push.permissionNeeded'),
          description: failed ? t('push.registerFailedHint') : unavailable ? t('push.unavailableHint') : t('push.permissionNeededHint'),
          variant: failed ? 'danger' : 'warning',
        });
        return;
      }
      await savePrefs({ push_enabled: true });
      setPrefs({ ...current, push_enabled: true });
      setDevicePushEnabled(true);
    } catch (err) {
      showToast({ title: t('common:errors.generic'), description: describeApiError(err, t('saveError')), variant: 'danger' });
    } finally {
      setSaving(false);
    }
  }

  async function updatePrivacy(nextPrefs: PrivacyPrefs) {
    if (!currentPrivacy) return;
    setPrivacyPrefs(nextPrefs);
    setSavingPrivacy(true);
    try {
      await savePrivacyPrefs(nextPrefs);
    } catch (err) {
      setPrivacyPrefs(currentPrivacy);
      showToast({ title: t('common:errors.generic'), description: describeApiError(err, t('privacy.saveError')), variant: 'danger' });
    } finally {
      setSavingPrivacy(false);
    }
  }

  function cycleVisibility() {
    if (!currentPrivacy) return;
    const nextVisibility: PrivacyVisibility =
      currentPrivacy.privacy_profile === 'members'
        ? 'connections'
        : currentPrivacy.privacy_profile === 'connections'
          ? 'public'
          : 'members';
    void updatePrivacy({ ...currentPrivacy, privacy_profile: nextVisibility });
  }

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('title')} backLabel={t('common:buttons.back')} fallbackHref="/(tabs)/profile" />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}>
          <HeroCard className="overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: theme.borderSubtle }}>
            <View className="h-1.5" style={{ backgroundColor: primary }} />
            <HeroCard.Body className="gap-3 p-4">
              <View className="flex-row items-start gap-3">
                <View
                  className="h-12 w-12 items-center justify-center rounded-3xl"
                  style={{ backgroundColor: withAlpha(primary, 0.14), borderWidth: 1, borderColor: withAlpha(primary, 0.2) }}
                >
                  <Ionicons name="settings-outline" size={23} color={primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>{t('eyebrow')}</Text>
                  <Text className="text-xl font-bold leading-7" style={{ color: theme.text }} numberOfLines={1}>{t('title')}</Text>
                  <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>{t('subtitle')}</Text>
                </View>
              </View>
              <View className="flex-row flex-wrap gap-2">
                <Chip size="sm" variant="soft" color="accent">
                  <Ionicons name="person-outline" size={12} color={primary} />
                  <Chip.Label>{t('account')}</Chip.Label>
                </Chip>
                <Chip size="sm" variant="soft" color="default">
                  <Ionicons name="notifications-outline" size={12} color={theme.textMuted} />
                  <Chip.Label>{t('notifications')}</Chip.Label>
                </Chip>
                <Chip size="sm" variant="soft" color="default">
                  <Ionicons name="shield-checkmark-outline" size={12} color={theme.textMuted} />
                  <Chip.Label>{t('security')}</Chip.Label>
                </Chip>
              </View>
            </HeroCard.Body>
          </HeroCard>

          <Section
            title={t('account')}
            subtitle={t('accountHint')}
            icon="person-circle-outline"
            primary={primary}
            theme={theme}
          >
            <ActionRow
              label={t('editProfile')}
              subtitle={t('editProfileHint')}
              icon="create-outline"
              tone={primary}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/(modals)/edit-profile' as Href);
              }}
              theme={theme}
            />
            <ActionRow
              label={t('linkedAccounts.title')}
              subtitle={t('linkedAccounts.settingsHint')}
              icon="people-circle-outline"
              tone={primary}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/(modals)/settings-linked-accounts' as Href);
              }}
              theme={theme}
            />
            {/*
              🔴 Absent, not disabled, while identity verification is off for Play's payments
              policy — see IDENTITY_VERIFICATION_AVAILABLE_IN_APP. A row that opens a screen
              saying "you cannot do this here" is worse than no row: it advertises a paid
              feature the app is not allowed to sell.
            */}
            {IDENTITY_VERIFICATION_AVAILABLE_IN_APP ? (
              <ActionRow
                label={t('identity.page_title')}
                subtitle={t('identity.hint')}
                icon="finger-print-outline"
                tone={theme.success}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push('/(modals)/verify-identity' as Href);
                }}
                theme={theme}
              />
            ) : null}
            <ActionRow
              label={t('changePassword')}
              subtitle={t('changePasswordHint')}
              icon="key-outline"
              tone={theme.warning}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/(modals)/change-password');
              }}
              theme={theme}
            />
            {/*
              🔴 Owner-reported parity gap, 2026-08-25: the web app's settings page has had
              account deletion since before this app existed, and this app had nothing — no
              row, no screen, no API call. It is also a hard Google Play requirement that an
              app which lets people create an account lets them delete it in the app, not
              only on a website. Last in the section, and destructive-toned, because a
              mis-tap here costs nothing: the next screen needs the keyword AND the
              password before anything is sent.
            */}
            <ActionRow
              label={t('deleteAccount.title')}
              subtitle={t('deleteAccount.settingsHint')}
              icon="trash-outline"
              tone={theme.error}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/(modals)/settings-delete-account' as Href);
              }}
              theme={theme}
            />
          </Section>

          <Section
            title={t('appearance.title')}
            subtitle={t('appearance.hint')}
            icon="contrast-outline"
            primary={primary}
            theme={theme}
          >
            <ThemeModeRow
              label={t('appearance.mode.system')}
              subtitle={t('appearance.mode.systemHint')}
              icon="phone-portrait-outline"
              selected={themeMode === 'system'}
              primary={primary}
              onPress={() => selectThemeMode('system')}
            />
            <ThemeModeRow
              label={t('appearance.mode.light')}
              subtitle={t('appearance.mode.lightHint')}
              icon="sunny-outline"
              selected={themeMode === 'light'}
              primary={primary}
              onPress={() => selectThemeMode('light')}
            />
            <ThemeModeRow
              label={t('appearance.mode.dark')}
              subtitle={t('appearance.mode.darkHint')}
              icon="moon-outline"
              selected={themeMode === 'dark'}
              primary={primary}
              onPress={() => selectThemeMode('dark')}
            />
          </Section>

          <Section
            title={t('privacy.title')}
            subtitle={t('privacy.hint')}
            icon="lock-closed-outline"
            primary={primary}
            theme={theme}
          >
            {preferencesError ? (
              <ErrorState subtitle={preferencesError} onRetry={refreshPreferences} isRetrying={isLoadingPreferences} testID="settings-privacy-error" />
            ) : null}
            <PrivacyVisibilityRow
              label={t('privacy.profileVisibility')}
              value={currentPrivacy?.privacy_profile ?? 'members'}
              disabled={isLoadingPreferences || savingPrivacy || !currentPrivacy}
              onPress={cycleVisibility}
              theme={theme}
              t={t}
            />
            <SettingRow
              label={t('privacy.searchIndexing')}
              value={currentPrivacy?.privacy_search ?? true}
              onToggle={() => {
                if (!currentPrivacy) return;
                void updatePrivacy({ ...currentPrivacy, privacy_search: !currentPrivacy.privacy_search });
              }}
              disabled={isLoadingPreferences || savingPrivacy || !currentPrivacy}
            />
            {/*
              Absent, not disabled, when the phone has nothing enrolled: a switch that
              cannot be turned on is a worse answer than no switch at all.
            */}
            {biometricUsable ? (
              <SettingRow
                label={t('biometricLock.title')}
                value={biometricLockOn}
                onToggle={() => void toggleBiometricLock()}
                disabled={biometricBusy}
              />
            ) : null}
            <ActionRow
              label={t('blockedUsers.title')}
              subtitle={t('blockedUsers.settingsHint')}
              icon="shield-outline"
              tone={theme.error}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/(modals)/settings-blocked-users' as Href);
              }}
              theme={theme}
            />
            <ActionRow
              label={t('dataExport.title')}
              subtitle={t('dataExport.settingsHint')}
              icon="download-outline"
              tone={primary}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/(modals)/settings-data-export' as Href);
              }}
              theme={theme}
            />
          </Section>

          <Section
            title={t('translation.preferencesTitle')}
            subtitle={t('translation.preferencesHint')}
            icon="language-outline"
            primary={primary}
            theme={theme}
          >
            <ActionRow
              label={t('translation.title')}
              subtitle={t('translation.settingsHint')}
              icon="sparkles-outline"
              tone={primary}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/(modals)/settings-translation' as Href);
              }}
              theme={theme}
            />
          </Section>

          <Section
            title={t('pushNotifications')}
            subtitle={t('pushHint')}
            icon="notifications-outline"
            primary={primary}
            theme={theme}
          >
            {/*
              🔴 S3-04: when the preferences request failed, `current` stayed null, every
              switch rendered at its default and `toggle()` returned silently — the member
              flipped switches that did nothing and was never told why.
            */}
            {prefsError ? (
              <ErrorState subtitle={prefsError} onRetry={refreshPrefs} isRetrying={isLoading} testID="settings-push-error" />
            ) : null}
            <SettingRow
              label={t('push.device')}
              value={Boolean(current?.push_enabled && devicePushEnabled)}
              onToggle={() => void toggleDevicePush()}
              disabled={isLoading || saving}
            />
            <SettingRow
              label={t('push.promotions')}
              value={current?.push_campaigns_opted_in ?? false}
              onToggle={() => void toggle('push_campaigns_opted_in')}
              disabled={isLoading || saving}
            />
          </Section>

          <Section
            title={t('emailNotifications')}
            subtitle={t('emailHint')}
            icon="mail-outline"
            primary={primary}
            theme={theme}
          >
            {prefsError ? (
              <ErrorState subtitle={prefsError} onRetry={refreshPrefs} isRetrying={isLoading} testID="settings-email-error" />
            ) : null}
            <SettingRow
              label={t('email.messages')}
              value={current?.email_messages ?? true}
              onToggle={() => void toggle('email_messages')}
              disabled={isLoading || saving}
            />
            <SettingRow
              label={t('email.connections')}
              value={current?.email_connections ?? true}
              onToggle={() => void toggle('email_connections')}
              disabled={isLoading || saving}
            />
            <SettingRow
              label={t('email.transactions')}
              value={current?.email_transactions ?? true}
              onToggle={() => void toggle('email_transactions')}
              disabled={isLoading || saving}
            />
            <SettingRow
              label={t('email.reviews')}
              value={current?.email_reviews ?? true}
              onToggle={() => void toggle('email_reviews')}
              disabled={isLoading || saving}
            />
          </Section>

          <Section
            title={t('about')}
            subtitle={t('aboutHint')}
            icon="information-circle-outline"
            primary={primary}
            theme={theme}
          >
            <InfoRow label={t('version')} value={appVersion} theme={theme} />
            <InfoRow label={t('license')} value="AGPL-3.0-or-later" theme={theme} />
          </Section>

          <SourceRepositoryLink />
        </ScrollView>
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function Section({
  title,
  subtitle,
  icon,
  primary,
  children,
}: {
  title: string;
  subtitle: string;
  icon: IoniconName;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  children: React.ReactNode;
}) {
  // Grouped settings card built on HeroUI Native's ListGroup. A branded
  // (per-tenant accent) header sits above the group; each child row is a
  // ListGroup.Item, separated by hairline dividers.
  const items = Children.toArray(children);
  return (
    <View className="gap-2.5">
      <View className="flex-row items-center gap-3 px-1">
        <View
          className="h-9 w-9 items-center justify-center rounded-2xl"
          style={{ backgroundColor: withAlpha(primary, 0.12), borderWidth: 1, borderColor: withAlpha(primary, 0.16) }}
        >
          <Ionicons name={icon} size={18} color={primary} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-base font-bold text-foreground" numberOfLines={1}>{title}</Text>
          <Text className="text-xs leading-4 text-muted-foreground" numberOfLines={2}>{subtitle}</Text>
        </View>
      </View>
      <ListGroup className="overflow-hidden rounded-panel border border-border">
        {items.map((child, index) => (
          <Fragment key={index}>
            {index > 0 ? <View className="h-px bg-border" /> : null}
            {child}
          </Fragment>
        ))}
      </ListGroup>
    </View>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <ListGroup.Item>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle numberOfLines={1}>{label}</ListGroup.ItemTitle>
      </ListGroup.ItemContent>
      <ListGroup.ItemSuffix>
        <Text className="shrink text-right text-sm text-muted-foreground" numberOfLines={1}>{value}</Text>
      </ListGroup.ItemSuffix>
    </ListGroup.Item>
  );
}

function ActionRow({
  label,
  subtitle,
  icon,
  tone,
  onPress,
}: {
  label: string;
  subtitle?: string;
  icon: IoniconName;
  tone: string;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <ListGroup.Item
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="active:opacity-60"
    >
      <ListGroup.ItemPrefix>
        <View className="h-9 w-9 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(tone, 0.12) }}>
          <Ionicons name={icon} size={18} color={tone} />
        </View>
      </ListGroup.ItemPrefix>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle numberOfLines={1}>{label}</ListGroup.ItemTitle>
        {subtitle ? <ListGroup.ItemDescription numberOfLines={2}>{subtitle}</ListGroup.ItemDescription> : null}
      </ListGroup.ItemContent>
      <ListGroup.ItemSuffix />
    </ListGroup.Item>
  );
}

function ThemeModeRow({
  label,
  subtitle,
  icon,
  selected,
  primary,
  onPress,
}: {
  label: string;
  subtitle: string;
  icon: IoniconName;
  selected: boolean;
  primary: string;
  onPress: () => void;
}) {
  return (
    <ListGroup.Item
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      className="active:opacity-60"
    >
      <ListGroup.ItemPrefix>
        <View
          className="h-9 w-9 items-center justify-center rounded-2xl"
          style={{ backgroundColor: withAlpha(primary, selected ? 0.18 : 0.1) }}
        >
          <Ionicons name={icon} size={18} color={primary} />
        </View>
      </ListGroup.ItemPrefix>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle numberOfLines={1}>{label}</ListGroup.ItemTitle>
        <ListGroup.ItemDescription numberOfLines={1}>{subtitle}</ListGroup.ItemDescription>
      </ListGroup.ItemContent>
      <ListGroup.ItemSuffix>
        {selected ? (
          <Ionicons name="checkmark-circle" size={22} color={primary} />
        ) : (
          <View className="h-[22px] w-[22px] rounded-full border-2 border-border" />
        )}
      </ListGroup.ItemSuffix>
    </ListGroup.Item>
  );
}

function PrivacyVisibilityRow({
  label,
  value,
  disabled,
  onPress,
  t,
}: {
  label: string;
  value: PrivacyVisibility;
  disabled: boolean;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const valueLabel = t(`privacy.visibility.${value}`);
  return (
    <ListGroup.Item>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle numberOfLines={1}>{label}</ListGroup.ItemTitle>
        <ListGroup.ItemDescription numberOfLines={1}>{valueLabel}</ListGroup.ItemDescription>
      </ListGroup.ItemContent>
      <ListGroup.ItemSuffix>
        <HeroButton size="sm" variant="secondary" onPress={onPress} isDisabled={disabled}>
          <HeroButton.Label>{t('privacy.changeVisibility')}</HeroButton.Label>
        </HeroButton>
      </ListGroup.ItemSuffix>
    </ListGroup.Item>
  );
}

function SettingRow({
  label,
  value,
  onToggle,
  disabled,
}: {
  label: string;
  value: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  // The row itself is not pressable — the Switch owns the interaction (and its
  // own disabled state), so we avoid a nested-Pressable touch conflict.
  return (
    <ListGroup.Item>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle numberOfLines={2}>{label}</ListGroup.ItemTitle>
      </ListGroup.ItemContent>
      <ListGroup.ItemSuffix>
        <Toggle
          value={value}
          onValueChange={onToggle}
          disabled={disabled}
          accessibilityLabel={label}
        />
      </ListGroup.ItemSuffix>
    </ListGroup.Item>
  );
}
