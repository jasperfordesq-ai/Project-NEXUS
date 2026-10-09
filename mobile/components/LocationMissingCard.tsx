// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Reminds a member who has no location to add one, on the home tab.
 *
 * 🔴 Owner decision, 9 October 2026: this reminder can NEVER be hidden. Unlike
 * `PushPermissionCard` there is no "Not now" and nothing is stored on the device — the card
 * is there until the member adds a town, and then the server stops reporting
 * `location_missing` and it disappears. Do not add a dismissal.
 *
 * 🔴 Shown ONLY for an explicit `location_missing === true` on a member who has finished
 * onboarding. The slim user that arrives with sign-in (`LoginUser`) carries no such field,
 * so an absent value must never count as "missing", or the card would flash for every member
 * straight after login. The server alone decides what "missing" means.
 *
 * The server never forces a location (older app versions and the accessible site must keep
 * working without one), so asking firmly is a job for the clients — this one included.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import Button from '@/components/ui/Button';
import { Ionicons } from '@/components/ui/Icon';
import Input from '@/components/ui/Input';
import type { User } from '@/lib/api/auth';
import { ApiResponseError } from '@/lib/api/client';
import { updateProfile } from '@/lib/api/profile';
import { STORAGE_KEYS } from '@/lib/constants';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { storage } from '@/lib/storage';
import { withAlpha } from '@/lib/utils/color';

export default function LocationMissingCard() {
  const { t } = useTranslation('home');
  const { user, refreshUser } = useAuth();
  const theme = useTheme();
  const primary = usePrimaryColor();
  const [location, setLocation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleSave = useCallback(async () => {
    if (saveInFlight.current) return;
    const place = location.trim();
    if (place === '') {
      setError(t('locationPrompt.errorRequired'));
      return;
    }
    saveInFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await updateProfile({ location: place });
      if (!isMountedRef.current) return;
      // A non-empty place was just accepted, so it is no longer missing even if the reply
      // does not repeat the flag.
      const saved: User = { ...response.data, location_missing: response.data.location_missing ?? false };
      refreshUser(saved);
      await storage.setJson(STORAGE_KEYS.USER_DATA, saved).catch(() => undefined);
    } catch (caught: unknown) {
      if (!isMountedRef.current) return;
      // Our own translated words, never the server's English.
      setError(
        caught instanceof ApiResponseError && caught.status === 422 && caught.field === 'location'
          ? t('locationPrompt.errorLocation')
          : t('locationPrompt.errorGeneric'),
      );
    } finally {
      saveInFlight.current = false;
      if (isMountedRef.current) setSaving(false);
    }
  }, [location, refreshUser, t]);

  // `LoginUser` (the slim sign-in object) has no such field, hence the `in` check: absent is not missing.
  if (!user || user.onboarding_completed !== true || !('location_missing' in user) || user.location_missing !== true) return null;

  return (
    <Surface
      variant="default"
      testID="location-missing-card"
      className="mx-3 mt-2 gap-3 rounded-panel px-3 py-3"
      style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
    >
      <View className="flex-row items-start gap-3">
        <View
          className="h-9 w-9 items-center justify-center rounded-2xl"
          style={{ backgroundColor: withAlpha(primary, 0.14) }}
        >
          <Ionicons name="location-outline" size={18} color={primary} />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Text
            accessibilityRole="header"
            className="text-base font-bold"
            style={{ color: theme.text }}
            maxFontSizeMultiplier={1.6}
          >
            {t('locationPrompt.title')}
          </Text>
          <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} maxFontSizeMultiplier={1.8}>
            {t('locationPrompt.subtitle')}
          </Text>
        </View>
      </View>

      <Input
        testID="location-missing-input"
        label={t('locationPrompt.label')}
        accessibilityLabel={t('locationPrompt.label')}
        value={location}
        onChangeText={(value) => {
          setLocation(value);
          if (error) setError(null);
        }}
        placeholder={t('locationPrompt.placeholder')}
        autoCapitalize="words"
        autoComplete="postal-address-locality"
        returnKeyType="done"
        maxLength={255}
        editable={!saving}
        error={error ?? undefined}
        containerClassName="mb-0"
        onSubmitEditing={() => void handleSave()}
      />

      <View className="flex-row gap-2">
        <Button
          size="sm"
          isLoading={saving}
          accessibilityLabel={t('locationPrompt.save')}
          onPress={() => void handleSave()}
          testID="location-missing-save"
        >
          {t('locationPrompt.save')}
        </Button>
      </View>
    </Surface>
  );
}
