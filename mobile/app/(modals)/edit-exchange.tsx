// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner, TagGroup } from 'heroui-native';

import {
  deleteExchangeImage,
  generateExchangeDescription,
  getExchangeCategories,
  getExchange,
  setExchangeTags,
  updateExchange,
  uploadExchangeImage,
  type Exchange,
  type ExchangeCategory,
  type ExchangeType,
} from '@/lib/api/exchanges';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { contrastText, withAlpha } from '@/lib/utils/color';
import { resolveImageUrl } from '@/lib/utils/resolveImageUrl';
import * as Haptics from '@/lib/haptics';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import Input from '@/components/ui/Input';
import AccentIcon from '@/components/ui/AccentIcon';

type ServiceType = 'physical_only' | 'remote_only' | 'hybrid' | 'location_dependent';

const serviceTypes: ServiceType[] = ['hybrid', 'physical_only', 'remote_only', 'location_dependent'];
const MIN_LISTING_TITLE_LENGTH = 5;
const MIN_LISTING_DESCRIPTION_LENGTH = 20;
const MIN_LISTING_HOURS = 0.5;
const MAX_LISTING_HOURS = 100;

interface FieldErrors {
  title?: string;
  description?: string;
  category?: string;
  hours?: string;
}

export default function EditExchangeModal() {
  return (
    <ModalErrorBoundary>
      <EditExchangeModalInner />
    </ModalErrorBoundary>
  );
}

