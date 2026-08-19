// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button as HeroButton, Card as HeroCard, Chip, Surface, Text } from 'heroui-native';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';

import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import {
  completeMerchantOnboarding,
  getMerchantOnboardingStatus,
  saveMerchantOnboardingStep1,
  saveMerchantOnboardingStep2,
  saveMerchantOnboardingStep3,
  type MerchantSellerProfile,
} from '@/lib/api/marketplace';
import { updateAvatar } from '@/lib/api/profile';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { resolveImageUrl } from '@/lib/utils/resolveImageUrl';
import { withAlpha } from '@/lib/utils/color';

type Step = 1 | 2 | 3 | 4;
type SellerType = 'private' | 'business';
type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
type DayHours = { open: string; close: string };

const DAYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DEFAULT_DAY_HOURS: DayHours = { open: '09:00', close: '18:00' };

function defaultOpeningHours(): Record<DayKey, DayHours | null> {
  return {
    mon: { ...DEFAULT_DAY_HOURS },
    tue: { ...DEFAULT_DAY_HOURS },
    wed: { ...DEFAULT_DAY_HOURS },
    thu: { ...DEFAULT_DAY_HOURS },
    fri: { ...DEFAULT_DAY_HOURS },
    sat: null,
    sun: null,
  };
}

export default function MarketplaceMerchantOnboardingRoute() {
  return (
    <ModalErrorBoundary>
      <MarketplaceMerchantOnboardingScreen />
    </ModalErrorBoundary>
  );
}

