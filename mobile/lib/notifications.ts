// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Push notification setup for Expo + FCM.
 *
 * Flow:
 * 1. Request permission via Expo Notifications
 * 2. Get the Expo push token (which maps to an FCM token on Android)
 * 3. POST /api/push/register-device with the token + platform
 *
 * Requires: npm install expo-notifications expo-device
 * Called once after successful login. Never throws.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

import { reportSentryMessage, reportException } from '@/lib/observability/report';

import { api } from '@/lib/api/client';
import i18n from 'i18next';

/** Callback registered by RealtimeContext to handle background data pushes. */
let onRefreshCallback: (() => void) | null = null;

/**
 * Register a callback that fires when a notification arrives (including silent
 * data-only pushes). RealtimeContext uses this to refresh unread counts.
 */
export function registerRefreshCallback(cb: () => void): void {
  onRefreshCallback = cb;
}

export function unregisterRefreshCallback(): void {
  onRefreshCallback = null;
}

// Configure how notifications are displayed while the app is foregrounded.
// Safe to call before permission is granted.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    // Signal any registered listener so data can be refreshed
    onRefreshCallback?.();

    // Data-only (silent) pushes have no title/body — suppress the visual alert
    const { title, body } = notification.request.content;
    const isDataOnly = !title && !body;

    return {
      shouldShowAlert: !isDataOnly,
      shouldPlaySound: !isDataOnly,
      shouldSetBadge: true,
      shouldShowBanner: !isDataOnly,
      shouldShowList: !isDataOnly,
    };
  },
});

/**
 * Request notification permission and register the device with the backend.
 * Safe to call multiple times — subsequent calls are no-ops if already registered.
 * Never throws; errors are logged silently.
 */
export async function registerForPushNotifications(): Promise<void> {
  try {
    if (!Device.isDevice) {
      // Push notifications require a physical device
      return;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: i18n.t('notifications:title'),
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        // Brand color — tenant-specific theming not available at notification channel setup time
        lightColor: '#006FEE',
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      return;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);

    await api.post<void>('/api/push/register-device', {
      token: tokenData.data,
      token_type: 'expo',
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
  } catch (err) {
    // Non-critical — app works fine without push notifications
    console.warn('[Notifications] Failed to register device:', err);
    reportException(err, { tags: { module: 'push-notifications' } });
  }
}

/**
 * Unregister the device token from the backend (call on logout).
 */
export async function unregisterPushNotifications(): Promise<void> {
  try {
    if (!Device.isDevice) return;
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await api.post<void>('/api/push/unregister-device', { token: tokenData.data, token_type: 'expo' });
  } catch (err) {
    // Best effort on logout — log to Sentry for visibility
    if (err instanceof Error) {
      reportSentryMessage(`Push unregister failed: ${err.message}`, 'warning');
    }
  }
}