function EditExchangeModalInner() {
  const { t } = useTranslation('exchanges');
  const { id } = useLocalSearchParams<{ id: string }>();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { user } = useAuth();
  const profileLocation = getProfileLocation(user);
  const listingId = Number(id);
  const safeListingId = Number.isFinite(listingId) && listingId > 0 ? listingId : 0;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<ExchangeType>('offer');
  const [hours, setHours] = useState('1');
  const [serviceType, setServiceType] = useState<ServiceType>('hybrid');
  const [listingLocation, setListingLocation] = useState('');
  const [skillTags, setSkillTags] = useState('');
  const [experienceLevel, setExperienceLevel] = useState('');
  const [equipmentProvided, setEquipmentProvided] = useState('');
  const [accessibilityNotes, setAccessibilityNotes] = useState('');
  const [showServiceDetails, setShowServiceDetails] = useState(false);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [removeExistingImage, setRemoveExistingImage] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hydratedListingId, setHydratedListingId] = useState<number | null>(null);

  const { data, isLoading, error } = useApi(
    () => getExchange(safeListingId),
    [safeListingId],
    { enabled: safeListingId > 0 },
  );
  const { data: categoriesData } = useApi(() => getExchangeCategories());
  const categories: ExchangeCategory[] = categoriesData?.data ?? [];

  const listing: Exchange | undefined = (data as { data?: Exchange })?.data ?? (data as Exchange | null) ?? undefined;
  const selectedCategoryName = categories.find((category) => category.id === categoryId)?.name
    ?? categories.find((category) => category.id === listing?.category_id)?.name
    ?? listing?.category_name
    ?? t('form.summaryNotSet');
  const isGenericTitle = isGenericListingTitle(title, selectedCategoryName);

  useEffect(() => {
    if (!listing) return;
    if (hydratedListingId === listing.id) return;
    const parsedDescription = parseEnrichedDescription(listing.description ?? '', t);
    setTitle(listing.title ?? '');
    setDescription(parsedDescription.description);
    setExperienceLevel(parsedDescription.experience);
    setEquipmentProvided(parsedDescription.equipment);
    setAccessibilityNotes(parsedDescription.accessibility);
    setType(listing.type ?? 'offer');
    setHours(String(listing.hours_estimate ?? listing.estimated_hours ?? 1));
    setServiceType((listing.service_type ?? 'hybrid') as ServiceType);
    setListingLocation(listing.location ?? profileLocation);
    setSkillTags((listing.skill_tags ?? []).join(', '));
    setCategoryId(listing.category_id ?? null);
    setSelectedImageUri(null);
    setRemoveExistingImage(false);
    setHydratedListingId(listing.id);
  }, [hydratedListingId, listing, profileLocation, t]);

  async function handlePickImage() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        allowsMultipleSelection: false,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      setSelectedImageUri(result.assets[0].uri);
      setRemoveExistingImage(false);
    } catch {
      showToast({ title: t('detail.actionFailedTitle'), description: t('detail.imagePickFailed'), variant: 'danger' });
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
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('detail.actionFailedTitle'), description: t('detail.aiGenerateFailed'), variant: 'danger' });
    } finally {
      setGeneratingDescription(false);
    }
  }

  async function handleSave() {
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

    if (categories.length > 0 && !categoryId && !listing?.category_id) {
      nextErrors.category = t('validation.categoryRequired');
    }

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

    setFieldErrors({});
    setSaving(true);
    try {
      await updateExchange(safeListingId, {
        title: trimmedTitle,
        description: buildEnrichedDescription(trimmedDescription, {
          experience: experienceLevel,
          equipment: equipmentProvided,
          accessibility: accessibilityNotes,
        }, t),
        type,
        hours_estimate: parsedHours,
        category_id: categoryId ?? listing?.category_id ?? 1,
        location: listingLocation,
        service_type: serviceType,
      });
      const tags = skillTags.split(',').map((tag) => tag.trim()).filter(Boolean);
      await setExchangeTags(safeListingId, tags).catch(() => null);
      if (selectedImageUri) {
        await uploadExchangeImage(safeListingId, selectedImageUri);
      } else if (removeExistingImage && listing?.image_url) {
        await deleteExchangeImage(safeListingId);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('detail.editSavedTitle'), description: t('detail.editSavedMessage'), variant: 'success' });
      router.replace({ pathname: '/(modals)/exchange-detail', params: { id: String(safeListingId) } });
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('detail.actionFailedTitle'), description: t('detail.editSaveFailed'), variant: 'danger' });
    } finally {
      setSaving(false);
    }
  }

  if (safeListingId <= 0) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('editTitle')} backLabel={t('detail.goBack')} fallbackHref="/(tabs)/exchanges" />
        <HeroCard variant="secondary" className="mx-4 my-6">
          <HeroCard.Body className="items-center gap-3 p-6">
            <Ionicons name="alert-circle-outline" size={28} color={theme.error} />
            <Text className="text-center text-sm text-muted-foreground">{t('detail.invalidId')}</Text>
          </HeroCard.Body>
        </HeroCard>
      </SafeAreaView>
    );
  }

  if (isLoading) return <LoadingSpinner />;

  if (error || !listing) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('editTitle')} backLabel={t('detail.goBack')} fallbackHref="/(tabs)/exchanges" />
        <HeroCard variant="secondary" className="mx-4 my-6">
          <HeroCard.Body className="items-center gap-3 p-6">
            <Ionicons name="alert-circle-outline" size={28} color={theme.error} />
            <Text className="text-center text-sm text-muted-foreground">{error ?? t('detail.editLoadFailed')}</Text>
          </HeroCard.Body>
        </HeroCard>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('editTitle')} backLabel={t('detail.goBack')} fallbackHref={{ pathname: '/(modals)/exchange-detail', params: { id: String(safeListingId) } }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120, gap: 14 }} keyboardShouldPersistTaps="handled">
          <HeroCard variant="default" className="overflow-hidden">
            <View style={{ height: 4, backgroundColor: primary }} />
            <HeroCard.Body className="gap-3 p-4">
              <View className="flex-row items-center gap-3">
                <View
                  className="h-11 w-11 items-center justify-center rounded-full"
                  style={{ backgroundColor: withAlpha(primary, 0.14) }}
                >
                  <Ionicons name="create-outline" size={22} color={primary} />
                </View>
                <View className="flex-1">
                  <Text style={{ color: theme.text }} className="text-xl font-bold">{t('editTitle')}</Text>
                  <Text style={{ color: theme.textMuted }} className="mt-1 text-sm leading-5">
                    {t('form.editIntro')}
                  </Text>
                </View>
              </View>
              <View className="mt-2 flex-row gap-2">
                <SummaryTile label={t('form.summaryType')} value={type === 'offer' ? t('form.offerTitle') : t('form.requestTitle')} theme={theme} />
                <SummaryTile label={t('form.summaryCategory')} value={selectedCategoryName} theme={theme} />
              </View>
            </HeroCard.Body>
          </HeroCard>

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
                value={title}
                onChangeText={(value) => {
                  setTitle(value);
                  if (fieldErrors.title) setFieldErrors((current) => ({ ...current, title: undefined }));
                }}
                placeholder={type === 'offer' ? t('offerPlaceholder') : t('requestPlaceholder')}
                placeholderTextColor={theme.textMuted}
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
                value={description}
                onChangeText={(value) => {
                  setDescription(value);
                  if (fieldErrors.description) setFieldErrors((current) => ({ ...current, description: undefined }));
                }}
                placeholder={t('descriptionPlaceholder')}
                placeholderTextColor={theme.textMuted}
                multiline
                textAlignVertical="top"
                style={[inputStyle(theme, Boolean(fieldErrors.description)), { minHeight: 132, paddingTop: 14 }]}
              />
              {fieldErrors.description ? <ErrorText message={fieldErrors.description} theme={theme} /> : null}
              <View className="gap-2">
                <HeroButton
                  variant="secondary"
                  isDisabled={!title.trim() || generatingDescription}
                  onPress={() => void handleGenerateDescription()}
                >
                  {generatingDescription ? <Spinner size="sm" /> : <Ionicons name="sparkles-outline" size={17} color={primary} />}
                  <HeroButton.Label>{generatingDescription ? t('form.aiGenerating') : t('form.aiHelpWrite')}</HeroButton.Label>
                </HeroButton>
                {!title.trim() ? (
                  <Text style={{ color: theme.textMuted }} className="text-xs leading-5">
                    {t('form.aiEnterTitleFirst')}
                  </Text>
                ) : null}
              </View>
          </FormSection>

          <FormSection title={t('form.deliveryTitle')} icon="location-outline" primary={primary} theme={theme}>
              <FieldLabel label={t('form.serviceType')} theme={theme} />
              <TagGroup
                size="sm"
                selectionMode="single"
                selectedKeys={[serviceType]}
                onSelectionChange={(keys) => {
                  const next = Array.from(keys)[0];
                  if (next !== undefined) setServiceType(next as ServiceType);
                }}
              >
                <TagGroup.List>
                  {serviceTypes.map((value) => {
                    const isSelected = serviceType === value;
                    return (
                      <TagGroup.Item
                        key={value}
                        id={value}
                      >
                        <TagGroup.ItemLabel style={isSelected ? { color: contrastText(primary) } : undefined}>
                          {t(`serviceType.${value}`)}
                        </TagGroup.ItemLabel>
                      </TagGroup.Item>
                    );
                  })}
                </TagGroup.List>
              </TagGroup>

              <FieldLabel label={t('form.location')} theme={theme} />
              <Input
                value={listingLocation}
                editable={false}
                placeholder={t('form.locationPlaceholder')}
                placeholderTextColor={theme.textMuted}
                style={inputStyle(theme)}
              />
              <Text style={{ color: theme.textMuted }} className="-mt-2 text-xs leading-5">
                {t('form.locationFromProfile')}
              </Text>

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
              <Text style={{ color: theme.textMuted }} className="text-sm leading-5">
                {t('form.extraDetailsHint')}
              </Text>
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
                    style={[inputStyle(theme), { minHeight: 92, paddingTop: 14 }]}
                    maxLength={200}
                  />
                </>
              ) : null}
          </FormSection>

          <FormSection title={t('form.mediaSection')} icon="image-outline" primary={primary} theme={theme}>
              <Text style={{ color: theme.textMuted }} className="text-sm leading-5">
                {t('form.mediaHint')}
              </Text>
              {selectedImageUri || (listing.image_url && !removeExistingImage) ? (
                <View className="overflow-hidden rounded-2xl border" style={{ borderColor: theme.border }}>
                  <Image
                    source={{ uri: selectedImageUri ?? resolveImageUrl(listing.image_url) ?? undefined }}
                    style={{ width: '100%', height: 180, backgroundColor: theme.surface }}
                    contentFit="cover"
                  />
                  <View className="flex-row gap-2 p-3" style={{ backgroundColor: theme.surface }}>
                    <HeroButton className="flex-1" variant="secondary" onPress={() => void handlePickImage()}>
                      <Ionicons name="image-outline" size={17} color={primary} />
                      <HeroButton.Label>{t('form.replaceImage')}</HeroButton.Label>
                    </HeroButton>
                    <HeroButton
                      className="flex-1"
                      variant="danger-soft"
                      onPress={() => {
                        setSelectedImageUri(null);
                        setRemoveExistingImage(true);
                      }}
                    >
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
                      const selected = categoryId === category.id || (!categoryId && listing.category_id === category.id);
                      return (
                        <HeroButton
                          key={category.id}
                          size="sm"
                          variant={selected ? 'primary' : 'secondary'}
                          onPress={() => {
                            setCategoryId(category.id);
                            if (fieldErrors.category) setFieldErrors((current) => ({ ...current, category: undefined }));
                          }}
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

              {listing.status ? (
                <View className="flex-row items-center justify-between rounded-2xl px-3 py-3" style={{ backgroundColor: withAlpha(primary, 0.08) }}>
                  <View>
                    <Text style={{ color: theme.textMuted }} className="text-xs font-semibold uppercase">
                      {t('detail.status')}
                    </Text>
                    <Text style={{ color: theme.text }} className="mt-1 text-sm font-semibold">
                      {t(`status.${listing.status}`)}
                    </Text>
                  </View>
                  <Chip color={listing.status === 'expired' ? 'warning' : 'success'} size="sm" variant="soft">
                    <Chip.Label>{t(`status.${listing.status}`)}</Chip.Label>
                  </Chip>
                </View>
              ) : null}
          </FormSection>

        </ScrollView>
        <View className="border-t px-4 py-3" style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
          <View className="flex-row gap-3">
            <HeroButton className="flex-1" variant="secondary" isDisabled={saving} onPress={() => router.back()}>
              <HeroButton.Label>{t('detail.cancel')}</HeroButton.Label>
            </HeroButton>
            <HeroButton className="flex-1" variant="primary" isDisabled={saving} onPress={() => void handleSave()}>
              {saving ? <Spinner size="sm" /> : <AccentIcon name="save-outline" size={18} />}
              <HeroButton.Label>{t('detail.saveChanges')}</HeroButton.Label>
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
          <View
            className="h-8 w-8 items-center justify-center rounded-full"
            style={{ backgroundColor: withAlpha(primary, 0.12) }}
          >
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
  return (
    <Text style={{ color: theme.textMuted }} className="text-xs font-semibold uppercase">
      {label}
    </Text>
  );
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
          const isSelected = selected === value;
          return (
            <HeroButton
              key={value}
              size="sm"
              variant={isSelected ? 'primary' : 'secondary'}
              onPress={() => onSelect(isSelected ? '' : value)}
              accessibilityState={{ selected: isSelected }}
            >
              <HeroButton.Label>{labelFor(value)}</HeroButton.Label>
            </HeroButton>
          );
        })}
      </View>
    </View>
  );
}