function MarketplaceMerchantOnboardingScreen() {
  const { t } = useTranslation(['marketplace', 'common']);
  const { hasFeature } = useTenant();
  const { user, displayName, refreshUser } = useAuth();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const [step, setStep] = useState<Step>(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [badgeGranted, setBadgeGranted] = useState(false);
  const [sellerType, setSellerType] = useState<SellerType>('business');
  const [businessName, setBusinessName] = useState('');
  const [display, setDisplay] = useState(displayName || '');
  const [bio, setBio] = useState(getUserBio(user));
  const [registration, setRegistration] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('');
  const [openingHours, setOpeningHours] = useState<Record<DayKey, DayHours | null>>(() => defaultOpeningHours());
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url ?? '');
  const [coverImageUrl, setCoverImageUrl] = useState('');

  useEffect(() => {
    let mounted = true;
    getMerchantOnboardingStatus()
      .then((response) => {
        if (!mounted) return;
        hydrate(response.data.profile);
        setCompleted(Boolean(response.data.onboarding_completed));
      })
      .catch(() => {
        if (mounted) {
          showToast({ title: t('common:errors.alertTitle'), description: t('merchantOnboarding.loadFailed'), variant: 'danger' });
        }
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const avatarPreview = resolveImageUrl(avatarUrl);
  const progress = useMemo(() => [1, 2, 3, 4] as Step[], []);

  function hydrate(profile: MerchantSellerProfile | null) {
    if (!profile) return;
    if (profile.seller_type === 'private' || profile.seller_type === 'business') setSellerType(profile.seller_type);
    setBusinessName(profile.business_name ?? '');
    setDisplay(profile.display_name ?? displayName ?? '');
    setBio(profile.bio ?? getUserBio(user));
    setRegistration(profile.business_registration ?? '');
    setAvatarUrl(profile.avatar_url ?? user?.avatar_url ?? '');
    setCoverImageUrl(profile.cover_image_url ?? '');
    const address = parseRecord(profile.business_address);
    setStreet(address.street ?? '');
    setCity(address.city ?? '');
    setPostalCode(address.postal_code ?? '');
    setCountry(address.country ?? '');
    setOpeningHours(parseOpeningHours(profile.opening_hours));
  }

  async function pickAvatar() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast({ title: t('forms.permissionTitle'), description: t('forms.permissionMessage'), variant: 'warning' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.88,
    });
    if (result.canceled || !result.assets[0]?.uri) return;
    setIsSaving(true);
    try {
      const response = await updateAvatar(result.assets[0].uri);
      setAvatarUrl(response.data.avatar_url);
      if (user) refreshUser({ ...user, avatar_url: response.data.avatar_url });
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('merchantOnboarding.avatarFailed'), variant: 'danger' });
    } finally {
      setIsSaving(false);
    }
  }

  async function next() {
    if (isSaving) return;
    setIsSaving(true);
    try {
      if (step === 1) {
        if (!display.trim() || !bio.trim() || (sellerType === 'business' && !businessName.trim())) {
          showToast({ title: t('forms.validation'), description: t('merchantOnboarding.step1Required'), variant: 'warning' });
          return;
        }
        await saveMerchantOnboardingStep1({
          seller_type: sellerType,
          business_name: sellerType === 'business' ? businessName.trim() : null,
          display_name: display.trim(),
          bio: bio.trim(),
          business_registration: registration.trim() || null,
        });
        setStep(2);
      } else if (step === 2) {
        await saveMerchantOnboardingStep2({
          business_address: {
            street: street.trim(),
            city: city.trim(),
            postal_code: postalCode.trim(),
            country: country.trim(),
          },
          opening_hours: openingHours,
        });
        setStep(3);
      } else if (step === 3) {
        if (!avatarUrl.trim()) {
          showToast({ title: t('forms.validation'), description: t('merchantOnboarding.avatarRequired'), variant: 'warning' });
          return;
        }
        await saveMerchantOnboardingStep3({
          avatar_url: avatarUrl.trim(),
          cover_image_url: coverImageUrl.trim() || null,
        });
        setStep(4);
      } else {
        const response = await completeMerchantOnboarding();
        setCompleted(true);
        setBadgeGranted(Boolean(response.data.badge_granted));
      }
    } catch (err) {
      showToast({
        title: t('common:errors.alertTitle'),
        description: err instanceof Error ? err.message : t('merchantOnboarding.saveFailed'),
        variant: 'danger',
      });
    } finally {
      setIsSaving(false);
    }
  }

  function toggleDay(day: DayKey) {
    setOpeningHours((current) => ({
      ...current,
      [day]: current[day] ? null : { ...DEFAULT_DAY_HOURS },
    }));
  }

  function setDayTime(day: DayKey, field: keyof DayHours, value: string) {
    setOpeningHours((current) => {
      const existing = current[day] ?? { ...DEFAULT_DAY_HOURS };
      return {
        ...current,
        [day]: {
          ...existing,
          [field]: value,
        },
      };
    });
  }

  if (!hasFeature('marketplace')) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <AppTopBar title={t('merchantOnboarding.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <View className="flex-1 items-center justify-center px-6">
          <Text style={{ color: theme.textSecondary }}>{t('featureGate.description')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <AppTopBar title={t('merchantOnboarding.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace-my-listings' as Href} />
        <View className="flex-1 items-center justify-center"><LoadingSpinner /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <AppTopBar title={t('merchantOnboarding.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace-my-listings' as Href} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 132, gap: 12 }}>
        <HeroCard className="overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: theme.border }}>
          <View className="h-1.5" style={{ backgroundColor: completed ? theme.success : primary }} />
          <HeroCard.Body className="gap-3 p-4">
            <View className="flex-row items-start gap-3">
              <View
                className="h-12 w-12 items-center justify-center rounded-3xl"
                style={{ backgroundColor: withAlpha(completed ? theme.success : primary, 0.14), borderWidth: 1, borderColor: withAlpha(completed ? theme.success : primary, 0.2) }}
              >
                <Ionicons name={completed ? 'checkmark-circle-outline' : 'storefront-outline'} size={23} color={completed ? theme.success : primary} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>{t('merchantOnboarding.eyebrow')}</Text>
                <Text className="text-xl font-bold leading-7" style={{ color: theme.text }} numberOfLines={1}>{completed ? t('merchantOnboarding.completeTitle') : t('merchantOnboarding.title')}</Text>
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>{completed ? t('merchantOnboarding.completeSubtitle') : t('merchantOnboarding.subtitle')}</Text>
              </View>
            </View>
            <View className="flex-row flex-wrap gap-2">
              {progress.map((item) => (
                <Chip key={item} size="sm" variant={item === step ? 'primary' : 'secondary'}>
                  <Chip.Label>{t('merchantOnboarding.stepLabel', { step: item })}</Chip.Label>
                </Chip>
              ))}
              {badgeGranted ? <Chip size="sm" variant="secondary"><Chip.Label>{t('merchantOnboarding.badgeGranted')}</Chip.Label></Chip> : null}
            </View>
          </HeroCard.Body>
        </HeroCard>

        {completed ? (
          <HeroCard className="rounded-panel p-0" style={{ borderWidth: 1, borderColor: theme.border }}>
            <HeroCard.Body className="gap-3 p-4">
              <HeroButton variant="primary" onPress={() => router.replace('/(modals)/marketplace-my-listings' as Href)}>
                <Ionicons name="albums-outline" size={17} color="#fff" />
                <HeroButton.Label>{t('merchantOnboarding.goListings')}</HeroButton.Label>
              </HeroButton>
              <HeroButton variant="secondary" onPress={() => router.push('/(modals)/marketplace-stripe-onboarding' as Href)}>
                <Ionicons name="card-outline" size={17} color={primary} />
                <HeroButton.Label>{t('merchantOnboarding.stripeCta')}</HeroButton.Label>
              </HeroButton>
            </HeroCard.Body>
          </HeroCard>
        ) : (
          <HeroCard className="rounded-panel p-0" style={{ borderWidth: 1, borderColor: theme.border }}>
            <HeroCard.Body className="gap-5 p-3.5">
              {step === 1 ? (
                <>
                  <ButtonGroup
                    values={['business', 'private']}
                    selected={sellerType}
                    onSelect={(value) => setSellerType(value)}
                    labelFor={(value) => t(`merchantOnboarding.sellerType.${value}`)}
                  />
                  {sellerType === 'business' ? <FormInput label={t('merchantOnboarding.businessName')} value={businessName} onChangeText={setBusinessName} placeholder={t('merchantOnboarding.businessNamePlaceholder')} /> : null}
                  <FormInput label={t('merchantOnboarding.displayName')} value={display} onChangeText={setDisplay} placeholder={t('merchantOnboarding.displayNamePlaceholder')} />
                  <FormInput label={t('merchantOnboarding.bio')} value={bio} onChangeText={setBio} placeholder={t('merchantOnboarding.bioPlaceholder')} multiline />
                  <FormInput label={t('merchantOnboarding.registration')} value={registration} onChangeText={setRegistration} placeholder={t('merchantOnboarding.registrationPlaceholder')} />
                </>
              ) : null}

              {step === 2 ? (
                <>
                  <FormInput label={t('merchantOnboarding.street')} value={street} onChangeText={setStreet} placeholder={t('merchantOnboarding.streetPlaceholder')} />
                  <FormInput label={t('merchantOnboarding.city')} value={city} onChangeText={setCity} placeholder={t('merchantOnboarding.cityPlaceholder')} />
                  <View className="flex-row gap-3">
                    <View className="min-w-0 flex-1"><FormInput label={t('merchantOnboarding.postalCode')} value={postalCode} onChangeText={setPostalCode} placeholder={t('merchantOnboarding.postalCodePlaceholder')} /></View>
                    <View className="min-w-0 flex-1"><FormInput label={t('merchantOnboarding.country')} value={country} onChangeText={setCountry} placeholder={t('merchantOnboarding.countryPlaceholder')} /></View>
                  </View>
                  <Surface variant="secondary" className="rounded-panel-inner p-3" style={{ borderWidth: 1, borderColor: theme.border }}>
                    <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>{t('merchantOnboarding.hoursHint')}</Text>
                  </Surface>
                  <View className="gap-3">
                    <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>{t('merchantOnboarding.openingHours')}</Text>
                    {DAYS.map((day) => (
                      <OpeningHoursRow
                        key={day}
                        day={day}
                        hours={openingHours[day]}
                        onToggle={() => toggleDay(day)}
                        onChange={(field, value) => setDayTime(day, field, value)}
                      />
                    ))}
                  </View>
                </>
              ) : null}

              {step === 3 ? (
                <>
                  <View className="items-center gap-3 rounded-panel-inner p-4" style={{ borderWidth: 1, borderColor: theme.border, backgroundColor: withAlpha(primary, 0.05) }}>
                    <Surface variant="secondary" className="size-28 items-center justify-center overflow-hidden rounded-full p-0">
                      {avatarPreview ? <Image source={{ uri: avatarPreview }} className="h-full w-full" resizeMode="cover" /> : <Ionicons name="person-outline" size={34} color={primary} />}
                    </Surface>
                    <HeroButton variant="secondary" onPress={() => void pickAvatar()} isDisabled={isSaving}>
                      <Ionicons name="camera-outline" size={17} color={primary} />
                      <HeroButton.Label>{t('merchantOnboarding.pickAvatar')}</HeroButton.Label>
                    </HeroButton>
                  </View>
                  <FormInput label={t('merchantOnboarding.avatarUrl')} value={avatarUrl} onChangeText={setAvatarUrl} placeholder={t('merchantOnboarding.avatarUrlPlaceholder')} />
                  <FormInput label={t('merchantOnboarding.coverImageUrl')} value={coverImageUrl} onChangeText={setCoverImageUrl} placeholder={t('merchantOnboarding.coverImageUrlPlaceholder')} />
                </>
              ) : null}

              {step === 4 ? (
                <View className="gap-3">
                  <SummaryRow label={t('merchantOnboarding.displayName')} value={display} />
                  <SummaryRow label={t('merchantOnboarding.sellerTypeLabel')} value={t(`merchantOnboarding.sellerType.${sellerType}`)} />
                  <SummaryRow label={t('merchantOnboarding.locationLabel')} value={[city, country].filter(Boolean).join(', ') || t('merchantOnboarding.notSet')} />
                  <Surface variant="secondary" className="rounded-panel-inner p-3" style={{ borderWidth: 1, borderColor: theme.border }}>
                    <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={4}>{t('merchantOnboarding.reviewHint')}</Text>
                  </Surface>
                </View>
              ) : null}

              <View className="flex-row gap-2">
                {step > 1 ? (
                  <HeroButton className="flex-1" variant="secondary" onPress={() => setStep((step - 1) as Step)} isDisabled={isSaving}>
                    <Ionicons name="arrow-back-outline" size={17} color={primary} />
                    <HeroButton.Label>{t('common:back')}</HeroButton.Label>
                  </HeroButton>
                ) : null}
                <HeroButton className="flex-1" variant="primary" onPress={() => void next()} isDisabled={isSaving}>
                  <HeroButton.Label>{step === 4 ? t('merchantOnboarding.complete') : t('merchantOnboarding.next')}</HeroButton.Label>
                  <Ionicons name="arrow-forward-outline" size={17} color="#fff" />
                </HeroButton>
              </View>
            </HeroCard.Body>
          </HeroCard>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function parseRecord(value: MerchantSellerProfile['business_address']): Record<string, string> {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function parseOpeningHours(value: MerchantSellerProfile['opening_hours']): Record<DayKey, DayHours | null> {
  if (!value) return defaultOpeningHours();

  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return defaultOpeningHours();
    }
  }

  if (!isUnknownRecord(parsed)) return defaultOpeningHours();

  const fallback = defaultOpeningHours();
  return DAYS.reduce<Record<DayKey, DayHours | null>>((hours, day) => {
    const dayValue = parsed[day];
    if (dayValue === null) {
      hours[day] = null;
      return hours;
    }
    if (isUnknownRecord(dayValue) && typeof dayValue.open === 'string' && typeof dayValue.close === 'string') {
      hours[day] = { open: dayValue.open, close: dayValue.close };
      return hours;
    }
    hours[day] = fallback[day];
    return hours;
  }, {} as Record<DayKey, DayHours | null>);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getUserBio(user: unknown): string {
  const candidate = user as { bio?: string | null } | null;
  return candidate?.bio ?? '';
}

function ButtonGroup<T extends string>({
  values,
  selected,
  onSelect,
  labelFor,
}: {
  values: T[];
  selected: T;
  onSelect: (value: T) => void;
  labelFor: (value: T) => string;
}) {
  const primary = usePrimaryColor();
  return (
    <View className="flex-row gap-2">
      {values.map((value) => (
        <HeroButton key={value} className="min-w-0 flex-1" variant={selected === value ? 'primary' : 'secondary'} onPress={() => onSelect(value)}>
          <HeroButton.Label>{labelFor(value)}</HeroButton.Label>
        </HeroButton>
      ))}
    </View>
  );
}

function FormInput({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  const theme = useTheme();
  return (
    <View className="w-full">
      <Input
        label={label}
        containerClassName="mb-0 w-full"
        inputClassName={`w-full ${multiline ? 'min-h-28' : 'min-h-12'} text-sm`}
        style={{ color: theme.text, minHeight: multiline ? 112 : undefined, textAlignVertical: multiline ? 'top' : 'center' }}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        multiline={multiline}
      />
    </View>
  );
}

function OpeningHoursRow({
  day,
  hours,
  onToggle,
  onChange,
}: {
  day: DayKey;
  hours: DayHours | null;
  onToggle: () => void;
  onChange: (field: keyof DayHours, value: string) => void;
}) {
  const { t } = useTranslation('marketplace');
  const primary = usePrimaryColor();
  const theme = useTheme();
  const isOpen = hours !== null;

  return (
    <Surface variant="secondary" className="gap-3 rounded-panel-inner p-3" style={{ borderWidth: 1, borderColor: theme.border }}>
      <View className="flex-row items-center justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={1}>{t(`merchantOnboarding.days.${day}`)}</Text>
        </View>
        <HeroButton size="sm" variant={isOpen ? 'primary' : 'secondary'} onPress={onToggle}>
          <HeroButton.Label>{isOpen ? t('merchantOnboarding.open') : t('merchantOnboarding.closed')}</HeroButton.Label>
        </HeroButton>
      </View>
      {isOpen ? (
        <View className="flex-row gap-3">
          <View className="min-w-0 flex-1">
            <FormInput
              label={t('merchantOnboarding.openTime')}
              value={hours.open}
              onChangeText={(value) => onChange('open', value)}
              placeholder={t('merchantOnboarding.openTimePlaceholder')}
            />
          </View>
          <View className="min-w-0 flex-1">
            <FormInput
              label={t('merchantOnboarding.closeTime')}
              value={hours.close}
              onChangeText={(value) => onChange('close', value)}
              placeholder={t('merchantOnboarding.closeTimePlaceholder')}
            />
          </View>
        </View>
      ) : null}
    </Surface>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <Surface variant="secondary" className="rounded-panel-inner p-3" style={{ borderWidth: 1, borderColor: theme.border }}>
      <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>{label}</Text>
      <Text className="mt-1 text-base font-semibold" style={{ color: theme.text }} numberOfLines={2}>{value}</Text>
    </Surface>
  );
}
