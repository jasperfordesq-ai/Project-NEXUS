// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Push notification setup for Expo Push Service (APNs on iOS, FCM on Android).
 *
 * Flow:
 * 1. Read permission, requesting it only after an explicit user action
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
import { STORAGE_KEYS } from '@/lib/constants';
import { storage } from '@/lib/storage';
import i18n from 'i18next';
import { isBrowserOnlyPath, mapSystemPathToNativeRoute } from '@/app/+native-intent';
import { isSafeExternalBrowserLink } from '@/lib/utils/safeExternalLink';

export type PushRegistrationResult = 'registered' | 'permission-denied' | 'unavailable' | 'failed';

/** Normalise the link keys emitted by the platform's notification producers. */
export function getNotificationLink(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  for (const key of ['link', 'url', 'cta_url'] as const) {
    const value = record[key];
    if (typeof value !== 'string' || value.trim() === '') continue;
    if (isSensitiveNotificationLink(value)) return '/notifications';
    if (isSafeExternalBrowserLink(value)) {
      return record.campaign_type === 'paid_push' && key === 'cta_url'
        ? value
        : '/notifications';
    }
    if (isBrowserOnlyPath(value)) return '/notifications';
    if (mapSystemPathToNativeRoute(value) === null) return '/notifications';
    return value;
  }
  return '/notifications';
}

/**
 * Observe notification taps in every app state. The initial-response lookup covers a
 * notification that launched a terminated app; the listener covers foreground/background
 * interactions. An initial App Link may be supplied so notification intent wins
 * deterministically when Android reports both during startup.
 */
export function observeNotificationResponses(
  onLink: (link: string) => void,
  initialUrl: Promise<string | null> = Promise.resolve(null),
): () => void {
  let active = true;

  void Promise.all([
    initialUrl,
    Notifications.getLastNotificationResponseAsync(),
  ]).then(([launchUrl, response]) => {
    if (!active) return;
    const notificationLink = getNotificationLink(response?.notification.request.content.data);
    if (notificationLink) {
      onLink(notificationLink);
      void Notifications.clearLastNotificationResponseAsync().catch((error) => {
        reportException(error, { tags: { module: 'push-notification-response-clear' } });
      });
    } else if (launchUrl) {
      onLink(launchUrl);
    }
  }).catch((error) => {
    reportException(error, { tags: { module: 'push-notification-response-startup' } });
  });

  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const notificationLink = getNotificationLink(response.notification.request.content.data);
    if (notificationLink) onLink(notificationLink);
  });

  return () => {
    active = false;
    subscription.remove();
  };
}

function isSensitiveNotificationLink(link: string): boolean {
  try {
    const normalized = link.includes('://') || link.startsWith('/') ? link : `/${link}`;
    const url = new URL(normalized, 'https://app.project-nexus.ie');
    if (url.username || url.password || url.port || url.hash) return true;
    for (const key of url.searchParams.keys()) {
      if (/token|secret|password|signature|authorization|api[_-]?key/i.test(key)) return true;
    }
    return url.pathname === '/password/reset'
      || url.pathname.startsWith('/password/reset/')
      || url.pathname === '/support-actions/confirm'
      || url.pathname.startsWith('/support-actions/confirm/');
  } catch {
    return true;
  }
}

/** Callback registered by RealtimeContext to refresh foreground notification state. */
let onRefreshCallback: (() => void) | null = null;

/**
 * Register a callback that fires when a foreground notification arrives.
 * RealtimeContext uses this to refresh unread counts.
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
export async function registerForPushNotifications(
  requestPermission = false,
): Promise<PushRegistrationResult> {
  try {
    if (!Device.isDevice) {
      return 'unavailable';
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

    if (existingStatus !== 'granted' && requestPermission) {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      return 'permission-denied';
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);

    await api.post<void>('/api/push/register-device', {
      token: tokenData.data,
      token_type: 'expo',
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
    await storage.set(STORAGE_KEYS.PUSH_TOKEN, tokenData.data);
    return 'registered';
  } catch (err) {
    // Non-critical — app works fine without push notifications
    console.warn('[Notifications] Failed to register device:', err);
    reportException(err, { tags: { module: 'push-notifications' } });
    return 'failed';
  }
}

/** Whether this device has already granted notification permission. Never prompts. */
export async function isPushPermissionGranted(): Promise<boolean> {
  if (!Device.isDevice) return false;
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted';
}

/**
 * Unregister the device token from the backend (call on logout).
 */
export async function unregisterPushNotifications(): Promise<void> {
  try {
    if (!Device.isDevice) return;
    let token = await storage.get(STORAGE_KEYS.PUSH_TOKEN);
    if (!token && await isPushPermissionGranted()) {
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      const tokenData = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
      token = tokenData.data;
    }
    if (!token) return;
    await api.post<void>('/api/push/unregister-device', { token, token_type: 'expo' });
    await storage.remove(STORAGE_KEYS.PUSH_TOKEN);
  } catch (err) {
    // Best effort on logout — log to Sentry for visibility
    if (err instanceof Error) {
      reportSentryMessage(`Push unregister failed: ${err.message}`, 'warning');
    }
  }
}
