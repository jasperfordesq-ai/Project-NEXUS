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
import { recordPushTap } from '@/lib/observability/pushTrail';

import { api, ApiResponseError } from '@/lib/api/client';
import { STORAGE_KEYS } from '@/lib/constants';
import { storage } from '@/lib/storage';
import i18n from 'i18next';
import { isBrowserOnlyPath, mapSystemPathToNativeRoute } from '@/app/+native-intent';
import { isSafeExternalBrowserLink } from '@/lib/utils/safeExternalLink';

export type PushRegistrationResult = 'registered' | 'permission-denied' | 'unavailable' | 'failed';

type NotificationPermission = Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>;

/** iOS provisional/ephemeral authorization can receive notifications too. */
function permissionAllowsNotifications(permission: NotificationPermission): boolean {
  if (permission.status === 'granted') return true;
  if (Platform.OS !== 'ios') return false;
  const iosStatus = permission.ios?.status;

  return iosStatus === Notifications.IosAuthorizationStatus.AUTHORIZED
    || iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL
    || iosStatus === Notifications.IosAuthorizationStatus.EPHEMERAL;
}

async function removeStoredRegistration(): Promise<void> {
  const storedToken = await storage.get(STORAGE_KEYS.PUSH_TOKEN);
  if (!storedToken) return;
  try {
    await api.post<void>('/api/push/unregister-device', { token: storedToken, token_type: 'expo' });
    await storage.remove(STORAGE_KEYS.PUSH_TOKEN);
  } catch (error) {
    reportException(error, { tags: { module: 'push-permission-revoked' } });
  }
}

/** Normalise the link keys emitted by the platform's notification producers. */
export function getNotificationLink(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  // The native client does not yet ship a story viewer. Older queued payloads
  // must not revive the previous misleading behaviour of opening the feed.
  if (typeof record.type === 'string' && record.type.toLowerCase().includes('story')) {
    return '/notifications';
  }
  for (const key of ['link', 'url', 'cta_url'] as const) {
    const value = record[key];
    if (typeof value !== 'string' || value.trim() === '') continue;
    const normalized = normalizeLegacyNotificationLink(record, value.trim());
    if (/^(?:https:\/\/app\.project-nexus\.ie)?\/caring-community\//.test(normalized)) {
      return '/notifications';
    }
    if (isSensitiveNotificationLink(normalized)) return '/notifications';
    if (isSafeExternalBrowserLink(normalized)) {
      return record.campaign_type === 'paid_push' && key === 'cta_url'
        ? normalized
        : '/notifications';
    }
    if (isBrowserOnlyPath(normalized)) return '/notifications';
    if (mapSystemPathToNativeRoute(normalized) === null) return '/notifications';
    return normalized;
  }
  return '/notifications';
}

let pendingPaidCampaignOpenId: string | null = null;
let paidCampaignOpenInFlight = false;

/** Queue paid-campaign analytics until the root navigator has resolved authentication. */
function queuePaidCampaignOpen(data: unknown): void {
  if (!data || typeof data !== 'object') return;
  const record = data as Record<string, unknown>;
  if (record.campaign_type !== 'paid_push') return;
  const campaignId = record.campaign_id;
  if (typeof campaignId !== 'string' || !/^[1-9][0-9]{0,18}$/.test(campaignId)) return;

  pendingPaidCampaignOpenId = campaignId;
}

/** Best-effort analytics called only after authentication is known to be ready. */
export async function flushPendingPaidCampaignOpen(): Promise<void> {
  const campaignId = pendingPaidCampaignOpenId;
  if (!campaignId || paidCampaignOpenInFlight) return;

  paidCampaignOpenInFlight = true;
  try {
    await api.post<void>(`/api/v2/me/push-campaigns/${campaignId}/open`, {});
    if (pendingPaidCampaignOpenId === campaignId) pendingPaidCampaignOpenId = null;
  } catch (error) {
    reportException(error, { tags: { module: 'paid-push-open' } });
  } finally {
    paidCampaignOpenInFlight = false;
  }
}

