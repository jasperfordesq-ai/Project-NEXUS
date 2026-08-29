// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Image,
  Linking,
  ScrollView,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Card as HeroCard } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import Button from '@/components/ui/Button';
import Checkbox from '@/components/ui/Checkbox';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import NativePressable from '@/components/ui/NativePressable';
import TextArea from '@/components/ui/TextArea';
import { useAppToast } from '@/components/ui/AppToast';
import { getMe, type User } from '@/lib/api/auth';
import { describeApiError } from '@/lib/api/describeApiError';
import {
  completeOnboarding,
  getOnboardingCategories,
  getOnboardingConfig,
  getOnboardingStatus,
  getSafeguardingOptions,
  saveSafeguardingPreferences,
  type OnboardingCategory,
  type OnboardingConfiguration,
  type OnboardingStep,
  type OnboardingStepSlug,
  type SafeguardingOption,
} from '@/lib/api/onboarding';
import { updateAvatar, updateProfile } from '@/lib/api/profile';
import { STORAGE_KEYS } from '@/lib/constants';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { storage } from '@/lib/storage';

const DEFAULT_STEPS: OnboardingStep[] = [
  { slug: 'welcome', label_code: 'welcome', required: false },
  { slug: 'profile', label_code: 'profile', required: true },
  { slug: 'interests', label_code: 'interests', required: false },
  { slug: 'skills', label_code: 'skills', required: false },
  { slug: 'safeguarding', label_code: 'safeguarding', required: false },
  { slug: 'confirm', label_code: 'confirm', required: false },
];

const KNOWN_STEPS = new Set<OnboardingStepSlug>(DEFAULT_STEPS.map((step) => step.slug));

function toggleId(values: number[], id: number): number[] {
  return values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
}

function parseSelectOptions(raw?: string | null): { value: string; label: string }[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((option): option is { value: string; label: string } => (
      typeof option === 'object' && option !== null &&
      typeof (option as { value?: unknown }).value === 'string' &&
      typeof (option as { label?: unknown }).label === 'string'
    ));
  } catch {
    return [];
  }
}

