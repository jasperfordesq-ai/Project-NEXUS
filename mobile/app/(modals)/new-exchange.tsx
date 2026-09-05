// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, type TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBottomInset } from '@/lib/ui/rootInsets';
import { router } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner } from 'heroui-native';

import {
  createExchange,
  generateExchangeDescription,
  getExchangeCategories,
  setExchangeTags,
  uploadExchangeImage,
  type ExchangeCategory,
  type ExchangeType,
} from '@/lib/api/exchanges';
import { ApiResponseError } from '@/lib/api/client';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { describeApiError } from '@/lib/api/describeApiError';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import OfflineBanner from '@/components/OfflineBanner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import Input from '@/components/ui/Input';
import AccentIcon from '@/components/ui/AccentIcon';

type ServiceType = 'physical_only' | 'remote_only' | 'hybrid' | 'location_dependent';
type ExperienceOption = (typeof experienceOptions)[number];
type EquipmentOption = (typeof equipmentOptions)[number];

interface FieldErrors {
  title?: string;
  description?: string;
  category?: string;
  hours?: string;
}

const serviceTypes: ServiceType[] = ['hybrid', 'physical_only', 'remote_only', 'location_dependent'];
const experienceOptions = ['beginner_friendly', 'some_experience', 'experienced', 'professional'] as const;
const equipmentOptions = ['provided', 'partial', 'bring_own', 'not_applicable'] as const;
const MIN_LISTING_TITLE_LENGTH = 5;
const MIN_LISTING_DESCRIPTION_LENGTH = 20;
const MIN_LISTING_HOURS = 0.5;
const MAX_LISTING_HOURS = 100;
const experienceLabelKeys: Record<ExperienceOption, string> = {
  beginner_friendly: 'experienceBeginner',
  some_experience: 'experienceSome',
  experienced: 'experienceExperienced',
  professional: 'experienceProfessional',
};
const equipmentLabelKeys: Record<EquipmentOption, string> = {
  provided: 'equipmentProvidedOption',
  partial: 'equipmentPartial',
  bring_own: 'equipmentBringOwn',
  not_applicable: 'equipmentNa',
};

export default function NewExchangeModal() {
  return (
    <ModalErrorBoundary>
      <NewExchangeModalInner />
    </ModalErrorBoundary>
  );
}