/**
 * The last tap this process handled. Module-level on purpose: the root navigator can be
 * unmounted and remounted (session-restore and update gates), and the observer below is
 * created again each time, while expo-notifications keeps returning the same stored
 * response until it is cleared.
 */
let lastHandledResponseKey: string | null = null;

/** Test-only: forget the last handled tap. */
export function __resetNotificationResponseStateForTests(): void {
  lastHandledResponseKey = null;
}

function responseKey(response: Notifications.NotificationResponse): string | null {
  const identifier = response.notification?.request?.identifier;
  if (typeof identifier !== 'string' || identifier === '') return null;
  return `${identifier}:${String(response.notification.date)}`;
}

function pushTypeOf(data: unknown): string {
  const type = data && typeof data === 'object' ? (data as Record<string, unknown>).type : undefined;
  return typeof type === 'string' && /^[a-z0-9_:-]{1,80}$/i.test(type) ? type : 'unknown';
}

/** Only a plain tap navigates; a notification action (dismiss, reply…) does not. */
function isDefaultAction(response: Notifications.NotificationResponse): boolean {
  const id = response.actionIdentifier;
  return id === undefined || id === null || id === Notifications.DEFAULT_ACTION_IDENTIFIER;
}

function clearStoredResponse(): void {
  try {
    Notifications.clearLastNotificationResponse();
  } catch (error) {
    reportException(error, { tags: { module: 'push-notification-response-clear' } });
  }
}

/**
 * One path for both ways a tap reaches the app. Returns the link that was followed, or
 * null when the response was ignored or had already been handled.
 *
 * 🔴 Android delivers the tap that launched a killed app TWICE — as the stored launch
 * response and again through the live listener — so the two are deduplicated by the
 * notification's identifier, not by which path fired first.
 */
function handleResponse(
  response: Notifications.NotificationResponse | null | undefined,
  source: 'launch' | 'listener',
  onLink: (link: string) => void,
): string | null {
  if (!response) return null;
  if (!isDefaultAction(response)) {
    clearStoredResponse();
    return null;
  }
  const key = responseKey(response);
  if (key !== null && key === lastHandledResponseKey) {
    clearStoredResponse();
    return null;
  }
  if (key !== null) lastHandledResponseKey = key;

  const data = response.notification.request.content.data;
  const notificationLink = getNotificationLink(data);
  recordPushTap({ source, type: pushTypeOf(data), link: notificationLink });
  if (notificationLink) {
    queuePaidCampaignOpen(data);
    onLink(notificationLink);
  }
  // Cleared on BOTH paths: a warm tap left behind here used to replay on the next
  // remount of the root navigator.
  clearStoredResponse();
  return notificationLink;
}

/**
 * Observe notification taps in every app state. The stored launch response covers a
 * notification that launched a terminated app; the listener covers foreground/background
 * interactions. An initial App Link may be supplied so notification intent wins
 * deterministically when Android reports both during startup.
 */
