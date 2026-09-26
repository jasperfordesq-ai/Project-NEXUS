// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Card as HeroCard, Text } from 'heroui-native';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';

import { createGroup, getGroup, getGroupFormCapabilities, updateGroup, uploadGroupImage, type GroupDetail, type GroupParentCandidate, type GroupTemplate } from '@/lib/api/groups';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { resolveImageUrl } from '@/lib/utils/resolveImageUrl';
import { withAlpha } from '@/lib/utils/color';
import { parseDecimalInput } from '@/lib/utils/decimal';
import { describeApiError } from '@/lib/api/describeApiError';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { prepareImageForUpload } from '@/lib/media/prepareImageForUpload';
import { completeGroupCreationOperation, reserveGroupCreationOperation } from '@/lib/groupCreationOperation';
import AppTopBar from '@/components/ui/AppTopBar';
import ChoiceChips from '@/components/ui/ChoiceChips';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import AccentIcon from '@/components/ui/AccentIcon';
import EmptyState from '@/components/ui/EmptyState';
import FormActionFooter from '@/components/ui/FormActionFooter';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import SavedImageRecovery from '@/components/ui/SavedImageRecovery';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { withRouteGate } from '@/components/withRouteGate';

const GROUP_NAME_MIN_LENGTH = 3;
const GROUP_NAME_MAX_LENGTH = 100;
const GROUP_DESCRIPTION_MIN_LENGTH = 20;
const GROUP_DESCRIPTION_MAX_LENGTH = 2000;
const MAX_GROUP_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_GROUP_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function NewGroupRoute() {
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
  const { confirm, confirmDialog } = useConfirm();
  const groupId = Number(params.id);
  const isEditing = Number.isFinite(groupId) && groupId > 0;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [isFederated, setIsFederated] = useState(false);
  const hydratedFederatedVisibilityRef = useRef<string | null>(null);
  const [templates, setTemplates] = useState<GroupTemplate[]>([]);
  const [parentCandidates, setParentCandidates] = useState<GroupParentCandidate[]>([]);
  const [canSelectParent, setCanSelectParent] = useState(false);
  const [parentId, setParentId] = useState<number | null>(null);
  const initialParentIdRef = useRef<number | null>(null);
  const [parentSearch, setParentSearch] = useState('');
  const [capabilitiesLoadFailed, setCapabilitiesLoadFailed] = useState(false);
  const [capabilitiesRetryToken, setCapabilitiesRetryToken] = useState(0);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [existingImage, setExistingImage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const [pendingImageId, setPendingImageId] = useState<number | null>(null);
  const [hasHydratedEdit, setHasHydratedEdit] = useState(false);
  const [editLoadFailed, setEditLoadFailed] = useState(false);
  const [editRetryToken, setEditRetryToken] = useState(0);
  const attemptedEditRetryRef = useRef<number | null>(null);
  // Mount tracking in its own effect: a re-render mid-fetch must not cancel the hydration.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const tRef = useRef(t);
  tRef.current = t;
  const fallbackHref = isEditing
    ? ({ pathname: '/(modals)/group-detail', params: { id: String(groupId) } } as unknown as Href)
    : '/(modals)/groups';

  useEffect(() => {
    if (!isEditing || hasHydratedEdit || attemptedEditRetryRef.current === editRetryToken) return;
    attemptedEditRetryRef.current = editRetryToken;

    setEditLoadFailed(false);
    getGroup(groupId)
      .then((response) => {
        if (!isMountedRef.current) return;
        hydrateFromGroup(response.data);
        setHasHydratedEdit(true);
      })
      .catch(() => {
        if (!isMountedRef.current) return;
        // 🔴 Not a dead form. A failed hydration used to leave empty fields under a live
        // "Update group" button — one tap would have wiped the server record (S4-03).
        setEditLoadFailed(true);
        showToastRef.current({
          title: tRef.current('create.loadFailedTitle'),
          description: tRef.current('create.loadFailed'),
          variant: 'danger',
        });
      });
     
  }, [editRetryToken, groupId, hasHydratedEdit, isEditing]);

  useEffect(() => {
    let isMounted = true;
    setCapabilitiesLoadFailed(false);
    getGroupFormCapabilities()
      .then((response) => {
        if (!isMounted) return;
        setTemplates(response.templates);
        setParentCandidates(response.parentCandidates);
        setCanSelectParent(response.canSelectParent);
      })
      .catch(() => {
        if (!isMounted) return;
        setTemplates([]);
        setParentCandidates([]);
        setCanSelectParent(false);
        setCapabilitiesLoadFailed(true);
      });

    return () => {
      isMounted = false;
    };
  }, [capabilitiesRetryToken]);

  function hydrateFromGroup(group: GroupDetail) {
    setName(group.name ?? '');
    setDescription(group.description ?? '');
    setLocation(group.location ?? '');
    setLatitude(group.latitude !== null && group.latitude !== undefined ? String(group.latitude) : '');
    setLongitude(group.longitude !== null && group.longitude !== undefined ? String(group.longitude) : '');
    setVisibility(group.visibility === 'private' ? 'private' : 'public');
    setIsFederated(group.federated_visibility === 'listed' || group.federated_visibility === 'joinable');
    const hydratedParentId = Number.isInteger(group.parent_id) && Number(group.parent_id) > 0 ? Number(group.parent_id) : null;
    initialParentIdRef.current = hydratedParentId;
    setParentId(hydratedParentId);
    // Remember the exact level so an unrelated edit does not turn "joinable" into "listed"
    // (audit 2026-09-07, C/F-10). The toggle only decides between federated and not.
    hydratedFederatedVisibilityRef.current = group.federated_visibility ?? null;
    setExistingImage(group.image_url ?? group.cover_image ?? null);
    setSelectedImageUri(null);
  }

  // Everything the member can type or choose, compared with the form as first shown.
  const formFingerprint = JSON.stringify([
    name, description, location, latitude, longitude, visibility, isFederated, parentId, selectedTemplateId, selectedImageUri,
  ]);
  const baselineRef = useRef<string | null>(null);
  if (!isEditing && baselineRef.current === null) baselineRef.current = formFingerprint;
  useEffect(() => {
    if (isEditing && hasHydratedEdit && baselineRef.current === null) baselineRef.current = formFingerprint;
  }, [formFingerprint, hasHydratedEdit, isEditing]);
  const isDirty = baselineRef.current !== null && formFingerprint !== baselineRef.current;
  useUnsavedChangesGuard({
    isDirty,
    isSaving: isSubmitting,
    hasSaved,
    confirm,
    title: t('create.unsavedTitle'),
    message: t('create.unsavedMessage'),
    discardLabel: t('create.discard'),
    cancelLabel: t('common:buttons.cancel'),
  });

  const requiredFieldsFilled = name.trim().length > 0
    && description.trim().length > 0
    && (!isEditing || hasHydratedEdit);

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
        mediaTypes: ['images'],
        quality: 0.85,
        allowsMultipleSelection: false,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;

      const asset = result.assets[0];
      if (asset.mimeType && !ALLOWED_GROUP_IMAGE_TYPES.includes(asset.mimeType)) {
        showToast({ title: t('create.validationTitle'), description: t('create.imageTypeError'), variant: 'warning' });
        return;
      }
      /*
        Resize BEFORE the size check, and only apply the check if the resize did not happen.
        See the same block in new-event.tsx: the 5 MB limit was rejecting ordinary phone
        photos the app can now upload comfortably.
      */
      const prepared = await prepareImageForUpload(asset);
      if (prepared.uri === asset.uri && asset.fileSize && asset.fileSize > MAX_GROUP_IMAGE_SIZE) {
        showToast({ title: t('create.validationTitle'), description: t('create.imageSizeError'), variant: 'warning' });
        return;
      }

      setSelectedImageUri(prepared.uri);
    } catch (err) {
      showToast({ title: t('create.imagePickFailedTitle'), description: describeApiError(err, t('create.imagePickFailedDescription')), variant: 'danger' });
    }
  }

  async function submit() {
    if (isEditing && !hasHydratedEdit) {
      showToast({ title: t('create.loadFailedTitle'), description: t('create.loadFailed'), variant: 'danger' });
      return;
    }

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
    const latitudeValue = parseDecimalInput(latitude);
    const longitudeValue = parseDecimalInput(longitude);
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
    let saved = false;
    try {
      const payload = {
        name: trimmedName,
        description: trimmedDescription,
        location: location.trim() || null,
        latitude: latitudeValue,
        longitude: longitudeValue,
        visibility,
        federated_visibility: isFederated
          ? (hydratedFederatedVisibilityRef.current === 'joinable' ? 'joinable' : 'listed')
          : 'none',
        ...(parentId !== null && !isEditing
          ? { parent_id: parentId }
          : (isEditing && parentId !== initialParentIdRef.current ? { parent_id: parentId } : {})),
      } as const;
      const creationOperation = isEditing
        ? null
        : await reserveGroupCreationOperation(JSON.stringify(payload));
      const result = isEditing
        ? await updateGroup(groupId, payload)
        : await createGroup(payload, creationOperation?.key);
      if (creationOperation) await completeGroupCreationOperation(creationOperation);
      saved = true;
      setHasSaved(true);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const id = result.data?.id ?? groupId;
      if (id) {
        if (selectedImageUri) {
          try {
            await uploadGroupImage(id, selectedImageUri);
          } catch (err) {
            showToast({ title: t('create.imageUploadFailedTitle'), description: describeApiError(err, t('create.imageUploadFailedDescription')), variant: 'danger' });
            setPendingImageId(id);
            return;
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

    // 🔴 A rejected save used to fall through to the navigation below and leave the form
    // anyway, taking every typed field with it (S4-02).
    if (!saved) return;

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

  if (pendingImageId !== null) {
    const continueSaved = () => router.replace({ pathname: '/(modals)/group-detail', params: { id: String(pendingImageId) } });
    return <SavedImageRecovery
      title={t('create.imageUploadFailedTitle')}
      message={t('create.imageUploadFailedDescription')}
      uri={selectedImageUri}
      onChoose={pickGroupImage}
      onContinue={continueSaved}
      onRetry={async () => {
        if (!selectedImageUri) return false;
        try { await uploadGroupImage(pendingImageId, selectedImageUri); return true; }
        catch (err) {
          if (isMountedRef.current) showToast({ title: t('create.imageUploadFailedTitle'), description: describeApiError(err, t('create.imageUploadFailedDescription')), variant: 'danger' });
          return false;
        }
      }}
    />;
  }

  return (
    <SafeAreaView testID="new-group-screen" className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar
        title={isEditing ? t('create.editTitle') : t('create.title')}
        backLabel={t('common:back')}
        fallbackHref={fallbackHref}
      />
      {isEditing && editLoadFailed ? (
        <View className="flex-1 justify-center" style={{ flex: 1, backgroundColor: theme.bg }} testID="new-group-load-failed">
          <EmptyState
            icon="people-outline"
            title={t('create.loadFailedTitle')}
            subtitle={t('create.loadFailed')}
            actionLabel={t('common:buttons.retry')}
            onAction={() => setEditRetryToken((value) => value + 1)}
          />
        </View>
      ) : isEditing && !hasHydratedEdit ? (
        <View className="flex-1 items-center justify-center" style={{ flex: 1, backgroundColor: theme.bg }} testID="new-group-loading">
          <LoadingSpinner />
        </View>
      ) : (
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
                <ChoiceChips
                  options={templates.map((template) => ({ value: String(template.id), label: template.name }))}
                  selected={selectedTemplateId !== null ? String(selectedTemplateId) : ''}
                  onSelect={(value) => {
                    const template = templates.find((tpl) => String(tpl.id) === value);
                    if (template) applyTemplate(template);
                  }}
                />
              </View>
            ) : null}

            {canSelectParent || parentId !== null || capabilitiesLoadFailed ? (
              <ParentGroupSelector
                candidates={parentCandidates}
                currentGroupId={isEditing ? groupId : null}
                selectedId={parentId}
                search={parentSearch}
                loadFailed={capabilitiesLoadFailed}
                onSearch={setParentSearch}
                onSelect={setParentId}
                onRetry={() => setCapabilitiesRetryToken((value) => value + 1)}
                t={t}
                theme={theme}
                primary={primary}
              />
            ) : null}

            <View className="gap-2">
              <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('create.visibilityLabel')}</Text>
              <View className="flex-row gap-2">
                <HeroButton
                  className="flex-1"
                  variant={visibility === 'public' ? 'primary' : 'secondary'}
                  onPress={() => setVisibility('public')}
                  accessibilityLabel={t('public')}
                  accessibilityState={{ selected: visibility === 'public' }}
                >
                  {visibility === 'public'
                    ? <AccentIcon name="globe-outline" size={15} />
                    : <Ionicons name="globe-outline" size={15} color={primary} />}
                  <HeroButton.Label>{t('public')}</HeroButton.Label>
                </HeroButton>
                <HeroButton
                  className="flex-1"
                  variant={visibility === 'private' ? 'primary' : 'secondary'}
                  onPress={() => setVisibility('private')}
                  accessibilityLabel={t('private')}
                  accessibilityState={{ selected: visibility === 'private' }}
                >
                  {visibility === 'private'
                    ? <AccentIcon name="lock-closed-outline" size={15} />
                    : <Ionicons name="lock-closed-outline" size={15} color={primary} />}
                  <HeroButton.Label>{t('private')}</HeroButton.Label>
                </HeroButton>
              </View>
            </View>

            <HeroButton
              variant={isFederated ? 'primary' : 'secondary'}
              onPress={() => setIsFederated((value) => !value)}
              accessibilityLabel={t('create.federated')}
              accessibilityState={{ selected: isFederated }}
            >
              {isFederated
                ? <AccentIcon name="git-network-outline" size={15} />
                : <Ionicons name="git-network-outline" size={15} color={primary} />}
              <HeroButton.Label>{t('create.federated')}</HeroButton.Label>
            </HeroButton>

          </HeroCard.Body>
        </HeroCard>
      </ScrollView>
        <FormActionFooter
          title={isEditing ? t('create.editReviewTitle') : t('create.reviewTitle')}
          subtitle={requiredFieldsFilled ? t('create.reviewSubtitle') : t('create.validationRequired')}
          submitLabel={isEditing ? t('create.updateSubmit') : t('create.submit')}
          primary={primary}
          isSubmitting={isSubmitting}
          isDisabled={!requiredFieldsFilled}
          onSubmit={submit}
        />
      </KeyboardAvoidingView>
      )}
      {confirmDialog}
    </SafeAreaView>
  );
}

function ParentGroupSelector({
  candidates,
  currentGroupId,
  selectedId,
  search,
  loadFailed,
  onSearch,
  onSelect,
  onRetry,
  t,
  theme,
  primary,
}: {
  candidates: GroupParentCandidate[];
  currentGroupId: number | null;
  selectedId: number | null;
  search: string;
  loadFailed: boolean;
  onSearch: (value: string) => void;
  onSelect: (value: number | null) => void;
  onRetry: () => void;
  t: ReturnType<typeof useTranslation>['t'];
  theme: ReturnType<typeof useTheme>;
  primary: string;
}) {
  const excluded = new Set<number>();
  if (currentGroupId !== null) {
    excluded.add(currentGroupId);
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of candidates) {
        if (candidate.parent_id !== null && excluded.has(candidate.parent_id) && !excluded.has(candidate.id)) {
          excluded.add(candidate.id);
          changed = true;
        }
      }
    }
  }
  const needle = search.trim().toLocaleLowerCase();
  const choices = candidates.filter((candidate) => !excluded.has(candidate.id)
    && (needle === '' || candidate.name.toLocaleLowerCase().includes(needle)));
  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? null;

  return (
    <View className="gap-3 rounded-panel-inner border p-3" style={{ borderColor: theme.border, backgroundColor: theme.bg }}>
      <View className="gap-1">
        <Text className="text-sm font-bold" style={{ color: theme.text }}>{t('create.parentLabel')}</Text>
        <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('create.parentHint')}</Text>
      </View>
      {selected ? (
        <Text testID="selected-parent-group" className="text-sm font-semibold" style={{ color: primary }}>
          {t('create.parentSelected', { name: selected.name })}
        </Text>
      ) : null}
      {loadFailed ? (
        <View className="gap-2">
          <Text className="text-sm" style={{ color: theme.error }}>{t('create.parentLoadFailed')}</Text>
          <HeroButton variant="secondary" onPress={onRetry}><HeroButton.Label>{t('common:buttons.retry')}</HeroButton.Label></HeroButton>
        </View>
      ) : (
        <>
          <Input
            label={t('create.parentSearchLabel')}
            value={search}
            onChangeText={onSearch}
            placeholder={t('create.parentSearchPlaceholder')}
            placeholderTextColor={theme.textMuted}
            style={{ color: theme.text }}
          />
          <HeroButton
            variant={selectedId === null ? 'primary' : 'secondary'}
            accessibilityState={{ selected: selectedId === null }}
            onPress={() => onSelect(null)}
          >
            <HeroButton.Label>{t('create.noParent')}</HeroButton.Label>
          </HeroButton>
          {choices.map((candidate) => (
            <HeroButton
              key={candidate.id}
              variant={selectedId === candidate.id ? 'primary' : 'secondary'}
              accessibilityState={{ selected: selectedId === candidate.id }}
              onPress={() => onSelect(candidate.id)}
            >
              <HeroButton.Label>{candidate.name}</HeroButton.Label>
            </HeroButton>
          ))}
          {choices.length === 0 ? (
            <Text className="text-sm" style={{ color: theme.textMuted }}>{t('create.parentEmpty')}</Text>
          ) : null}
        </>
      )}
    </View>
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

export default withRouteGate(NewGroupRoute, 'new-group');
