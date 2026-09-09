// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Offers notifications, once, to a member who has never been asked.
 *
 * 🔴 Why this exists. `registerForPushNotifications()` takes `requestPermission = false`
 * and every caller in the app used the default except the switch in Settings. On iOS, and
 * on Android 13 and later, the system permission dialog only appears when an app asks for
 * it — so the dialog was never shown in the ordinary flow. A member signed up, was never
 * asked anything, and simply received no message, exchange-request or event notifications
 * unless they happened to find Settings → Allow notifications on this device. Audit
 * 2026-09-09, item 1.
 *
 * 🔴 Asked once, on purpose. The decision is stored on EITHER answer, because the OS
 * permission state cannot tell the two "no"s apart: a member who taps "Not now" here never
 * sees the system dialog, so their permission stays "undetermined" — exactly like a member
 * who has not been asked yet. A visibility rule based on permission alone would therefore
 * re-offer on every single launch, which is the behaviour Apple's review guidelines and
 * every member would call nagging. Settings remains the way back in, either way.
 *
 * 🔴 The follow-up only appears after the member has asked for notifications and the OS has
 * refused. Leading with "open system settings" to somebody who has not yet said yes is both
 * confusing and a dead end; it is only useful once we know their answer was yes and the OS
 * disagreed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import Button from '@/components/ui/Button';
import { Ionicons } from '@/components/ui/Icon';
import { STORAGE_KEYS } from '@/lib/constants';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { isPushPermissionGranted, registerForPushNotifications } from '@/lib/notifications';
import { storage } from '@/lib/storage';
import { withAlpha } from '@/lib/utils/color';

type CardState = 'checking' | 'hidden' | 'offer' | 'blocked';

export default function PushPermissionCard() {
  const { t } = useTranslation(['notifications', 'common']);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const [state, setState] = useState<CardState>('checking');
  const [isWorking, setIsWorking] = useState(false);
  // Guards a late resolve after the member has navigated away.
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const decision = await storage.get(STORAGE_KEYS.PUSH_PROMPT_DECISION);
      if (cancelled) return;
      if (decision) {
        setState('hidden');
        return;
      }

      const granted = await isPushPermissionGranted();
      if (cancelled) return;
      setState(granted ? 'hidden' : 'offer');
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleEnable = useCallback(async () => {
    setIsWorking(true);
    try {
      const result = await registerForPushNotifications(true);
      // Recorded before anything else: whatever happened, the member has now been asked,
      // and a failure to store that must not turn into a card that returns for ever.
      await storage.set(STORAGE_KEYS.PUSH_PROMPT_DECISION, 'asked');
      if (!isMountedRef.current) return;
      /*
        'permission-denied' is the only outcome where system settings help. 'failed' is our
        own registration call going wrong and 'unavailable' is a simulator or a build with
        no push support — sending either of those to a system screen would be a lie, so the
        card simply closes and Settings keeps the retry.
      */
      setState(result === 'permission-denied' ? 'blocked' : 'hidden');
    } finally {
      if (isMountedRef.current) setIsWorking(false);
    }
  }, []);

  const handleDismiss = useCallback(async () => {
    await storage.set(STORAGE_KEYS.PUSH_PROMPT_DECISION, 'dismissed');
    if (isMountedRef.current) setState('hidden');
  }, []);

  const handleOpenSettings = useCallback(() => {
    // Rejects on a device with no settings surface (and on web). Nothing useful to say.
    void Linking.openSettings().catch(() => undefined);
    setState('hidden');
  }, []);

  if (state === 'checking' || state === 'hidden') return null;

  const isBlocked = state === 'blocked';

  return (
    <Surface
      variant="default"
      testID="push-permission-card"
      className="mx-3 mt-2 gap-3 rounded-panel px-3 py-3"
      style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
    >
      <View className="flex-row items-start gap-3">
        <View
          className="h-9 w-9 items-center justify-center rounded-2xl"
          style={{ backgroundColor: withAlpha(primary, 0.14) }}
        >
          <Ionicons name={isBlocked ? 'notifications-off-outline' : 'notifications-outline'} size={18} color={primary} />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Text
            accessibilityRole="header"
            className="text-base font-bold"
            style={{ color: theme.text }}
            maxFontSizeMultiplier={1.6}
          >
            {isBlocked ? t('notifications:permissionCard.blockedTitle') : t('notifications:permissionCard.title')}
          </Text>
          <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} maxFontSizeMultiplier={1.8}>
            {isBlocked ? t('notifications:permissionCard.blockedBody') : t('notifications:permissionCard.body')}
          </Text>
        </View>
      </View>

      <View className="flex-row gap-2">
        {isBlocked ? (
          <Button size="sm" onPress={handleOpenSettings} testID="push-permission-settings">
            {t('notifications:permissionCard.openSettings')}
          </Button>
        ) : (
          <>
            <Button size="sm" isLoading={isWorking} onPress={() => void handleEnable()} testID="push-permission-enable">
              {t('notifications:permissionCard.enable')}
            </Button>
            <Button size="sm" variant="ghost" disabled={isWorking} onPress={() => void handleDismiss()} testID="push-permission-dismiss">
              {t('notifications:permissionCard.notNow')}
            </Button>
          </>
        )}
      </View>
    </Surface>
  );
}
