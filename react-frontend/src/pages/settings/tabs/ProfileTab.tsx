import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@/components/ui/Dropdown';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Select, SelectItem } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { MobileFieldEditorOverlay } from '@/components/ui/MobileFieldEditorOverlay';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { useMediaQuery } from '@/hooks/useMediaQuery';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useRef, useState } from 'react';
import type React from 'react';

import Save from 'lucide-react/icons/save';
import Camera from 'lucide-react/icons/camera';
import Phone from 'lucide-react/icons/phone';
import Building2 from 'lucide-react/icons/building-2';
import Monitor from 'lucide-react/icons/monitor';
import Lock from 'lucide-react/icons/lock';
import ShieldCheck from 'lucide-react/icons/shield-check';
import { PlaceAutocompleteInput } from '@/components/location/PlaceAutocompleteInput';
import { resolveAvatarUrl } from '@/lib/helpers';
import { isPhoneValid } from '@/lib/validation';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useTheme } from '@/contexts';
import { AVATAR_UPLOAD_ACCEPT } from '@/lib/avatarUpload';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ProfileFormData {
  first_name: string;
  last_name: string;
  name: string;
  date_of_birth: string;
  phone: string;
  tagline: string;
  bio: string;
  location: string;
  latitude?: number;
  longitude?: number;
  avatar: string | null;
  profile_type: 'individual' | 'organisation';
  organization_name: string;
}

