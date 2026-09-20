// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from '@/lib/haptics';
import { Card as HeroCard, Description, Spinner } from 'heroui-native';
import { Button as HeroButton } from '@/components/ui/NativeButton';

import { useTranslation } from 'react-i18next';

import { updateAvatar, updateProfile, type UpdateProfilePayload } from '@/lib/api/profile';
import { getMe, type User } from '@/lib/api/auth';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { storage } from '@/lib/storage';
import { STORAGE_KEYS } from '@/lib/constants';
import { describeApiError } from '@/lib/api/describeApiError';
import { prepareImageForUpload } from '@/lib/media/prepareImageForUpload';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import Avatar from '@/components/ui/Avatar';
import FormActionFooter from '@/components/ui/FormActionFooter';
import ErrorState from '@/components/ui/ErrorState';
import Input from '@/components/ui/Input';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { withRouteGate } from '@/components/withRouteGate';

// E.164-ish: optional + then digits, spaces, dashes — at least 7 digits total
const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/;

interface FieldErrors {
  firstName?: string;
  phone?: string;
}

function EditProfileScreenInner() {
  const { t } = useTranslation(['profile', 'common']);
  const { user, refreshUser } = useAuth();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();

  const fullUser = user as User | null;

  const [firstName, setFirstName] = useState(fullUser?.first_name ?? '');
  const [lastName, setLastName] = useState(fullUser?.last_name ?? '');
  const [bio, setBio] = useState(fullUser?.bio ?? '');
  const [location, setLocation] = useState(fullUser?.location ?? '');
  const [phone, setPhone] = useState(fullUser?.phone ?? '');
  const [baselineProfile, setBaselineProfile] = useState({
    firstName: fullUser?.first_name ?? '',
    lastName: fullUser?.last_name ?? '',
    bio: fullUser?.bio ?? '',
    location: fullUser?.location ?? '',
    phone: fullUser?.phone ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarUri, setAvatarUri] = useState(fullUser?.avatar_url ?? null);
  const latestAvatarUriRef = useRef<string | null>(fullUser?.avatar_url ?? null);
  const latestUserRef = useRef<User | null>(fullUser);
  const avatarUpdatedLocallyRef = useRef(false);
  const [hydrating, setHydrating] = useState(false);
  const [hydrationFailed, setHydrationFailed] = useState(false);
  const [hasHydratedFullProfile, setHasHydratedFullProfile] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const saveInFlightRef = useRef(false);
  const avatarInFlightRef = useRef(false);
  const draftRevisionRef = useRef(0);
  const hydrationBaselineRevisionRef = useRef(draftRevisionRef.current);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Track whether the form has unsaved changes
  const isDirty =
    firstName !== baselineProfile.firstName ||
    lastName !== baselineProfile.lastName ||
    bio !== baselineProfile.bio ||
    location !== baselineProfile.location ||
    phone !== baselineProfile.phone;

  function applyProfileData(profile: Partial<User>) {
    const nextAvatarUri = avatarUpdatedLocallyRef.current
      ? latestAvatarUriRef.current
      : profile.avatar_url ?? null;
    const nextProfile = {
      firstName: profile.first_name ?? '',
      lastName: profile.last_name ?? '',
      bio: decodeHtmlEntities(profile.bio ?? ''),
      location: profile.location ?? '',
      phone: profile.phone ?? '',
    };
    setFirstName(nextProfile.firstName);
    setLastName(nextProfile.lastName);
    setBio(nextProfile.bio);
    setLocation(nextProfile.location);
    setPhone(nextProfile.phone);
    setBaselineProfile(nextProfile);
    latestAvatarUriRef.current = nextAvatarUri;
    setAvatarUri(nextAvatarUri);
  }

  async function handlePickAvatar() {
    if (!isMountedRef.current || avatarInFlightRef.current || saveInFlightRef.current) return;
    avatarInFlightRef.current = true;
    setUploadingAvatar(true);

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!isMountedRef.current) return;
      if (!permission.granted) {
        showToast({ title: t('permissionNeeded'), description: t('permissionMessage'), variant: 'warning' });
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        allowsMultipleSelection: false,
      });

      if (!isMountedRef.current || result.canceled || !result.assets?.[0]?.uri) return;

      const prepared = await prepareImageForUpload(result.assets[0]);
      if (!isMountedRef.current) return;
      const response = await updateAvatar(prepared.uri);
      if (!isMountedRef.current) return;
      const nextAvatarUrl = withImageVersion(response.data.avatar_url);
      avatarUpdatedLocallyRef.current = true;
      latestAvatarUriRef.current = nextAvatarUrl;
      if (isMountedRef.current) setAvatarUri(nextAvatarUrl);

      const currentUser = latestUserRef.current;
      if (currentUser) {
        const updatedUser = { ...currentUser, avatar_url: nextAvatarUrl };
        latestUserRef.current = updatedUser;
        refreshUser(updatedUser);
        // The upload is already committed. A failed local cache refresh must not report
        // the avatar as failed or invite a second upload.
        await storage.setJson(STORAGE_KEYS.USER_DATA, updatedUser).catch(() => undefined);
      }

      if (isMountedRef.current) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      if (!isMountedRef.current) return;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('uploadFailed'), description: describeApiError(err, t('uploadFailedMessage')), variant: 'danger' });
    } finally {
      avatarInFlightRef.current = false;
      if (isMountedRef.current) setUploadingAvatar(false);
    }
  }

  useEffect(() => {
    if (!latestUserRef.current || hasHydratedFullProfile) return;
    let isMounted = true;

    async function hydrateProfile() {
      const startingDraftRevision = hydrationBaselineRevisionRef.current;
      setHydrating(true);
      setHydrationFailed(false);
      try {
        const response = await getMe();
        if (!isMounted) return;
        const nextUser = avatarUpdatedLocallyRef.current
          ? { ...response.data, avatar_url: latestAvatarUriRef.current }
          : response.data;
        if (draftRevisionRef.current === startingDraftRevision) {
          applyProfileData(nextUser);
        }
        latestUserRef.current = nextUser;
        refreshUser(nextUser);
        await storage.setJson(STORAGE_KEYS.USER_DATA, nextUser).catch(() => undefined);
      } catch {
        if (!isMounted) return;
        setHydrationFailed(true);
        if (draftRevisionRef.current === startingDraftRevision) {
          applyProfileData((latestUserRef.current ?? {}) as Partial<User>);
        }
      } finally {
        if (isMounted) {
          setHasHydratedFullProfile(true);
          setHydrating(false);
        }
      }
    }

    void hydrateProfile();
    return () => {
      isMounted = false;
    };
  }, [hasHydratedFullProfile, refreshUser]);

  /*
    🔴 This screen kept its own `beforeRemove` + `preventDefault()` copy of the unsaved
    guard long after the shared hook was extracted FROM it, so the app carried two
    implementations of the same protection and only one of them was ever corrected. Both
    were also built on a mechanism React Navigation says does not work properly on a
    native stack, which is what Expo Router's `Stack` resolves to (audit 2026-09-06, F08).
    There is now one implementation, and it is the supported one.
  */
  useUnsavedChangesGuard({
    isDirty,
    isSaving: saving,
    confirm,
    title: t('edit.unsavedTitle'),
    message: t('edit.unsavedMessage'),
    discardLabel: t('edit.discard'),
    cancelLabel: t('common:buttons.cancel'),
  });

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!firstName.trim()) {
      errors.firstName = t('edit.firstNameRequired');
    }
    if (phone.trim() && !PHONE_RE.test(phone.trim())) {
      errors.phone = t('edit.phoneInvalid');
    }
    return errors;
  }

  // The first field error, so the footer can say what is wrong without the member scrolling.
  const firstFooterError = fieldErrors.firstName ?? fieldErrors.phone ?? null;

  async function handleSave() {
    if (!isMountedRef.current || saveInFlightRef.current || avatarInFlightRef.current || hydrating) return;
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    const submittedRevision = draftRevisionRef.current;
    saveInFlightRef.current = true;
    setSaving(true);
    try {
      const payload: UpdateProfilePayload = {
        ...(firstName !== baselineProfile.firstName ? { first_name: firstName.trim() } : {}),
        ...(lastName !== baselineProfile.lastName ? { last_name: lastName.trim() } : {}),
        ...(bio !== baselineProfile.bio ? { bio: bio.trim() } : {}),
        ...(location !== baselineProfile.location ? { location: location.trim() } : {}),
        ...(phone !== baselineProfile.phone ? { phone: phone.trim() } : {}),
      };

      const response = await updateProfile(payload);
      if (!isMountedRef.current) return;

      // The server response is authoritative. Cache persistence is best-effort after the
      // committed update and cannot turn success into a retryable failure.
      latestUserRef.current = response.data;
      refreshUser(response.data);
      setBaselineProfile({
        firstName: response.data.first_name ?? '',
        lastName: response.data.last_name ?? '',
        bio: decodeHtmlEntities(response.data.bio ?? ''),
        location: response.data.location ?? '',
        phone: response.data.phone ?? '',
      });
      await storage.setJson(STORAGE_KEYS.USER_DATA, response.data).catch(() => undefined);
      if (!isMountedRef.current) return;
      // Preserve native input events queued before the fields became read-only.
      if (draftRevisionRef.current !== submittedRevision) return;

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('edit.saved'), description: t('edit.savedMessage'), variant: 'success' });
      router.back();
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const msg = describeApiError(err, t('edit.saveError'));
      showToast({ title: t('common:errors.generic'), description: msg, variant: 'danger' });
    } finally {
      saveInFlightRef.current = false;
      if (isMountedRef.current) setSaving(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={t('edit.title')} backLabel={t('common:buttons.back')} fallbackHref="/(modals)/member-profile" />
      <KeyboardAvoidingView
        className="flex-1"
        style={{ flex: 1, backgroundColor: theme.bg }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={{ flex: 1, backgroundColor: theme.bg }}
          contentContainerStyle={{ flexGrow: 1, padding: 16, paddingBottom: 116, gap: 12 }}
          keyboardShouldPersistTaps="handled"
        >
          {hydrationFailed ? (
            <ErrorState testID="profile-load-error" onRetry={() => setHasHydratedFullProfile(false)} />
          ) : null}

          <HeroCard variant="default" className="overflow-hidden">
            <View className="h-1 w-full" style={{ backgroundColor: primary }} />
            <HeroCard.Body className="gap-4 px-4 py-5">
              <View className="flex-row items-center gap-3">
                <Avatar
                  uri={avatarUri}
                  name={`${firstName} ${lastName}`.trim() || t('myProfile')}
                  size={58}
                />
                <View className="min-w-0 flex-1">
                  <Text className="text-xl font-bold" style={{ color: theme.text }} numberOfLines={1}>
                    {t('edit.title')}
                  </Text>
                  <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }}>
                    {hydrating ? t('edit.loadingProfile') : t('edit.subtitle')}
                  </Text>
                </View>
              </View>
              <View className="flex-row gap-2">
                <HeroButton
                  className="flex-1"
                  variant="secondary"
                  onPress={() => void handlePickAvatar()}
                  isDisabled={uploadingAvatar || saving}
                  accessibilityLabel={t('changePhoto')}
                >
                  {uploadingAvatar ? (
                    <Spinner size="sm" />
                  ) : (
                    <Ionicons name="camera-outline" size={17} color={primary} />
                  )}
                  <HeroButton.Label>
                    {uploadingAvatar ? t('edit.uploadingPhoto') : t('changePhoto')}
                  </HeroButton.Label>
                </HeroButton>
              </View>
            </HeroCard.Body>
          </HeroCard>

          <HeroCard variant="secondary">
            <HeroCard.Body className="gap-4 px-4 py-4">
              <SectionTitle icon="person-outline" title={t('edit.identity')} primary={primary} />
              <View className="flex-row gap-3">
                <ProfileField
                  label={t('edit.firstName')}
                  value={firstName}
                  onChangeText={(v) => {
                    draftRevisionRef.current += 1;
                    setFirstName(v);
                    if (fieldErrors.firstName) setFieldErrors((e) => ({ ...e, firstName: undefined }));
                  }}
                  placeholder={t('edit.firstName')}
                  error={fieldErrors.firstName}
                  autoCapitalize="words"
                  maxLength={50}
                  theme={theme}
                  className="flex-1"
                  editable={!saving && !uploadingAvatar}
                />
                <ProfileField
                  label={t('edit.lastName')}
                  value={lastName}
                  onChangeText={(value) => { draftRevisionRef.current += 1; setLastName(value); }}
                  placeholder={t('edit.lastName')}
                  autoCapitalize="words"
                  maxLength={50}
                  theme={theme}
                  className="flex-1"
                  editable={!saving && !uploadingAvatar}
                />
              </View>
            </HeroCard.Body>
          </HeroCard>

          <HeroCard variant="secondary">
            <HeroCard.Body className="gap-4 px-4 py-4">
              <SectionTitle icon="reader-outline" title={t('edit.profileStory')} primary={primary} />
              <ProfileField
                label={t('edit.aboutYou')}
                value={bio}
                onChangeText={(value) => { draftRevisionRef.current += 1; setBio(value); }}
                placeholder={t('edit.aboutPlaceholder')}
                multiline
                numberOfLines={5}
                maxLength={500}
                theme={theme}
                inputClassName="min-h-[124px] pt-3"
                helper={t('edit.bioHint', { count: Math.max(0, 500 - bio.length) })}
                editable={!saving && !uploadingAvatar}
              />
            </HeroCard.Body>
          </HeroCard>

          <HeroCard variant="secondary">
            <HeroCard.Body className="gap-4 px-4 py-4">
              <SectionTitle icon="location-outline" title={t('edit.contactDetails')} primary={primary} />
              <ProfileField
                label={t('edit.location')}
                value={location}
                onChangeText={(value) => { draftRevisionRef.current += 1; setLocation(value); }}
                placeholder={t('edit.locationPlaceholder')}
                autoCapitalize="words"
                theme={theme}
                editable={!saving && !uploadingAvatar}
              />
              <ProfileField
                label={t('edit.phoneOptional')}
                value={phone}
                onChangeText={(v) => {
                  draftRevisionRef.current += 1;
                  setPhone(v);
                  if (fieldErrors.phone) setFieldErrors((e) => ({ ...e, phone: undefined }));
                }}
                placeholder={t('edit.phonePlaceholder')}
                keyboardType="phone-pad"
                error={fieldErrors.phone}
                theme={theme}
                editable={!saving && !uploadingAvatar}
              />
            </HeroCard.Body>
          </HeroCard>
        </ScrollView>

        <FormActionFooter
          title={t('edit.reviewTitle')}
          /*
            🔴 S3-14: a failed validation marked the FIRST NAME field at the top of a long
            scroll view and left this copy unchanged, so a member at the bottom saw the
            button do nothing and had no idea why (audit 2026-09-06).
          */
          subtitle={firstFooterError ?? (isDirty ? t('edit.reviewSubtitleDirty') : t('edit.reviewSubtitleClean'))}
          submitLabel={saving ? t('edit.saving') : t('edit.saveChanges')}
          secondaryLabel={t('edit.cancel')}
          primary={primary}
          isSubmitting={saving}
          isDisabled={!isDirty || hydrating || uploadingAvatar}
          onSubmit={() => void handleSave()}
          onSecondary={() => router.back()}
        />
      </KeyboardAvoidingView>
      {confirmDialog}
    </SafeAreaView>
  );
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function withImageVersion(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${Date.now()}`;
}

type ProfileFieldProps = React.ComponentProps<typeof Input> & {
  label: string;
  value: string;
  error?: string;
  helper?: string;
  theme: ReturnType<typeof useTheme>;
  className?: string;
  inputClassName?: string;
};

function ProfileField({
  label,
  value,
  error,
  helper,
  theme,
  className,
  inputClassName,
  multiline,
  ...inputProps
}: ProfileFieldProps) {
  return (
    <View className={`gap-1.5 ${className ?? ''}`}>
      <Text className="text-xs font-semibold uppercase text-muted-foreground">{label}</Text>
      <Input
        {...inputProps}
        error={error}
        value={value}
        multiline={multiline}
        className={`min-h-[46px] ${inputClassName ?? ''}`}
        style={{
          color: theme.text,
          textAlignVertical: multiline ? 'top' : 'center',
        }}
        placeholderTextColor={theme.textMuted}
        accessibilityLabel={label}
      />
      {helper ? (
        <Description isInvalid={!!error} hideOnInvalid className="text-xs">{helper}</Description>
      ) : null}
    </View>
  );
}

function SectionTitle({ icon, title, primary }: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; primary: string }) {
  return (
    <View className="flex-row items-center gap-2">
      <Ionicons name={icon} size={18} color={primary} />
      <Text className="text-base font-semibold text-foreground">{title}</Text>
    </View>
  );
}

function EditProfileScreen() {
  return (
    <ModalErrorBoundary>
      <EditProfileScreenInner />
    </ModalErrorBoundary>
  );
}

function EditProfileRoute() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  return <EditProfileScreen key={`${tenant?.id ?? tenant?.slug ?? 'tenant'}:${user?.id ?? 'guest'}`} />;
}

export default withRouteGate(EditProfileRoute, 'edit-profile');