function NewExchangeModalInner() {
  const { t } = useTranslation('exchanges');
  const primary = usePrimaryColor();
  const theme = useTheme();
  const bottomInset = useBottomInset();
  const { show: showToast } = useAppToast();
  const { user } = useAuth();
  const profileLocation = getProfileLocation(user);
  const descriptionRef = useRef<TextInput>(null);
  const hoursRef = useRef<TextInput>(null);

  const { data: categoriesData } = useApi(() => getExchangeCategories());
  const categories: ExchangeCategory[] = categoriesData?.data ?? [];

  const [type, setType] = useState<ExchangeType>('offer');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [hours, setHours] = useState('1');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [serviceType, setServiceType] = useState<ServiceType>('hybrid');
  const [skillTags, setSkillTags] = useState('');
  const [experienceLevel, setExperienceLevel] = useState<ExperienceOption | ''>('');
  const [equipmentProvided, setEquipmentProvided] = useState<EquipmentOption | ''>('');
  const [accessibilityNotes, setAccessibilityNotes] = useState('');
  const [showServiceDetails, setShowServiceDetails] = useState(false);
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selectedCategoryName = categories.find((category) => category.id === categoryId)?.name ?? t('form.summaryNotSet');
  const isGenericTitle = isGenericListingTitle(title, selectedCategoryName);

  async function handlePickImage() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        allowsMultipleSelection: false,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      setSelectedImageUri(result.assets[0].uri);
    } catch {
      setError(t('detail.imagePickFailed'));
    }
  }

  async function handleGenerateDescription() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || generatingDescription) return;
    setGeneratingDescription(true);
    try {
      const response = await generateExchangeDescription({
        title: trimmedTitle,
        category: selectedCategoryName === t('form.summaryNotSet') ? '' : selectedCategoryName,
        type,
        notes: description.trim(),
      });
      const generated = response.data?.description?.trim();
      if (generated) {
        setDescription(generated);
        if (fieldErrors.description) setFieldErrors((current) => ({ ...current, description: undefined }));
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('detail.actionFailedTitle'), description: describeApiError(err, t('detail.aiGenerateFailed')), variant: 'danger' });
    } finally {
      setGeneratingDescription(false);
    }
  }

  async function handleSubmit() {
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const parsedHours = Number(hours);
    const nextErrors: FieldErrors = {};

    if (!trimmedTitle) {
      nextErrors.title = t('validation.titleRequired');
    } else if (trimmedTitle.length < MIN_LISTING_TITLE_LENGTH) {
      nextErrors.title = t('validation.titleMinLength');
    }
    if (!trimmedDescription) {
      nextErrors.description = t('validation.descriptionRequired');
    } else if (trimmedDescription.length < MIN_LISTING_DESCRIPTION_LENGTH) {
      nextErrors.description = t('validation.descriptionMinLength');
    }
    if (!categoryId) nextErrors.category = t('validation.categoryRequired');
    if (!Number.isFinite(parsedHours)) {
      nextErrors.hours = t('validation.invalidCredits');
    } else if (parsedHours < MIN_LISTING_HOURS || parsedHours > MAX_LISTING_HOURS) {
      nextErrors.hours = t('validation.creditsRange');
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    const selectedCategoryId = categoryId;
    if (selectedCategoryId === null) {
      setFieldErrors({ category: t('validation.categoryRequired') });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setFieldErrors({});
    setError(null);
    setSubmitting(true);
    let successDestination: Parameters<typeof router.push>[0] | null = null;
    try {
      const created = await createExchange({
        title: trimmedTitle,
        description: buildEnrichedDescription(trimmedDescription, {
          experience: experienceLevel,
          equipment: equipmentProvided,
          accessibility: accessibilityNotes,
        }, t),
        type,
        hours_estimate: parsedHours,
        category_id: selectedCategoryId,
        location: profileLocation,
        service_type: serviceType,
      });
      const listingId = created.data?.id;
      const tags = skillTags.split(',').map((tag) => tag.trim()).filter(Boolean);
      if (listingId) {
        await setExchangeTags(listingId, tags).catch(() => null);
        if (selectedImageUri) {
          try {
            await uploadExchangeImage(listingId, selectedImageUri);
          } catch (err) {
            showToast({ title: t('detail.imageUploadFailedTitle'), description: describeApiError(err, t('detail.imageUploadFailedMessage')), variant: 'danger' });
          }
        }
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (listingId) {
        successDestination = { pathname: '/(modals)/exchange-detail', params: { id: String(listingId) } };
      } else {
        // No id came back, so there is nothing to land on — the else branch below leaves the form.
      }
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(err instanceof ApiResponseError ? err.message : t('createError'));
    } finally {
      setSubmitting(false);
    }

    // 🔴 `replace`, not `push`, and it is the difference between working and silent.
    //
    // Measured on a device on 2026-08-22: posting a listing returned 201, the row was
    // written — and the member was left sitting on the filled form with no confirmation of
    // any kind. `router.push` from a screen that was opened as the deep-link ROOT does
    // nothing, and `router.back()` from a root has nothing to go back to, so both arms of
    // the old branch could no-op. The next thing a member does is tap the button again,
    // which posts a duplicate.
    //
    // `replace` lands on the created listing whether or not there is a back stack, and it is
    // also the right history: going "back" to a form whose contents have already been
    // posted is a duplicate-post trap in itself.
    if (successDestination) {
      setTimeout(() => router.replace(successDestination), 0);
    } else {
      setTimeout(() => {
        if (typeof router.canGoBack === 'function' && router.canGoBack()) router.back();
        else router.replace('/(tabs)/exchanges');
      }, 0);
    }
  }

  return (
    <SafeAreaView
      testID="new-exchange-screen"
      className="flex-1 bg-background"
      style={{ flex: 1, backgroundColor: theme.bg }}
    >
      <AppTopBar title={t('newExchange')} backLabel={t('detail.goBack')} fallbackHref="/(tabs)/exchanges" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          testID="new-exchange-scroll"
          style={{ flex: 1, backgroundColor: theme.bg }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120, gap: 14 }}
          keyboardShouldPersistTaps="handled"
        >
          <OfflineBanner />

          <HeroCard variant="default" className="overflow-hidden">
            <View style={{ height: 4, backgroundColor: primary }} />
            <HeroCard.Body className="gap-3 p-4">
              <View className="flex-row items-center gap-3">
                <View className="h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                  <Ionicons name="add-circle-outline" size={23} color={primary} />
                </View>
                <View className="flex-1">
                  <Text style={{ color: theme.text }} className="text-xl font-bold">{t('newExchange')}</Text>
                  <Text style={{ color: theme.textMuted }} className="mt-1 text-sm leading-5">{t('form.createIntro')}</Text>
                </View>
              </View>
              <View className="mt-2 flex-row gap-2">
                <SummaryTile label={t('form.summaryType')} value={type === 'offer' ? t('form.offerTitle') : t('form.requestTitle')} theme={theme} />
                <SummaryTile label={t('form.summaryCategory')} value={selectedCategoryName} theme={theme} />
              </View>
            </HeroCard.Body>
          </HeroCard>

          {error ? (
            <HeroCard variant="secondary">
              <HeroCard.Body className="p-4">
                <Text style={{ color: theme.error }} className="text-sm font-medium">{error}</Text>
              </HeroCard.Body>
            </HeroCard>
          ) : null}

          <FormSection title={t('form.basicsTitle')} icon="document-text-outline" primary={primary} theme={theme}>
            <View className="flex-row gap-2">
              {(['offer', 'request'] as ExchangeType[]).map((value) => (
                <HeroButton
                  key={value}
                  className="flex-1"
                  variant={type === value ? 'primary' : 'secondary'}
                  onPress={() => setType(value)}
                  accessibilityState={{ selected: type === value }}
                >
                  <HeroButton.Label>{t(value)}</HeroButton.Label>
                </HeroButton>
              ))}
            </View>

            <FieldLabel label={t('titleLabel')} theme={theme} />
            <Input
              testID="new-exchange-title"
              value={title}
              onChangeText={(value) => {
                setTitle(value);
                if (fieldErrors.title) setFieldErrors((current) => ({ ...current, title: undefined }));
              }}
              placeholder={type === 'offer' ? t('offerPlaceholder') : t('requestPlaceholder')}
              placeholderTextColor={theme.textMuted}
              returnKeyType="next"
              maxLength={255}
              onSubmitEditing={() => descriptionRef.current?.focus()}
              blurOnSubmit={false}
              style={inputStyle(theme, Boolean(fieldErrors.title))}
            />
            {fieldErrors.title ? <ErrorText message={fieldErrors.title} theme={theme} /> : null}
            {isGenericTitle ? (
              <Text className="rounded-2xl px-3 py-2 text-xs leading-5" style={{ color: theme.warning, backgroundColor: withAlpha(theme.warning, 0.12) }}>
                {t('form.titleTooGenericHint')}
              </Text>
            ) : null}

            <FieldLabel label={t('description')} theme={theme} />
            <Input
              testID="new-exchange-description"
              ref={descriptionRef}
              value={description}
              onChangeText={(value) => {
                setDescription(value);
                if (fieldErrors.description) setFieldErrors((current) => ({ ...current, description: undefined }));
              }}
              placeholder={t('descriptionPlaceholder')}
              placeholderTextColor={theme.textMuted}
              multiline
              textAlignVertical="top"
              maxLength={10000}
              returnKeyType="next"
              onSubmitEditing={() => hoursRef.current?.focus()}
              style={[inputStyle(theme, Boolean(fieldErrors.description)), { minHeight: 132, paddingTop: 14 }]}
            />
            {fieldErrors.description ? <ErrorText message={fieldErrors.description} theme={theme} /> : null}
            <View className="gap-2">
              <HeroButton variant="secondary" isDisabled={!title.trim() || generatingDescription} onPress={() => void handleGenerateDescription()}>
                {generatingDescription ? <Spinner size="sm" /> : <Ionicons name="sparkles-outline" size={17} color={primary} />}
                <HeroButton.Label>{generatingDescription ? t('form.aiGenerating') : t('form.aiHelpWrite')}</HeroButton.Label>
              </HeroButton>
              {!title.trim() ? (
                <Text style={{ color: theme.textMuted }} className="text-xs leading-5">{t('form.aiEnterTitleFirst')}</Text>
              ) : null}
            </View>
          </FormSection>

          <FormSection title={t('form.deliveryTitle')} icon="location-outline" primary={primary} theme={theme}>
            <ChoiceGroup
              label={t('form.serviceType')}
              values={serviceTypes}
              selected={serviceType}
              onSelect={(value) => value && setServiceType(value)}
              labelFor={(value) => t(`serviceType.${value}`)}
              primary={primary}
              theme={theme}
            />

            <FieldLabel label={t('form.location')} theme={theme} />
            <Input
              value={profileLocation}
              editable={false}
              placeholder={t('form.locationPlaceholder')}
              placeholderTextColor={theme.textMuted}
              style={inputStyle(theme)}
            />
            <Text style={{ color: theme.textMuted }} className="-mt-2 text-xs leading-5">{t('form.locationFromProfile')}</Text>

            <FieldLabel label={t('form.skills')} theme={theme} />
            <Input
              value={skillTags}
              onChangeText={setSkillTags}
              placeholder={t('form.skillsPlaceholder')}
              placeholderTextColor={theme.textMuted}
              style={inputStyle(theme)}
            />
          </FormSection>

          <FormSection title={t('form.serviceDetailsToggle')} icon="information-circle-outline" primary={primary} theme={theme}>
            <HeroButton variant="secondary" onPress={() => setShowServiceDetails((value) => !value)}>
              <Ionicons name={showServiceDetails ? 'chevron-up-outline' : 'chevron-down-outline'} size={17} color={primary} />
              <HeroButton.Label>{t('form.serviceDetailsToggle')}</HeroButton.Label>
            </HeroButton>
            <Text style={{ color: theme.textMuted }} className="text-sm leading-5">{t('form.extraDetailsHint')}</Text>
            {showServiceDetails ? (
              <>
                <ChoiceGroup
                  label={t('form.experienceLabel')}
                  values={experienceOptions}
                  selected={experienceLevel}
                  onSelect={setExperienceLevel}
                  labelFor={(value) => t(`form.${experienceLabelKeys[value]}`)}
                  primary={primary}
                  theme={theme}
                />
                <ChoiceGroup
                  label={t('form.equipmentLabel')}
                  values={equipmentOptions}
                  selected={equipmentProvided}
                  onSelect={setEquipmentProvided}
                  labelFor={(value) => t(`form.${equipmentLabelKeys[value]}`)}
                  primary={primary}
                  theme={theme}
                />
                <FieldLabel label={t('form.accessibilityLabel')} theme={theme} />
                <Input
                  value={accessibilityNotes}
                  onChangeText={setAccessibilityNotes}
                  placeholder={t('form.accessibilityPlaceholder')}
                  placeholderTextColor={theme.textMuted}
                  multiline
                  textAlignVertical="top"
                  maxLength={200}
                  style={[inputStyle(theme), { minHeight: 92, paddingTop: 14 }]}
                />
              </>
            ) : null}
          </FormSection>

          <FormSection title={t('form.mediaSection')} icon="image-outline" primary={primary} theme={theme}>
            <Text style={{ color: theme.textMuted }} className="text-sm leading-5">{t('form.mediaHint')}</Text>
            {selectedImageUri ? (
              <View className="overflow-hidden rounded-2xl border" style={{ borderColor: theme.border }}>
                <Image source={{ uri: selectedImageUri }} style={{ width: '100%', height: 180, backgroundColor: theme.surface }} contentFit="cover" />
                <View className="flex-row gap-2 p-3" style={{ backgroundColor: theme.surface }}>
                  <HeroButton className="flex-1" variant="secondary" onPress={() => void handlePickImage()}>
                    <Ionicons name="image-outline" size={17} color={primary} />
                    <HeroButton.Label>{t('form.replaceImage')}</HeroButton.Label>
                  </HeroButton>
                  <HeroButton className="flex-1" variant="danger-soft" onPress={() => setSelectedImageUri(null)}>
                    <Ionicons name="trash-outline" size={17} color={theme.error} />
                    <HeroButton.Label>{t('form.removeImage')}</HeroButton.Label>
                  </HeroButton>
                </View>
              </View>
            ) : (
              <HeroButton variant="secondary" onPress={() => void handlePickImage()}>
                <Ionicons name="image-outline" size={18} color={primary} />
                <HeroButton.Label>{t('form.addImage')}</HeroButton.Label>
              </HeroButton>
            )}
          </FormSection>

          <FormSection title={t('form.organiseTitle')} icon="albums-outline" primary={primary} theme={theme}>
            {categories.length > 0 ? (
              <>
                <FieldLabel label={t('category')} theme={theme} />
                <View className="flex-row flex-wrap gap-2">
                  {categories.map((category) => {
                    const selected = categoryId === category.id;
                    return (
                      <HeroButton
                        key={category.id}
                        size="sm"
                        variant={selected ? 'primary' : 'secondary'}
                        onPress={() => {
                          setCategoryId(category.id);
                          if (fieldErrors.category) setFieldErrors((current) => ({ ...current, category: undefined }));
                        }}
                        accessibilityLabel={t('categoryLabel', { name: category.name })}
                        accessibilityState={{ selected }}
                      >
                        <HeroButton.Label>{category.name}</HeroButton.Label>
                      </HeroButton>
                    );
                  })}
                </View>
                {fieldErrors.category ? <ErrorText message={fieldErrors.category} theme={theme} /> : null}
              </>
            ) : null}

            <FieldLabel label={t('timeCredits')} theme={theme} />
            <Input
              testID="new-exchange-hours"
              ref={hoursRef}
              value={hours}
              onChangeText={(value) => {
                setHours(value);
                if (fieldErrors.hours) setFieldErrors((current) => ({ ...current, hours: undefined }));
              }}
              keyboardType="decimal-pad"
              placeholder={t('form.hoursPlaceholder')}
              placeholderTextColor={theme.textMuted}
              style={inputStyle(theme, Boolean(fieldErrors.hours))}
            />
            {fieldErrors.hours ? <ErrorText message={fieldErrors.hours} theme={theme} /> : null}

            <Chip color="default" size="sm" variant="soft">
              <Ionicons name="time-outline" size={12} color={theme.textMuted} />
              <Chip.Label>{t('form.hoursHint')}</Chip.Label>
            </Chip>
          </FormSection>
        </ScrollView>

        <View
          testID="new-exchange-footer"
          className="border-t px-4 pt-3"
          style={{ paddingBottom: Math.max(12, bottomInset + 12), backgroundColor: theme.surface, borderColor: theme.border }}
        >
          <View className="flex-row gap-3">
            <HeroButton className="flex-1" variant="secondary" isDisabled={submitting} onPress={() => router.back()}>
              <HeroButton.Label>{t('detail.cancel')}</HeroButton.Label>
            </HeroButton>
            <HeroButton testID="new-exchange-submit" className="flex-1" variant="primary" isDisabled={submitting} onPress={() => void handleSubmit()}>
              {submitting ? <Spinner size="sm" /> : <AccentIcon name="checkmark-outline" size={18} />}
              <HeroButton.Label>{type === 'offer' ? t('postOffer') : t('postRequest')}</HeroButton.Label>
            </HeroButton>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function FormSection({
  title,
  icon,
  primary,
  theme,
  children,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  children: ReactNode;
}) {
  return (
    <HeroCard variant="default">
      <HeroCard.Body className="gap-4 p-4">
        <View className="flex-row items-center gap-2">
          <View className="h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
            <Ionicons name={icon} size={17} color={primary} />
          </View>
          <Text style={{ color: theme.text }} className="text-base font-bold">{title}</Text>
        </View>
        {children}
      </HeroCard.Body>
    </HeroCard>
  );
}

function SummaryTile({ label, value, theme }: { label: string; value: string; theme: ReturnType<typeof useTheme> }) {
  return (
    <View className="flex-1 rounded-2xl border px-3 py-3" style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
      <Text style={{ color: theme.textMuted }} className="text-xs font-semibold uppercase">{label}</Text>
      <Text style={{ color: theme.text }} className="mt-1 text-sm font-semibold" numberOfLines={1}>{value}</Text>
    </View>
  );
}

function FieldLabel({ label, theme }: { label: string; theme: ReturnType<typeof useTheme> }) {
  return <Text style={{ color: theme.textMuted }} className="text-xs font-semibold uppercase">{label}</Text>;
}

function ErrorText({ message, theme }: { message: string; theme: ReturnType<typeof useTheme> }) {
  return <Text style={{ color: theme.error }} className="-mt-2 text-xs font-medium">{message}</Text>;
}

function ChoiceGroup<T extends string>({
  label,
  values,
  selected,
  onSelect,
  labelFor,
  primary,
  theme,
}: {
  label: string;
  values: readonly T[];
  selected: string;
  onSelect: (value: T | '') => void;
  labelFor: (value: T) => string;
  primary: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View className="gap-2">
      <FieldLabel label={label} theme={theme} />
      <View className="flex-row flex-wrap gap-2">
        {values.map((value) => {
          const selectedValue = selected === value;
          return (
            <HeroButton
              key={value}
              size="sm"
              variant={selectedValue ? 'primary' : 'secondary'}
              onPress={() => onSelect(selectedValue ? '' : value)}
              accessibilityState={{ selected: selectedValue }}
            >
              <HeroButton.Label>{labelFor(value)}</HeroButton.Label>
            </HeroButton>
          );
        })}
      </View>
    </View>
  );
}

function inputStyle(theme: ReturnType<typeof useTheme>, invalid = false) {
  return {
    backgroundColor: theme.surface,
    borderColor: invalid ? theme.error : theme.border,
    borderRadius: 14,
    borderWidth: 1,
    color: theme.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
  };
}

function buildEnrichedDescription(
  baseDescription: string,
  details: { experience: string; equipment: string; accessibility: string },
  t: (key: string) => string,
) {
  const detailLines = [
    details.experience.trim() ? `${t('form.experienceLabel')}: ${formatExperienceDetail(details.experience.trim(), t)}` : '',
    details.equipment.trim() ? `${t('form.equipmentLabel')}: ${formatEquipmentDetail(details.equipment.trim(), t)}` : '',
    details.accessibility.trim() ? `${t('form.accessibilityLabel')}: ${details.accessibility.trim()}` : '',
  ].filter(Boolean);

  if (detailLines.length === 0) return baseDescription;
  return `${baseDescription}\n\n---\n${detailLines.join('\n')}`.trim();
}

function formatExperienceDetail(value: string, t: (key: string) => string): string {
  return experienceOptions.includes(value as ExperienceOption)
    ? t(`form.${experienceLabelKeys[value as ExperienceOption]}`)
    : value;
}

function formatEquipmentDetail(value: string, t: (key: string) => string): string {
  return equipmentOptions.includes(value as EquipmentOption)
    ? t(`form.${equipmentLabelKeys[value as EquipmentOption]}`)
    : value;
}

function isGenericListingTitle(title: string, categoryName: string): boolean {
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedCategory = categoryName.trim().toLowerCase();
  if (!normalizedTitle || normalizedTitle.length < 3 || !normalizedCategory) return false;
  const stripped = normalizedTitle
    .replace(/^(i can help with|help with|looking for help with|need help with)\s+/i, '')
    .trim();
  return normalizedTitle === normalizedCategory || stripped === normalizedCategory;
}

function getProfileLocation(user: unknown): string {
  if (user && typeof user === 'object' && 'location' in user) {
    return String((user as { location?: string | null }).location ?? '');
  }
  return '';
}