interface ProfileTabProps {
  profileData: ProfileFormData;
  isSaving: boolean;
  isUploading: boolean;
  isIdVerified?: boolean;
  isDirty?: boolean;
  onProfileDataChange: (updater: (prev: ProfileFormData) => ProfileFormData) => void;
  onSave: () => void;
  onAvatarUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Common style classNames
// ─────────────────────────────────────────────────────────────────────────────

const inputClassNames = {
  input: 'bg-transparent text-theme-primary',
  inputWrapper: 'bg-theme-elevated border-theme-default',
  label: 'text-theme-muted',
};

const selectClassNames = {
  trigger: 'bg-theme-elevated border-theme-default',
  value: 'text-theme-primary',
  label: 'text-theme-muted',
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function ProfileTab({
  profileData,
  isSaving,
  isUploading,
  isIdVerified = false,
  isDirty = false,
  onProfileDataChange,
  onSave,
  onAvatarUpload,
}: ProfileTabProps) {
  const { t } = useTranslation('settings');
  const { theme, setTheme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  // Native-app field editing: phones open the bio in a full-screen editor
  // (Instagram edit-profile pattern) instead of a small inline textarea.
  const isPhone = useMediaQuery('(max-width: 639px)');
  const [isBioEditorOpen, setIsBioEditorOpen] = useState(false);

  return (
    <div className="space-y-6">
      <GlassCard className="p-6">
        <h2 className="text-lg font-semibold text-theme-primary mb-6">{t('profile.section_title')}</h2>

        {/* Avatar */}
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-6 mb-8">
          <div className="relative">
            <Avatar
              key={profileData.avatar || 'no-avatar'}
              src={resolveAvatarUrl(profileData.avatar)}
              name={profileData.first_name || profileData.name}
              className="w-20 h-20 ring-4 ring-theme-default"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept={AVATAR_UPLOAD_ACCEPT}
              onChange={onAvatarUpload}
              className="hidden"
              disabled={isUploading}
              aria-label={t('profile.upload_photo_aria')}
            />
            {/* capture forces the OS camera — the plain picker no longer offers
                one on modern Android (system photo picker has no camera). */}
            <input
              ref={cameraInputRef}
              type="file"
              accept={AVATAR_UPLOAD_ACCEPT}
              capture="user"
              onChange={onAvatarUpload}
              className="hidden"
              disabled={isUploading}
              aria-label={t('profile.take_photo_aria')}
            />
            <Dropdown placement="bottom-end">
              <DropdownTrigger>
                <Button
                  isIconOnly
                  size="md"
                  className="absolute bottom-0 right-0 h-10 min-w-10 rounded-full shadow-lg"
                  isDisabled={isUploading}
                  isLoading={isUploading}
                  aria-label={t('profile.change_photo_aria')}
                >
                  <Camera className="w-4 h-4" aria-hidden="true" />
                </Button>
              </DropdownTrigger>
              <DropdownMenu
                aria-label={t('profile.change_photo_aria')}
                onAction={(key) => {
                  if (key === 'camera') cameraInputRef.current?.click();
                  if (key === 'library') fileInputRef.current?.click();
                }}
              >
                <DropdownItem id="camera">{t('profile.take_photo')}</DropdownItem>
                <DropdownItem id="library">{t('profile.choose_from_library')}</DropdownItem>
              </DropdownMenu>
            </Dropdown>
          </div>
          <div>
            <p className="text-theme-primary font-medium">{t('profile.photo_label')}</p>
            <p className="text-theme-subtle text-sm">{t('profile.photo_hint')}</p>
          </div>
        </div>

        {/* Form */}
        <div className="space-y-6">
          {/* Name fields */}
          {isIdVerified && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-sm">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
              <span className="text-theme-success font-medium">
                {t('profile.identity_verified_lock')}
              </span>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label={t('profile.first_name')}
              placeholder={t('profile.first_name_placeholder')}
              value={profileData.first_name}
              onChange={(e) => onProfileDataChange((prev) => ({ ...prev, first_name: e.target.value }))}
              classNames={inputClassNames}
              isReadOnly={isIdVerified}
              autoComplete="given-name"
              endContent={isIdVerified ? <Lock className="w-4 h-4 text-theme-subtle" aria-hidden="true" /> : undefined}
            />
            <Input
              label={t('profile.last_name')}
              placeholder={t('profile.last_name_placeholder')}
              value={profileData.last_name}
              onChange={(e) => onProfileDataChange((prev) => ({ ...prev, last_name: e.target.value }))}
              classNames={inputClassNames}
              isReadOnly={isIdVerified}
              autoComplete="family-name"
              endContent={isIdVerified ? <Lock className="w-4 h-4 text-theme-subtle" aria-hidden="true" /> : undefined}
            />
          </div>

          {/* Date of Birth */}
          <Input
            type="date"
            label={t('profile.date_of_birth')}
            value={profileData.date_of_birth || ''}
            onChange={(e) => onProfileDataChange((prev) => ({ ...prev, date_of_birth: e.target.value }))}
            classNames={inputClassNames}
            max={new Date().toISOString().split('T')[0]}
            isReadOnly={isIdVerified}
            isDisabled={isIdVerified}
            endContent={isIdVerified ? <Lock className="w-4 h-4 text-theme-subtle" aria-hidden="true" /> : undefined}
            description={
              isIdVerified
                ? t('identity_verified_lock_dob')
                : !profileData.date_of_birth
                  ? t('profile.dob_description')
                  : undefined
            }
          />

          {/* Phone */}
          <Input
            type="tel"
            label={t('profile.phone')}
            placeholder={t('profile.phone_placeholder')}
            value={profileData.phone}
            onChange={(e) => {
              const val = e.target.value;
              onProfileDataChange((prev) => ({ ...prev, phone: val }));
              setPhoneError(isPhoneValid(val) ? null : t('profile.phone_invalid'));
            }}
            onBlur={() => {
              setPhoneError(isPhoneValid(profileData.phone) ? null : t('profile.phone_invalid'));
            }}
            startContent={<Phone className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
            autoComplete="tel"
            classNames={inputClassNames}
            isInvalid={!!phoneError}
            errorMessage={phoneError ?? undefined}
          />

          {/* Profile Type */}
          <Select
            label={t('profile.profile_type')}
            selectedKeys={[profileData.profile_type]}
            onSelectionChange={(keys) => {
              const value = Array.from(keys)[0] as string;
              if (value) {
                onProfileDataChange((prev) => ({
                  ...prev,
                  profile_type: value as 'individual' | 'organisation',
                }));
              }
            }}
            classNames={selectClassNames}
          >
            <SelectItem key="individual" id="individual">{t('profile.type_individual')}</SelectItem>
            <SelectItem key="organisation" id="organisation">{t('profile.type_organisation')}</SelectItem>
          </Select>

          {/* Organisation Name (conditional) */}
          {profileData.profile_type === 'organisation' && (
            <Input
              label={t('profile.org_name')}
              placeholder={t('profile.org_name_placeholder')}
              value={profileData.organization_name}
              onChange={(e) => onProfileDataChange((prev) => ({ ...prev, organization_name: e.target.value }))}
              startContent={<Building2 className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
              classNames={inputClassNames}
            />
          )}

          <Input
            label={t('profile.tagline')}
            placeholder={t('profile.tagline_placeholder')}
            value={profileData.tagline}
            onChange={(e) => onProfileDataChange((prev) => ({ ...prev, tagline: e.target.value }))}
            classNames={inputClassNames}
          />

          {isPhone ? (
            <div>
              <span className="mb-1 block text-sm text-theme-muted">{t('profile.bio')}</span>
              <Button
                variant="flat"
                onPress={() => setIsBioEditorOpen(true)}
                aria-label={t('profile.bio')}
                className="min-h-[72px] w-full items-start justify-start whitespace-normal rounded-xl border border-theme-default bg-theme-elevated px-3 py-2.5 text-left text-sm font-normal"
              >
                <span className={`line-clamp-3 ${profileData.bio ? 'text-theme-primary' : 'text-theme-subtle'}`}>
                  {profileData.bio || t('profile.bio_placeholder')}
                </span>
              </Button>
              <MobileFieldEditorOverlay
                isOpen={isBioEditorOpen}
                onClose={() => setIsBioEditorOpen(false)}
                title={t('profile.bio')}
                placeholder={t('profile.bio_placeholder')}
                value={profileData.bio}
                onSave={(bio) => onProfileDataChange((prev) => ({ ...prev, bio }))}
              />
            </div>
          ) : (
            <Textarea
              label={t('profile.bio')}
              placeholder={t('profile.bio_placeholder')}
              value={profileData.bio}
              onChange={(e) => onProfileDataChange((prev) => ({ ...prev, bio: e.target.value }))}
              minRows={4}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
                label: 'text-theme-muted',
              }}
            />
          )}

          <PlaceAutocompleteInput
            label={t('profile.location')}
            placeholder={t('profile.location_placeholder')}
            value={profileData.location}
            onChange={(val) => onProfileDataChange((prev) => ({ ...prev, location: val }))}
            onPlaceSelect={(place) => {
              onProfileDataChange((prev) => ({
                ...prev,
                location: place.formattedAddress,
                latitude: place.lat,
                longitude: place.lng,
              }));
            }}
            onClear={() => {
              onProfileDataChange((prev) => ({
                ...prev,
                location: '',
                latitude: undefined,
                longitude: undefined,
              }));
            }}
            classNames={inputClassNames}
          />

          <Button
            onPress={onSave}
            startContent={<Save className="w-4 h-4" aria-hidden="true" />}
            isLoading={isSaving}
            isDisabled={!isDirty || isSaving}
          >
            {t('save_changes')}
          </Button>
        </div>
      </GlassCard>

      {/* Language & Appearance */}
      <GlassCard className="p-6">
        <h2 className="text-lg font-semibold text-theme-primary mb-6 flex items-center gap-2">
          <Monitor className="w-5 h-5 text-accent" aria-hidden="true" />
          {t('language_appearance')}
        </h2>

        <div className="space-y-6">
          {/* Language preference */}
          <div role="group" aria-labelledby="lang-label-id">
            <p id="lang-label-id" className="text-sm font-medium text-theme-primary mb-1">{t('language_preference')}</p>
            <p className="text-xs text-theme-muted mb-3">{t('select_language')}</p>
            <LanguageSwitcher compact={false} />
          </div>

          {/* Theme preference */}
          <div className="pt-4 border-t border-theme-default">
            <p className="text-sm font-medium text-theme-primary mb-3">{t('theme.title')}</p>
            <ToggleButtonGroup
              aria-label={t('theme.title')}
              selectionMode="single"
              disallowEmptySelection
              isDetached
              size="sm"
              selectedKeys={new Set([theme])}
              onSelectionChange={(keys) => { const [k] = Array.from(keys); if (k) setTheme(k as typeof theme); }}
              className="flex gap-2 flex-wrap"
            >
              {(['light', 'dark', 'system'] as const).map((mode) => (
                <ToggleButton
                  key={mode}
                  id={mode}
                  variant="ghost"
                  className="data-[selected=true]:bg-[var(--color-primary)] data-[selected=true]:text-white"
                >
                  {t(`theme.${mode}`)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