export function observeNotificationResponses(
  onLink: (link: string) => void,
  initialUrl: Promise<string | null> = Promise.resolve(null),
): () => void {
  let active = true;

  // Synchronous in expo-notifications 55 (the async wrappers are deprecated). Read it
  // now so a listener event arriving first is deduplicated by key, not by timing.
  let launchResponse: Notifications.NotificationResponse | null = null;
  try {
    launchResponse = Notifications.getLastNotificationResponse();
  } catch (error) {
    reportException(error, { tags: { module: 'push-notification-response-startup' } });
  }

  void initialUrl.then((launchUrl) => {
    if (!active) return;
    const followed = handleResponse(launchResponse, 'launch', onLink);
    if (!followed && !launchResponse && launchUrl) {
      onLink(launchUrl);
    }
  }).catch((error) => {
    reportException(error, { tags: { module: 'push-notification-response-startup' } });
  });

  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    handleResponse(response, 'listener', onLink);
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
    if (url.username || url.password || url.port) return true;
    if (url.hash && /token|secret|password|signature|authorization|api[_-]?key/i.test(url.hash)) return true;
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

function normalizeLegacyNotificationLink(record: Record<string, unknown>, link: string): string {
  const type = typeof record.type === 'string' ? record.type : '';
  if (type === 'federation_connection' && link === '/network') {
    return '/federation/connections';
  }
  if (type === 'federation_review' && /^\/profile\/\d+\/reviews(?:[?#].*)?$/.test(link)) {
    return '/reviews';
  }
  const sellerOrder = link.match(/^\/marketplace\/orders\/(\d+)$/);
  if (type === 'marketplace_payout' && sellerOrder) {
    return `/marketplace/orders/sales?order_id=${sellerOrder[1]}`;
  }

  return link;
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
 * Android notification channels. Created at runtime, so no native rebuild is needed —
 * but an existing channel's importance can never be changed, which is why messages get
 * a channel of their own rather than `default` being raised. The server chooses the
 * channel per push (`channelId`): `messages` for a direct message, `emergency` for a
 * supported emergency, `default` for everything else.
 */
export async function ensureAndroidNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  // Brand color — tenant-specific theming is not available at channel setup time.
  const lightColor = '#006FEE';
  await Notifications.setNotificationChannelAsync('default', {
    name: i18n.t('notifications:title'),
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor,
  });
  await Notifications.setNotificationChannelAsync('emergency', {
    name: i18n.t('onboarding:safeguarding_title'),
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor,
  });
  await Notifications.setNotificationChannelAsync('messages', {
    name: i18n.t('messages:title'),
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250],
    lightColor,
  });
}

/**
 * Request notification permission and register the device with the backend.
 * Safe to call multiple times — subsequent calls are no-ops if already registered.
 * Never throws; errors are logged silently.
 */
export async function registerForPushNotifications(
  requestPermission = false,
): Promise<PushRegistrationResult> {
  try {
    // Channels first, even where no token can be issued: a locally scheduled
    // notification on an emulator must land on the same channels a real push would.
    await ensureAndroidNotificationChannels();

    if (!Device.isDevice) {
      return 'unavailable';
    }

    let permission = await Notifications.getPermissionsAsync();

    if (!permissionAllowsNotifications(permission) && requestPermission) {
      permission = await Notifications.requestPermissionsAsync();
    }

    if (!permissionAllowsNotifications(permission)) {
      await removeStoredRegistration();
      return 'permission-denied';
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const previousToken = await storage.get(STORAGE_KEYS.PUSH_TOKEN);

    await api.post<void>('/api/push/register-device', {
      token: tokenData.data,
      token_type: 'expo',
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
    if (previousToken && previousToken !== tokenData.data) {
      try {
        await api.post<void>('/api/push/unregister-device', {
          token: previousToken,
          token_type: 'expo',
        });
      } catch (error) {
        // The new registration is already live; retain it and let provider
        // receipts remove the old token if this best-effort cleanup fails.
        reportException(error, { tags: { module: 'push-token-rotation' } });
      }
    }
    await storage.set(STORAGE_KEYS.PUSH_TOKEN, tokenData.data);
    return 'registered';
  } catch (err) {
    // Non-critical — app works fine without push notifications
    console.warn('[Notifications] Failed to register device:', err);
    // A lapsed login (401 after the client's own refresh failed) is an expected
    // outcome, not a fault: the member is signed out and registration runs again
    // on the next login. Reporting it filled Sentry from every signed-out device.
    if (!(err instanceof ApiResponseError && err.status === 401)) {
      reportException(err, { tags: { module: 'push-notifications' } });
    }
    return 'failed';
  }
}

/** Whether this device has already granted notification permission. Never prompts. */
export async function isPushPermissionGranted(): Promise<boolean> {
  if (!Device.isDevice) return false;
  return permissionAllowsNotifications(await Notifications.getPermissionsAsync());
}

/** Keep the OS app-icon badge aligned with the authoritative unread count. */
export async function syncPushBadge(count: number): Promise<void> {
  if (!Device.isDevice) return;
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, Math.floor(count)));
  } catch (error) {
    reportException(error, { tags: { module: 'push-badge-sync' } });
  }
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
