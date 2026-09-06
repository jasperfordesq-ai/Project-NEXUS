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
import { router, useNavigation } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from '@/lib/haptics';
import { Button as HeroButton, Card as HeroCard, Description, Spinner } from 'heroui-native';

import { useTranslation } from 'react-i18next';

import { updateAvatar, updateProfile, type UpdateProfilePayload } from '@/lib/api/profile';
import { getMe, type User } from '@/lib/api/auth';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { storage } from '@/lib/storage';
import { STORAGE_KEYS } from '@/lib/constants';
import { describeApiError } from '@/lib/api/describeApiError';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import Avatar from '@/components/ui/Avatar';
import FormActionFooter from '@/components/ui/FormActionFooter';
import Input from '@/components/ui/Input';
import OfflineBanner from '@/components/OfflineBanner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';

// E.164-ish: optional + then digits, spaces, dashes — at least 7 digits total
const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/;

interface FieldErrors {
  firstName?: string;
  phone?: string;
}

function EditProfileScreenInner() {
  const { t } = useTranslation(['profile', 'common']);
  const navigation = useNavigation();
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
  const avatarUpdatedLocallyRef = useRef(false);
  const [hydrating, setHydrating] = useState(false);
  const [hasHydratedFullProfile, setHasHydratedFullProfile] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

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
    if (uploadingAvatar) return;

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showToast({ title: t('permissionNeeded'), description: t('permissionMessage'), variant: 'warning' });
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        allowsMultipleSelection: false,
      });

      if (result.canceled || !result.assets?.[0]?.uri) return;

      setUploadingAvatar(true);
      const response = await updateAvatar(result.assets[0].uri);
      const nextAvatarUrl = withImageVersion(response.data.avatar_url);
      avatarUpdatedLocallyRef.current = true;
      latestAvatarUriRef.current = nextAvatarUrl;
      setAvatarUri(nextAvatarUrl);

      if (fullUser) {
        const updatedUser = { ...fullUser, avatar_url: nextAvatarUrl };
        refreshUser(updatedUser);
        await storage.setJson(STORAGE_KEYS.USER_DATA, updatedUser);
      }

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('uploadFailed'), description: describeApiError(err, t('uploadFailedMessage')), variant: 'danger' });
    } finally {
      setUploadingAvatar(false);
    }
  }

  useEffect(() => {
    if (!user || hasHydratedFullProfile) return;
    let isMounted = true;

    async function hydrateProfile() {
      setHydrating(true);
      try {
        const response = await getMe();
        if (!isMounted) return;
        const nextUser = avatarUpdatedLocallyRef.current
          ? { ...response.data, avatar_url: latestAvatarUriRef.current }
          : response.data;
        applyProfileData(nextUser);
        refreshUser(nextUser);
        await storage.setJson(STORAGE_KEYS.USER_DATA, nextUser);
      } catch {
        if (!isMounted) return;
        applyProfileData(user as Partial<User>);
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
  }, [hasHydratedFullProfile, refreshUser, user]);

  // Warn the user before navigating away with unsaved changes
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (!isDirty || saving) return;
      e.preventDefault();
      confirm({
        title: t('edit.unsavedTitle'),
        message: t('edit.unsavedMessage'),
        confirmLabel: t('edit.discard'),
        cancelLabel: t('common:buttons.cancel'),
        variant: 'danger',
        onConfirm: () => navigation.dispatch(e.data.action),
      });
    });
    return unsubscribe;
  }, [navigation, isDirty, saving, t, confirm]);

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
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setSaving(true);
    try {
      const payload: UpdateProfilePayload = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        bio: bio.trim(),
        location: location.trim(),
        phone: phone.trim(),
      };

      const response = await updateProfile(payload);

      // Update cached user data
      await storage.setJson(STORAGE_KEYS.USER_DATA, response.data);
      refreshUser(response.data);
      setBaselineProfile({
        firstName: response.data.first_name ?? '',
        lastName: response.data.last_name ?? '',
        bio: decodeHtmlEntities(response.data.bio ?? ''),
        location: response.data.location ?? '',
        phone: response.data.phone ?? '',
      });

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('edit.saved'), description: t('edit.savedMessage'), variant: 'success' });
      router.back();
    } catch (err: unknown) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const msg = err instanceof Error ? err.message : t('edit.saveError');
      showToast({ title: t('common:errors.generic'), description: msg, variant: 'danger' });
    } finally {
      setSaving(false);
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
          <OfflineBanner />

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
                  isDisabled={uploadingAvatar}
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
                    setFirstName(v);
                    if (fieldErrors.firstName) setFieldErrors((e) => ({ ...e, firstName: undefined }));
                  }}
                  placeholder={t('edit.firstName')}
                  error={fieldErrors.firstName}
                  autoCapitalize="words"
                  maxLength={50}
                  theme={theme}
                  className="flex-1"
                />
                <ProfileField
                  label={t('edit.lastName')}
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder={t('edit.lastName')}
                  autoCapitalize="words"
                  maxLength={50}
                  theme={theme}
                  className="flex-1"
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
                onChangeText={setBio}
                placeholder={t('edit.aboutPlaceholder')}
                multiline
                numberOfLines={5}
                maxLength={500}
                theme={theme}
                inputClassName="min-h-[124px] pt-3"
                helper={t('edit.bioHint', { count: Math.max(0, 500 - bio.length) })}
              />
            </HeroCard.Body>
          </HeroCard>

          <HeroCard variant="secondary">
            <HeroCard.Body className="gap-4 px-4 py-4">
              <SectionTitle icon="location-outline" title={t('edit.contactDetails')} primary={primary} />
              <ProfileField
                label={t('edit.location')}
                value={location}
                onChangeText={setLocation}
                placeholder={t('edit.locationPlaceholder')}
                autoCapitalize="words"
                theme={theme}
              />
              <ProfileField
                label={t('edit.phoneOptional')}
                value={phone}
                onChangeText={(v) => {
                  setPhone(v);
                  if (fieldErrors.phone) setFieldErrors((e) => ({ ...e, phone: undefined }));
                }}
                placeholder={t('edit.phonePlaceholder')}
                keyboardType="phone-pad"
                error={fieldErrors.phone}
                theme={theme}
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
          isDisabled={!isDirty}
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

export default function EditProfileScreen() {
  return (
    <ModalErrorBoundary>
      <EditProfileScreenInner />
    </ModalErrorBoundary>
  );
}