function ErrorText({ message, theme }: { message: string; theme: ReturnType<typeof useTheme> }) {
  return <Text style={{ color: theme.error }} className="-mt-2 text-xs font-medium">{message}</Text>;
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

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<\/(?:div|p|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseEnrichedDescription(value: string, t: (key: string) => string) {
  const plain = stripHtml(value);
  const [main, detailsBlock = ''] = plain.split(/\n\s*---\s*\n/);
  const details = detailsBlock.split('\n').map((line) => line.trim()).filter(Boolean);
  return {
    description: main.trim(),
    experience: findDetail(details, [t('form.experienceLabel'), 'Experience']),
    equipment: findDetail(details, [t('form.equipmentLabel'), 'Equipment']),
    accessibility: findDetail(details, [t('form.accessibilityLabel'), 'Accessibility']),
  };
}

function findDetail(lines: string[], labels: string[]): string {
  const value = labels
    .map((label) => {
      const prefix = `${label}:`;
      return lines.find((line) => line.toLowerCase().startsWith(prefix.toLowerCase()))
        ?.slice(prefix.length)
        .trim() ?? '';
    })
    .find(Boolean) ?? '';
  return normalizeServiceDetailValue(value);
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

function isGenericListingTitle(title: string, categoryName: string): boolean {
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedCategory = categoryName.trim().toLowerCase();
  if (!normalizedTitle || normalizedTitle.length < 3 || !normalizedCategory) return false;
  const stripped = normalizedTitle
    .replace(/^(i can help with|help with|looking for help with|need help with)\s+/i, '')
    .trim();
  return normalizedTitle === normalizedCategory || stripped === normalizedCategory;
}

const experienceOptions = ['beginner_friendly', 'some_experience', 'experienced', 'professional'] as const;
const equipmentOptions = ['provided', 'partial', 'bring_own', 'not_applicable'] as const;

const experienceLabelKeys: Record<(typeof experienceOptions)[number], string> = {
  beginner_friendly: 'experienceBeginner',
  some_experience: 'experienceSome',
  experienced: 'experienceExperienced',
  professional: 'experienceProfessional',
};

const equipmentLabelKeys: Record<(typeof equipmentOptions)[number], string> = {
  provided: 'equipmentProvidedOption',
  partial: 'equipmentPartial',
  bring_own: 'equipmentBringOwn',
  not_applicable: 'equipmentNa',
};

function normalizeServiceDetailValue(value: string): string {
  const normalized = value.trim().toLowerCase();
  const experienceMatch = experienceOptions.find((option) => (
    option === normalized
    || option.replace(/_/g, ' ') === normalized
    || webDetailAliases[option]?.includes(normalized)
  ));
  if (experienceMatch) return experienceMatch;

  const equipmentMatch = equipmentOptions.find((option) => (
    option === normalized
    || option.replace(/_/g, ' ') === normalized
    || webDetailAliases[option]?.includes(normalized)
  ));
  return equipmentMatch ?? value;
}

const webDetailAliases: Record<string, string[]> = {
  beginner_friendly: ['beginner-friendly'],
  some_experience: ['some experience helpful'],
  experienced: ['experienced practitioner'],
  professional: ['professional / certified', 'professional/certified'],
  provided: ["i'll provide everything needed", 'i will provide everything needed'],
  partial: ['some things needed from you'],
  bring_own: ["you'll need to provide your own", 'you will need to provide your own'],
  not_applicable: ['not applicable'],
};

function formatExperienceDetail(value: string, t: (key: string) => string): string {
  return experienceOptions.includes(value as (typeof experienceOptions)[number])
    ? t(`form.${experienceLabelKeys[value as (typeof experienceOptions)[number]]}`)
    : value;
}

function formatEquipmentDetail(value: string, t: (key: string) => string): string {
  return equipmentOptions.includes(value as (typeof equipmentOptions)[number])
    ? t(`form.${equipmentLabelKeys[value as (typeof equipmentOptions)[number]]}`)
    : value;
}

function getProfileLocation(user: unknown): string {
  if (user && typeof user === 'object' && 'location' in user) {
    return String((user as { location?: string | null }).location ?? '');
  }
  return '';
}
