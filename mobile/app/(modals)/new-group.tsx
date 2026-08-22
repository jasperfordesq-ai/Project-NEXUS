// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Button as HeroButton, Card as HeroCard, TagGroup, Text } from 'heroui-native';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';

import { createGroup, getGroup, getGroupTemplates, updateGroup, uploadGroupImage, type GroupDetail, type GroupTemplate } from '@/lib/api/groups';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { resolveImageUrl } from '@/lib/utils/resolveImageUrl';
import { contrastText, withAlpha } from '@/lib/utils/color';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import FormActionFooter from '@/components/ui/FormActionFooter';
import Input from '@/components/ui/Input';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';

const GROUP_NAME_MIN_LENGTH = 3;
const GROUP_NAME_MAX_LENGTH = 100;
const GROUP_DESCRIPTION_MIN_LENGTH = 20;
const GROUP_DESCRIPTION_MAX_LENGTH = 2000;
const MAX_GROUP_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_GROUP_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function toNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function NewGroupRoute() {
  return (
    <ModalErrorBoundary>
      <NewGroupScreen />
    </ModalErrorBoundary>
  );
}

function NewGroupScreen() {
  const { t } = useTranslation(['groups', 'common']);
  const params = useLocalSearchParams<{ id?: string }>();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const groupId = Number(params.id);
  const isEditing = Number.isFinite(groupId) && groupId > 0;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [isFederated, setIsFederated] = useState(false);
  const [templates, setTemplates] = useState<GroupTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [existingImage, setExistingImage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasHydratedEdit, setHasHydratedEdit] = useState(false);
  const fallbackHref = isEditing
    ? ({ pathname: '/(modals)/group-detail', params: { id: String(groupId) } } as unknown as Href)
    : '/(tabs)/groups';

  useEffect(() => {
    if (!isEditing || hasHydratedEdit) return;

    let isMounted = true;
    getGroup(groupId)
      .then((response) => {
        if (!isMounted) return;
        hydrateFromGroup(response.data);
        setHasHydratedEdit(true);
      })
      .catch(() => {
        if (!isMounted) return;
        showToast({ title: t('create.loadFailedTitle'), description: t('create.loadFailed'), variant: 'danger' });
      });

    return () => {
      isMounted = false;
    };
  }, [groupId, hasHydratedEdit, isEditing, showToast, t]);

  useEffect(() => {
    if (isEditing) return;

    let isMounted = true;
    getGroupTemplates()
      .then((response) => {
        if (!isMounted) return;
        const items = Array.isArray(response) ? response : response.data;
        setTemplates(Array.isArray(items) ? items : []);
      })
      .catch(() => {
        if (isMounted) setTemplates([]);
      });

    return () => {
      isMounted = false;
    };
  }, [isEditing]);

  function hydrateFromGroup(group: GroupDetail) {
    setName(group.name ?? '');
    setDescription(group.description ?? '');
    setLocation(group.location ?? '');
    setLatitude(group.latitude !== null && group.latitude !== undefined ? String(group.latitude) : '');
    setLongitude(group.longitude !== null && group.longitude !== undefined ? String(group.longitude) : '');
    setVisibility(group.visibility === 'private' ? 'private' : 'public');
    setIsFederated(group.federated_visibility === 'listed' || group.federated_visibility === 'joinable');
    setExistingImage(group.image_url ?? group.cover_image ?? null);
    setSelectedImageUri(null);
  }

  function applyTemplate(template: GroupTemplate) {
    setSelectedTemplateId(template.id);
    if (template.default_visibility === 'private') {
      setVisibility('private');
    } else if (template.default_visibility === 'public') {
      setVisibility('public');
    }
  }

  async function pickGroupImage() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        allowsMultipleSelection: false,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;

      const asset = result.assets[0];
      if (asset.mimeType && !ALLOWED_GROUP_IMAGE_TYPES.includes(asset.mimeType)) {
        showToast({ title: t('create.validationTitle'), description: t('create.imageTypeError'), variant: 'warning' });
        return;
      }
      if (asset.fileSize && asset.fileSize > MAX_GROUP_IMAGE_SIZE) {
        showToast({ title: t('create.validationTitle'), description: t('create.imageSizeError'), variant: 'warning' });
        return;
      }

      setSelectedImageUri(asset.uri);
    } catch {
      showToast({ title: t('create.imagePickFailedTitle'), description: t('create.imagePickFailedDescription'), variant: 'danger' });
    }
  }

  async function submit() {
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();

    if (!trimmedName || !trimmedDescription) {
      showToast({ title: t('create.validationTitle'), description: t('create.validationRequired'), variant: 'warning' });
      return;
    }

    if (trimmedName.length < GROUP_NAME_MIN_LENGTH || trimmedName.length > GROUP_NAME_MAX_LENGTH) {
      showToast({ title: t('create.validationTitle'), description: t('create.validationNameLength'), variant: 'warning' });
      return;
    }

    if (trimmedDescription.length < GROUP_DESCRIPTION_MIN_LENGTH || trimmedDescription.length > GROUP_DESCRIPTION_MAX_LENGTH) {
      showToast({ title: t('create.validationTitle'), description: t('create.validationDescriptionLength'), variant: 'warning' });
      return;
    }

    const hasLatitude = latitude.trim().length > 0;
    const hasLongitude = longitude.trim().length > 0;
    const latitudeValue = toNumber(latitude);
    const longitudeValue = toNumber(longitude);
    if (
      hasLatitude !== hasLongitude
      || (hasLatitude && (latitudeValue === null || latitudeValue < -90 || latitudeValue > 90))
      || (hasLongitude && (longitudeValue === null || longitudeValue < -180 || longitudeValue > 180))
    ) {
      showToast({ title: t('create.validationTitle'), description: t('create.invalidCoordinates'), variant: 'warning' });
      return;
    }

    setIsSubmitting(true);
    let successDestination: Parameters<typeof router.push>[0] | null = null;
    try {
      const payload = {
        name: trimmedName,
        description: trimmedDescription,
        location: location.trim() || null,
        latitude: latitudeValue,
        longitude: longitudeValue,
        visibility,
        federated_visibility: isFederated ? 'listed' : 'none',
      } as const;
      const result = isEditing ? await updateGroup(groupId, payload) : await createGroup(payload);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const id = result.data?.id ?? groupId;
      if (id) {
        if (selectedImageUri) {
          try {
            await uploadGroupImage(id, selectedImageUri);
          } catch {
            showToast({ title: t('create.imageUploadFailedTitle'), description: t('create.imageUploadFailedDescription'), variant: 'danger' });
          }
        }
        successDestination = { pathname: '/(modals)/group-detail', params: { id: String(id) } };
      } else {
        // No id came back, so there is nothing to land on — the else branch below leaves the form.
      }
    } catch (error) {
      showToast({
        title: isEditing ? t('create.saveFailedTitle') : t('create.failedTitle'),
        description: error instanceof Error ? error.message : (isEditing ? t('create.saveFailedDescription') : t('create.failedDescription')),
        variant: 'danger',
      });
    } finally {
      setIsSubmitting(false);
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
    // `replace` lands on the created group whether or not there is a back stack, and it is
    // also the right history: going "back" to a form whose contents have already been
    // posted is a duplicate-post trap in itself.
    if (successDestination) {
      setTimeout(() => router.replace(successDestination), 0);
    } else {
      setTimeout(() => {
        if (typeof router.canGoBack === 'function' && router.canGoBack()) router.back();
        else router.replace('/(modals)/groups');
      }, 0);
    }
  }

  return (
    <SafeAreaView testID="new-group-screen" className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar
        title={isEditing ? t('create.editTitle') : t('create.title')}
        backLabel={t('common:back')}
        fallbackHref={fallbackHref}
      />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.bg }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView
        testID="new-group-scroll"
        className="flex-1"
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{ flexGrow: 1, padding: 16, paddingBottom: 120, backgroundColor: theme.bg }}
        keyboardShouldPersistTaps="handled"
      >
        <HeroCard className="mb-4 overflow-hidden rounded-panel p-0">
          <View className="h-1.5" style={{ backgroundColor: primary }} />
          <HeroCard.Body className="gap-4 p-4">
            <View className="flex-row items-start gap-3">
              <View className="size-13 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                <Ionicons name="people-outline" size={25} color={primary} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('create.eyebrow')}</Text>
                <Text className="text-2xl font-bold" style={{ color: theme.text }}>{isEditing ? t('create.editTitle') : t('create.title')}</Text>
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('create.subtitle')}</Text>
              </View>
            </View>
          </HeroCard.Body>
        </HeroCard>

        <HeroCard className="rounded-panel p-0">
          <HeroCard.Body className="gap-4 p-4">
            <FormField label={t('create.nameLabel')} value={name} onChangeText={setName} placeholder={t('create.namePlaceholder')} theme={theme} />
            <FormField label={t('create.descriptionLabel')} value={description} onChangeText={setDescription} placeholder={t('create.descriptionPlaceholder')} theme={theme} multiline />
            <View className="gap-3 rounded-panel-inner border p-3" style={{ borderColor: theme.border, backgroundColor: theme.bg }}>
              <View className="flex-row items-start gap-3">
                <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
                  <Ionicons name="image-outline" size={18} color={primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-bold" style={{ color: theme.text }}>{t('create.imageLabel')}</Text>
                  <Text className="text-xs leading-5" style={{ color: theme.textMuted }}>{t('create.imageHint')}</Text>
                </View>
              </View>
              {selectedImageUri || existingImage ? (
                <View className="overflow-hidden rounded-panel-inner border" style={{ borderColor: theme.border }}>
                  <Image
                    source={{ uri: selectedImageUri ?? resolveImageUrl(existingImage) ?? undefined }}
                    style={{ width: '100%', height: 180, backgroundColor: theme.surface }}
                    contentFit="cover"
                  />
                  <View className="flex-row gap-2 p-3" style={{ backgroundColor: theme.surface }}>
                    <HeroButton className="flex-1" variant="secondary" onPress={() => void pickGroupImage()}>
                      <Ionicons name="image-outline" size={16} color={primary} />
                      <HeroButton.Label>{t('create.replaceImage')}</HeroButton.Label>
                    </HeroButton>
                    {selectedImageUri ? (
                      <HeroButton className="flex-1" variant="danger-soft" onPress={() => setSelectedImageUri(null)}>
                        <Ionicons name="trash-outline" size={16} color={theme.error} />
                        <HeroButton.Label>{t('create.removeImage')}</HeroButton.Label>
                      </HeroButton>
                    ) : null}
                  </View>
                </View>
              ) : (
                <HeroButton variant="secondary" onPress={() => void pickGroupImage()}>
                  <Ionicons name="image-outline" size={16} color={primary} />
                  <HeroButton.Label>{t('create.addImage')}</HeroButton.Label>
                </HeroButton>
              )}
            </View>
            <FormField label={t('create.locationLabel')} value={location} onChangeText={setLocation} placeholder={t('create.locationPlaceholder')} theme={theme} />
            <View className="gap-3 rounded-panel-inner border p-3" style={{ borderColor: theme.border, backgroundColor: withAlpha(primary, 0.06) }}>
              <View className="flex-row items-start gap-3">
                <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                  <Ionicons name="navigate-outline" size={18} color={primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-bold" style={{ color: theme.text }}>{t('create.coordinatesLabel')}</Text>
                  <Text className="text-xs leading-5" style={{ color: theme.textSecondary }}>{t('create.coordinatesHint')}</Text>
                </View>
              </View>
              <View className="flex-row gap-3">
                <View className="min-w-0 flex-1">
                  <FormField label={t('create.latitudeLabel')} value={latitude} onChangeText={setLatitude} placeholder={t('create.latitudePlaceholder')} theme={theme} keyboardType="decimal-pad" />
                </View>
                <View className="min-w-0 flex-1">
                  <FormField label={t('create.longitudeLabel')} value={longitude} onChangeText={setLongitude} placeholder={t('create.longitudePlaceholder')} theme={theme} keyboardType="decimal-pad" />
                </View>
              </View>
            </View>

            {!isEditing && templates.length > 0 ? (
              <View className="gap-2">
                <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('create.templateLabel')}</Text>
                <TagGroup
                  size="sm"
                  selectionMode="single"
                  selectedKeys={selectedTemplateId !== null ? [selectedTemplateId] : []}
                  onSelectionChange={(keys) => {
                    const id = Array.from(keys)[0];
                    const template = templates.find((tpl) => tpl.id === id);
                    if (template) applyTemplate(template);
                  }}
                >
                  <TagGroup.List>
                    {templates.map((template) => {
                      const isSelected = selectedTemplateId === template.id;
                      return (
                        <TagGroup.Item
                          key={template.id}
                          id={template.id}
                        >
                          <TagGroup.ItemLabel style={isSelected ? { color: contrastText(primary) } : undefined}>
                            {template.name}
                          </TagGroup.ItemLabel>
                        </TagGroup.Item>
                      );
                    })}
                  </TagGroup.List>
                </TagGroup>
              </View>
            ) : null}

            <View className="gap-2">
              <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('create.visibilityLabel')}</Text>
              <View className="flex-row gap-2">
                <HeroButton className="flex-1" variant={visibility === 'public' ? 'primary' : 'secondary'} onPress={() => setVisibility('public')}>
                  <Ionicons name="globe-outline" size={15} color={visibility === 'public' ? '#fff' : primary} />
                  <HeroButton.Label>{t('public')}</HeroButton.Label>
                </HeroButton>
                <HeroButton className="flex-1" variant={visibility === 'private' ? 'primary' : 'secondary'} onPress={() => setVisibility('private')}>
                  <Ionicons name="lock-closed-outline" size={15} color={visibility === 'private' ? '#fff' : primary} />
                  <HeroButton.Label>{t('private')}</HeroButton.Label>
                </HeroButton>
              </View>
            </View>

            <HeroButton variant={isFederated ? 'primary' : 'secondary'} onPress={() => setIsFederated((value) => !value)}>
              <Ionicons name="git-network-outline" size={15} color={isFederated ? '#fff' : primary} />
              <HeroButton.Label>{t('create.federated')}</HeroButton.Label>
            </HeroButton>

          </HeroCard.Body>
        </HeroCard>
      </ScrollView>
        <FormActionFooter
          title={isEditing ? t('create.editReviewTitle') : t('create.reviewTitle')}
          subtitle={t('create.reviewSubtitle')}
          submitLabel={isEditing ? t('create.updateSubmit') : t('create.submit')}
          primary={primary}
          isSubmitting={isSubmitting}
          onSubmit={submit}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  theme,
  multiline = false,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  theme: ReturnType<typeof useTheme>;
  multiline?: boolean;
  keyboardType?: 'default' | 'decimal-pad';
}) {
  return (
    <View>
      <Input
        label={label}
        style={{ color: theme.text, minHeight: multiline ? 112 : undefined, textAlignVertical: multiline ? 'top' : 'center' }}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        keyboardType={keyboardType}
      />
    </View>
  );
}