function OnboardingScreenInner() {
  const { t } = useTranslation(['onboarding', 'common']);
  const translateRef = useRef(t);
  translateRef.current = t;
  const { user, refreshUser } = useAuth();
  const { tenant } = useTenant();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const mountedRef = useRef(true);

  const [configuration, setConfiguration] = useState<OnboardingConfiguration | null>(null);
  const [categories, setCategories] = useState<OnboardingCategory[]>([]);
  const [safeguardingOptions, setSafeguardingOptions] = useState<SafeguardingOption[]>([]);
  const [profile, setProfile] = useState<Partial<User>>(user as Partial<User>);
  const [bio, setBio] = useState((user as Partial<User> | null)?.bio ?? '');
  const [interests, setInterests] = useState<number[]>([]);
  const [offers, setOffers] = useState<number[]>([]);
  const [needs, setNeeds] = useState<number[]>([]);
  const [safeguardingSelections, setSafeguardingSelections] = useState<Record<number, boolean>>({});
  const [safeguardingSelectValues, setSafeguardingSelectValues] = useState<Record<number, string>>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const steps = useMemo(() => {
    const configured = (configuration?.steps ?? []).filter((step) => KNOWN_STEPS.has(step.slug));
    return configured.length > 0 ? configured : DEFAULT_STEPS;
  }, [configuration?.steps]);
  const currentStep = steps[Math.min(stepIndex, Math.max(steps.length - 1, 0))];
  const minBioLength = Number(configuration?.config.bio_min_length ?? 10);
  const tenantName = tenant?.name ?? t('community_fallback');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [configResult, status, categoriesResult, fullProfile] = await Promise.all([
        getOnboardingConfig(),
        getOnboardingStatus(),
        getOnboardingCategories(),
        getMe(),
      ]);
      const hasSafeguardingStep = configResult.steps.some((step) => step.slug === 'safeguarding');
      const options = hasSafeguardingStep ? await getSafeguardingOptions() : [];
      if (!mountedRef.current) return;

      if (status.onboarding_completed) {
        const completedUser = { ...fullProfile.data, onboarding_completed: true };
        refreshUser(completedUser);
        await storage.setJson(STORAGE_KEYS.USER_DATA, completedUser);
        router.replace('/(tabs)/home');
        return;
      }

      setConfiguration(configResult);
      setCategories(categoriesResult);
      setSafeguardingOptions(options);
      setProfile(fullProfile.data);
      setBio(fullProfile.data.bio ?? '');
      setInterests(status.interests.filter((item) => item.interest_type === 'interest').map((item) => item.category_id));
      setOffers(status.interests.filter((item) => item.interest_type === 'skill_offer').map((item) => item.category_id));
      setNeeds(status.interests.filter((item) => item.interest_type === 'skill_need').map((item) => item.category_id));
      setSafeguardingSelections(Object.fromEntries(options.map((option) => [option.id, false])));

      // Preserve the web journey for an older account that already supplied the
      // mandatory profile fields: do not make them repeat Welcome and Profile.
      const profileStepIndex = configResult.steps.findIndex((step) => step.slug === 'profile');
      const configuredMinimum = Number(configResult.config.bio_min_length ?? 10);
      if (
        profileStepIndex >= 0 &&
        fullProfile.data.avatar_url &&
        (fullProfile.data.bio?.trim().length ?? 0) >= configuredMinimum
      ) {
        setStepIndex(Math.min(profileStepIndex + 1, configResult.steps.length - 1));
      }
    } catch (error) {
      if (!mountedRef.current) return;
      setLoadError(describeApiError(error, translateRef.current('toast_something_went_wrong')));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [refreshUser]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!currentStep) return;
    AccessibilityInfo.announceForAccessibility(
      t('aria_step_progress', { step: stepIndex + 1, total: steps.length }),
    );
  }, [currentStep, stepIndex, steps.length, t]);

  const goNext = useCallback(() => {
    setStepIndex((value) => Math.min(value + 1, steps.length - 1));
  }, [steps.length]);

  const goBack = useCallback(() => {
    setStepIndex((value) => Math.max(value - 1, 0));
  }, []);

  const pickAvatar = useCallback(async () => {
    if (busy) return;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showToast({ title: t('toast_upload_failed'), description: t('profile:permissionMessage'), variant: 'warning' });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        allowsMultipleSelection: false,
      });
      const uri = result.canceled ? null : result.assets?.[0]?.uri;
      if (!uri) return;
      setBusy(true);
      const response = await updateAvatar(uri);
      if (!mountedRef.current) return;
      const nextProfile = { ...profile, avatar_url: response.data.avatar_url };
      setProfile(nextProfile);
      refreshUser(nextProfile as User);
      await storage.setJson(STORAGE_KEYS.USER_DATA, nextProfile);
      showToast({ title: t('toast_photo_uploaded'), description: t('toast_photo_uploaded_desc'), variant: 'success' });
    } catch (error) {
      showToast({ title: t('toast_upload_failed'), description: describeApiError(error, t('toast_upload_failed_desc')), variant: 'danger' });
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [busy, profile, refreshUser, showToast, t]);

  const saveProfile = useCallback(async () => {
    const avatarRequired = configuration?.config.avatar_required !== false;
    const bioRequired = configuration?.config.bio_required !== false;
    if (avatarRequired && !profile.avatar_url) {
      showToast({ title: t('toast_photo_required'), description: t('toast_photo_required_desc'), variant: 'danger' });
      return;
    }
    if (bioRequired && bio.trim().length < minBioLength) {
      showToast({
        title: t('toast_bio_required'),
        description: t('toast_bio_required_desc', { min: minBioLength }),
        variant: 'danger',
      });
      return;
    }
    setBusy(true);
    try {
      const response = await updateProfile({ bio: bio.trim() });
      if (!mountedRef.current) return;
      setProfile(response.data);
      refreshUser(response.data);
      await storage.setJson(STORAGE_KEYS.USER_DATA, response.data);
      goNext();
    } catch (error) {
      showToast({ title: t('toast_save_failed'), description: describeApiError(error, t('toast_save_failed_desc')), variant: 'danger' });
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [bio, configuration?.config.avatar_required, configuration?.config.bio_required, goNext, minBioLength, profile.avatar_url, refreshUser, showToast, t]);

  const toggleSafeguarding = useCallback((option: SafeguardingOption) => {
    setSafeguardingSelections((previous) => {
      if (option.option_key === 'none_apply') {
        const cleared = Object.fromEntries(safeguardingOptions.map((item) => [item.id, false]));
        cleared[option.id] = !previous[option.id];
        return cleared;
      }
      const noneApply = safeguardingOptions.find((item) => item.option_key === 'none_apply');
      return {
        ...previous,
        ...(noneApply ? { [noneApply.id]: false } : {}),
        [option.id]: !previous[option.id],
      };
    });
    if (option.option_key === 'none_apply') setSafeguardingSelectValues({});
  }, [safeguardingOptions]);

  const saveSafeguarding = useCallback(async () => {
    const unmet = safeguardingOptions.filter((option) => {
      if (!option.is_required) return false;
      return option.option_type === 'select'
        ? !safeguardingSelectValues[option.id]
        : option.option_type === 'checkbox' && !safeguardingSelections[option.id];
    });
    if (unmet.length > 0) {
      showToast({
        title: t('safeguarding.required'),
        description: t('safeguarding.required_respond', { items: unmet.map((option) => option.label).join(', ') }),
        variant: 'danger',
      });
      return;
    }

    const preferences = [
      ...safeguardingOptions
        .filter((option) => option.option_type === 'checkbox' && safeguardingSelections[option.id])
        .map((option) => ({ option_id: option.id, value: '1' })),
      ...safeguardingOptions
        .filter((option) => option.option_type === 'select' && safeguardingSelectValues[option.id])
        .map((option) => ({ option_id: option.id, value: safeguardingSelectValues[option.id] ?? '' })),
    ];
    if (preferences.length === 0) {
      goNext();
      return;
    }

    setBusy(true);
    try {
      await saveSafeguardingPreferences(preferences);
      if (!mountedRef.current) return;
      showToast({ title: t('safeguarding.confirmation.title'), description: t('safeguarding.confirmation.who_can_see_body'), variant: 'success' });
      goNext();
    } catch (error) {
      showToast({ title: t('safeguarding.save_failed'), description: describeApiError(error, t('safeguarding.try_again')), variant: 'danger' });
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [goNext, safeguardingOptions, safeguardingSelections, safeguardingSelectValues, showToast, t]);

  const finish = useCallback(async () => {
    setBusy(true);
    try {
      const result = await completeOnboarding({ interests, offers, needs });
      const response = await getMe();
      if (!mountedRef.current) return;
      const completedUser = { ...response.data, onboarding_completed: true };
      refreshUser(completedUser);
      await storage.setJson(STORAGE_KEYS.USER_DATA, completedUser);
      showToast({
        title: t('toast_welcome_aboard'),
        description: result.listings_created > 0
          ? t('toast_listings_created', { count: result.listings_created })
          : t('toast_profile_all_set'),
        variant: 'success',
      });
      router.replace('/(tabs)/home');
    } catch (error) {
      showToast({ title: t('toast_setup_failed'), description: describeApiError(error, t('toast_something_went_wrong')), variant: 'danger' });
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [interests, needs, offers, refreshUser, showToast, t]);

  if (loading) return <LoadingSpinner fullScreen />;
  if (loadError) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Text accessibilityRole="alert" className="text-center text-base text-danger">{loadError}</Text>
        <Button onPress={() => void load()}>{t('common:buttons.retry')}</Button>
      </View>
    );
  }
  if (!currentStep) return null;

  const progressLabel = t('aria_step_progress', { step: stepIndex + 1, total: steps.length });

  return (
    <View className="flex-1 bg-background" style={{ backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <View className="mb-5 gap-2">
          <Text accessibilityRole="header" className="text-center text-2xl font-bold text-foreground">{t('page_title')}</Text>
          <Text className="text-center text-sm text-muted-foreground">{t('subtitle')}</Text>
          <Text accessibilityLiveRegion="polite" className="text-center text-sm font-semibold" style={{ color: primary }}>
            {progressLabel} · {t(`step_${currentStep.slug}`)}
          </Text>
          <View accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: steps.length, now: stepIndex + 1 }} className="h-2 overflow-hidden rounded-full bg-default-100">
            <View className="h-full rounded-full" style={{ backgroundColor: primary, width: `${((stepIndex + 1) / steps.length) * 100}%` }} />
          </View>
        </View>

        {currentStep.slug === 'welcome' ? (
          <HeroCard className="rounded-panel">
            <HeroCard.Body className="gap-4 p-5">
              <Text accessibilityRole="header" className="text-xl font-bold text-foreground">{t('welcome_title', { name: tenantName })}</Text>
              <Text className="text-base leading-6 text-muted-foreground">{configuration?.config.welcome_text || t('welcome_description')}</Text>
              {[['benefit_earn_title', 'benefit_earn_desc'], ['benefit_community_title', 'benefit_community_desc'], ['benefit_skills_title', 'benefit_skills_desc']].map(([title, description]) => (
                <View key={title} className="gap-1 rounded-panel-inner bg-default-50 p-3">
                  <Text className="font-semibold text-foreground">{t(title)}</Text>
                  <Text className="text-sm leading-5 text-muted-foreground">{t(description)}</Text>
                </View>
              ))}
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {currentStep.slug === 'profile' ? (
          <HeroCard className="rounded-panel">
            <HeroCard.Body className="gap-4 p-5">
              <Text accessibilityRole="header" className="text-xl font-bold text-foreground">{t('profile_title')}</Text>
              <Text className="text-sm leading-5 text-muted-foreground">{t('profile_description')}</Text>
              <View className="items-center gap-3">
                {profile.avatar_url ? <Image source={{ uri: profile.avatar_url }} className="h-24 w-24 rounded-full" accessibilityLabel={t('validation_photo')} /> : <View className="h-24 w-24 rounded-full bg-default-100" />}
                <Button variant="outline" onPress={() => void pickAvatar()} isLoading={busy} accessibilityLabel={t('aria_upload_photo')}>
                  {profile.avatar_url ? t('change_photo') : t('choose_photo')}
                </Button>
              </View>
              <TextArea
                label={t('bio_label')}
                value={bio}
                onChangeText={setBio}
                placeholder={t('bio_placeholder')}
                maxLength={2000}
                accessibilityLabel={t('bio_label')}
              />
              <Text className="text-xs text-muted-foreground">{t('bio_min_chars', { min: minBioLength, current: bio.trim().length })}</Text>
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {currentStep.slug === 'interests' ? (
          <CategoryStep title={t('interests_title')} description={t('interests_description')} categories={categories} selected={interests} setSelected={setInterests} primary={primary} emptyText={t('no_categories_available')} />
        ) : null}

        {currentStep.slug === 'skills' ? (
          <View className="gap-4">
            <CategoryStep title={t('skills_offer_title')} description={t('skills_offer_description')} categories={categories} selected={offers} setSelected={setOffers} primary={primary} emptyText={t('no_categories_available')} />
            <CategoryStep title={t('skills_need_title')} description={t('skills_need_description')} categories={categories} selected={needs} setSelected={setNeeds} primary={primary} emptyText={t('no_categories_available')} />
          </View>
        ) : null}

        {currentStep.slug === 'safeguarding' ? (
          <HeroCard className="rounded-panel">
            <HeroCard.Body className="gap-4 p-5">
              <Text accessibilityRole="header" className="text-xl font-bold text-foreground">{t('safeguarding_title')}</Text>
              <Text className="text-sm leading-5 text-muted-foreground">{configuration?.config.safeguarding_intro_text || t('safeguarding_intro')}</Text>
              <View className="rounded-panel-inner border border-primary/30 bg-primary/5 p-3">
                <Text className="text-xs leading-5 text-muted-foreground">{t('safeguarding_gdpr_notice')}</Text>
              </View>
              {safeguardingOptions.length === 0 ? <Text className="text-sm text-muted-foreground">{t('safeguarding.empty')}</Text> : null}
              {safeguardingOptions.map((option) => (
                <View key={option.id} className="gap-2 rounded-panel-inner border border-default-200 p-3">
                  {option.option_type === 'checkbox' ? (
                    <Checkbox checked={!!safeguardingSelections[option.id]} onPress={() => toggleSafeguarding(option)} label={`${option.label}${option.is_required ? ' *' : ''}`} accessibilityLabel={option.label} />
                  ) : (
                    <Text className="font-semibold text-foreground">{option.label}{option.is_required ? ' *' : ''}</Text>
                  )}
                  {option.description ? <Text className="text-sm leading-5 text-muted-foreground">{option.description}</Text> : null}
                  {option.option_type === 'select' ? parseSelectOptions(option.select_options).map((choice) => {
                    const selected = safeguardingSelectValues[option.id] === choice.value;
                    return (
                      <NativePressable
                        key={choice.value}
                        accessibilityRole="radio"
                        accessibilityLabel={choice.label}
                        accessibilityState={{ selected }}
                        onPress={() => setSafeguardingSelectValues((values) => ({ ...values, [option.id]: choice.value }))}
                        className="rounded-panel-inner border p-3"
                        style={{ borderColor: selected ? primary : theme.border }}
                      >
                        <Text className="text-foreground">{choice.label}</Text>
                      </NativePressable>
                    );
                  }) : null}
                  {option.help_url ? <Button variant="ghost" size="sm" onPress={() => void Linking.openURL(option.help_url!)}>{t('safeguarding.learn_more')}</Button> : null}
                </View>
              ))}
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {currentStep.slug === 'confirm' ? (
          <HeroCard className="rounded-panel">
            <HeroCard.Body className="gap-4 p-5">
              <Text accessibilityRole="header" className="text-xl font-bold text-foreground">{t('confirm_title')}</Text>
              <Summary title={t('summary_interests')} values={interests} categories={categories} empty={t('none_selected')} />
              <Summary title={t('summary_offers')} values={offers} categories={categories} empty={t('none_selected')} />
              <Summary title={t('summary_needs')} values={needs} categories={categories} empty={t('none_selected')} />
              <Button testID="onboarding-complete" fullWidth onPress={() => void finish()} isLoading={busy}>{t('complete_setup')}</Button>
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {currentStep.slug !== 'confirm' ? (
          <View className="mt-5 flex-row gap-3">
            {stepIndex > 0 ? <Button variant="outline" onPress={goBack} disabled={busy}>{t('back')}</Button> : null}
            <View className="flex-1">
              <Button
                testID="onboarding-next"
                fullWidth
                onPress={() => {
                  if (currentStep.slug === 'profile') void saveProfile();
                  else if (currentStep.slug === 'safeguarding') void saveSafeguarding();
                  else goNext();
                }}
                isLoading={busy}
              >
                {currentStep.slug === 'welcome' ? t('lets_get_started') : t('next')}
              </Button>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function CategoryStep({
  title,
  description,
  categories,
  selected,
  setSelected,
  primary,
  emptyText,
}: {
  title: string;
  description: string;
  categories: OnboardingCategory[];
  selected: number[];
  setSelected: (next: number[]) => void;
  primary: string;
  emptyText: string;
}) {
  return (
    <HeroCard className="rounded-panel">
      <HeroCard.Body className="gap-3 p-5">
        <Text accessibilityRole="header" className="text-xl font-bold text-foreground">{title}</Text>
        <Text className="text-sm leading-5 text-muted-foreground">{description}</Text>
        {categories.length === 0 ? <Text className="text-sm text-muted-foreground">{emptyText}</Text> : categories.map((category) => {
          const isSelected = selected.includes(category.id);
          return (
            <NativePressable
              key={category.id}
              accessibilityRole="checkbox"
              accessibilityLabel={category.name}
              accessibilityState={{ checked: isSelected }}
              onPress={() => setSelected(toggleId(selected, category.id))}
              className="rounded-panel-inner border p-3"
              style={{ borderColor: isSelected ? primary : '#94A3B8' }}
            >
              <Text className="font-medium text-foreground">{isSelected ? '✓ ' : ''}{category.name}</Text>
            </NativePressable>
          );
        })}
      </HeroCard.Body>
    </HeroCard>
  );
}

function Summary({ title, values, categories, empty }: { title: string; values: number[]; categories: OnboardingCategory[]; empty: string }) {
  const names = values.map((id) => categories.find((category) => category.id === id)?.name).filter(Boolean);
  return (
    <View className="gap-1 rounded-panel-inner bg-default-50 p-3">
      <Text className="font-semibold text-foreground">{title}</Text>
      <Text className="text-sm text-muted-foreground">{names.length > 0 ? names.join(', ') : empty}</Text>
    </View>
  );
}

export default function OnboardingScreen() {
  return <ModalErrorBoundary><OnboardingScreenInner /></ModalErrorBoundary>;
}
