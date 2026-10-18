// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Platform } from 'react-native';

const mockPost = jest.fn();
const mockGetPermissionsAsync = jest.fn();
const mockRequestPermissionsAsync = jest.fn();
const mockGetExpoPushTokenAsync = jest.fn();
const mockSetNotificationChannelAsync = jest.fn();
const mockSetBadgeCountAsync = jest.fn();
const mockGetLastNotificationResponseAsync = jest.fn();
const mockClearLastNotificationResponseAsync = jest.fn();
const mockGetLastNotificationResponse = jest.fn();
const mockClearLastNotificationResponse = jest.fn();
const mockResponseSubscriptionRemove = jest.fn();
const mockAddNotificationResponseReceivedListener = jest.fn();
const mockDeviceState = { isDevice: true };

jest.mock('expo-device', () => ({
  get isDevice() {
    return mockDeviceState.isDevice;
  },
}));

jest.mock('expo-constants', () => ({
  expoConfig: { extra: { eas: { projectId: 'project-123' } } },
}));

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 'default', HIGH: 'high', MAX: 'max' },
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  IosAuthorizationStatus: { AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
  getExpoPushTokenAsync: (...args: unknown[]) => mockGetExpoPushTokenAsync(...args),
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissionsAsync(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissionsAsync(...args),
  setNotificationChannelAsync: (...args: unknown[]) => mockSetNotificationChannelAsync(...args),
  setBadgeCountAsync: (...args: unknown[]) => mockSetBadgeCountAsync(...args),
  setNotificationHandler: jest.fn(),
  getLastNotificationResponseAsync: (...args: unknown[]) => mockGetLastNotificationResponseAsync(...args),
  clearLastNotificationResponseAsync: (...args: unknown[]) => mockClearLastNotificationResponseAsync(...args),
  getLastNotificationResponse: (...args: unknown[]) => mockGetLastNotificationResponse(...args),
  clearLastNotificationResponse: (...args: unknown[]) => mockClearLastNotificationResponse(...args),
  addNotificationResponseReceivedListener: (...args: unknown[]) => mockAddNotificationResponseReceivedListener(...args),
}));

const mockAddBreadcrumb = jest.fn();
jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: (...args: unknown[]) => mockAddBreadcrumb(...args),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

jest.mock('@/lib/api/client', () => ({
  ApiResponseError: class ApiResponseError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'ApiResponseError';
      this.status = status;
    }
  },
  api: {
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

const mockStorageGet = jest.fn();
const mockStorageSet = jest.fn();
const mockStorageRemove = jest.fn();
jest.mock('@/lib/storage', () => ({
  storage: {
    get: (...args: unknown[]) => mockStorageGet(...args),
    set: (...args: unknown[]) => mockStorageSet(...args),
    remove: (...args: unknown[]) => mockStorageRemove(...args),
  },
}));

jest.mock('@/lib/constants', () => ({
  STORAGE_KEYS: { PUSH_TOKEN: 'nexus_expo_push_token' },
}));

import {
  __resetNotificationResponseStateForTests,
  flushPendingPaidCampaignOpen,
  getNotificationLink,
  observeNotificationResponses,
  registerForPushNotifications,
  syncPushBadge,
  unregisterPushNotifications,
} from './notifications';

describe('push notification links', () => {
  it.each([
    [{ link: '/messages/1' }, '/messages/1'],
    [{ url: '/wallet' }, '/wallet'],
    [{ cta_url: 'https://app.project-nexus.ie/events/4' }, 'https://app.project-nexus.ie/events/4'],
  ])('normalises every supported producer key', (data, expected) => {
    expect(getNotificationLink(data)).toBe(expected);
  });

  it('rejects absent and non-string link values', () => {
    expect(getNotificationLink({ link: 123 })).toBe('/notifications');
    expect(getNotificationLink(null)).toBeNull();
  });

  it('fails a short malformed notification link closed without throwing', () => {
    expect(getNotificationLink({ link: '/%E0%A4%A?next=%E0%A4%A' })).toBe('/notifications');
  });

  it.each([
    { link: 'https://evil.example/messages/123' },
    { link: '/admin/gdpr' },
    { link: '/hour-timebank/admin/gdpr' },
    { link: '/password/reset?token=secret-value' },
    { link: 'https://member:secret@app.project-nexus.ie/messages/123' },
    { link: 'https://app.project-nexus.ie:444/messages/123' },
    { link: '/messages/123#token=secret-value' },
    { link: '/route-that-does-not-exist/123' },
  ])('falls back safely when push data cannot open a native member screen', (data) => {
    expect(getNotificationLink(data)).toBe('/notifications');
  });

  it('accepts the versioned actionable payload emitted by Laravel', () => {
    expect(getNotificationLink({
      schema_version: '1',
      type: 'new_message',
      link: '/messages/123?context_type=listing&context_id=44',
    })).toBe('/messages/123?context_type=listing&context_id=44');
  });

  it('allows only an opted-in paid campaign to open its approved external CTA', () => {
    const externalCta = 'https://partner.example.org/book/42?campaign=nexus';

    expect(getNotificationLink({
      campaign_type: 'paid_push',
      cta_url: externalCta,
    })).toBe(externalCta);
    expect(getNotificationLink({ cta_url: externalCta })).toBe('/notifications');
  });

  it('keeps legacy story payloads in the inbox until an exact native story viewer exists', () => {
    expect(getNotificationLink({ type: 'story_reaction', link: '/feed' })).toBe('/notifications');
    expect(getNotificationLink({ type: 'new_story', link: '/feed' })).toBe('/notifications');
  });

  it('opens group chatroom pushes on the exact native Channels tab', () => {
    expect(getNotificationLink({
      type: 'group_chatroom_message',
      link: '/groups/42/chat?chatroom_id=7',
    })).toBe('/groups/42/chat?chatroom_id=7');
  });

  it('fails every Care in Community destination closed at the native store boundary', () => {
    expect(getNotificationLink({
      type: 'caring_emergency',
      link: '/caring-community/emergency-alerts?alert_id=91',
    })).toBe('/notifications');
    expect(getNotificationLink({
      type: 'caring_nudge',
      link: '/caring-community/request-help',
    })).toBe('/notifications');
  });

  it.each([
    [{ type: 'federation_connection', link: '/network' }, '/federation/connections'],
    [{ type: 'federation_review', link: '/profile/42/reviews' }, '/reviews'],
    [{ type: 'marketplace_payout', link: '/marketplace/orders/42' }, '/marketplace/orders/sales?order_id=42'],
  ])('repairs a previously queued legacy producer destination', (data, expected) => {
    expect(getNotificationLink(data)).toBe(expected);
  });

  it('allows a benign entity anchor but still rejects credential-like fragments', () => {
    expect(getNotificationLink({ type: 'job_application', link: '/jobs/42#applications' }))
      .toBe('/jobs/42#applications');
    expect(getNotificationLink({ type: 'new_message', link: '/messages/42#token=secret' }))
      .toBe('/notifications');
  });

  it.each([
    '/marketplace/reports/42',
  ])('fails closed for a real web page with no native equivalent: %s', (link) => {
    expect(getNotificationLink({ type: 'audit', link })).toBe('/notifications');
  });

  it.each([
    'http://partner.example.org/book/42',
    'https://localhost/book/42',
    'https://127.0.0.1/book/42',
    'https://user:secret@partner.example.org/book/42',
    'https://partner.example.org:444/book/42',
    'https://partner.example.org/book/42#secret',
  ])('rejects an unsafe paid campaign CTA: %s', (ctaUrl) => {
    expect(getNotificationLink({
      campaign_type: 'paid_push',
      cta_url: ctaUrl,
    })).toBe('/notifications');
  });

  it.each([
    '/messages/123',
    '/wallet',
    '/events/44',
    '/feed/posts/12',
    '/connections',
    '/courses/timebanking-basics',
    '/goals/9',
    '/jobs/44/applications',
    '/marketplace/seller/dashboard',
    '/volunteering/opportunities/7',
  ])('accepts an actionable representative producer destination: %s', (link) => {
    expect(getNotificationLink({ schema_version: '1', link })).toBe(link);
  });
});

describe('push notification response lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLastNotificationResponseAsync.mockResolvedValue(null);
    mockClearLastNotificationResponseAsync.mockResolvedValue(undefined);
    mockGetLastNotificationResponse.mockReturnValue(null);
    __resetNotificationResponseStateForTests();
    mockAddNotificationResponseReceivedListener.mockReturnValue({ remove: mockResponseSubscriptionRemove });
  });

  it('replays and clears the notification that launched a killed app', async () => {
    mockGetLastNotificationResponse.mockReturnValue({
      notification: { request: { content: { data: { link: '/messages/123' } } } },
    });
    const onLink = jest.fn();

    const unsubscribe = observeNotificationResponses(onLink);
    await Promise.resolve();
    await Promise.resolve();

    expect(onLink).toHaveBeenCalledWith('/messages/123');
    expect(mockClearLastNotificationResponse).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(mockResponseSubscriptionRemove).toHaveBeenCalledTimes(1);
  });

  it('routes foreground and background taps from the live response listener', () => {
    const onLink = jest.fn();
    observeNotificationResponses(onLink);
    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0]?.[0];

    listener({ notification: { request: { content: { data: { link: '/events/44' } } } } });

    expect(onLink).toHaveBeenCalledWith('/events/44');
  });

  it('defers paid-campaign analytics until authentication has resolved', async () => {
    mockPost.mockResolvedValue(undefined);
    const onLink = jest.fn();
    observeNotificationResponses(onLink);
    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0]?.[0];

    listener({ notification: { request: { content: { data: {
      campaign_type: 'paid_push',
      campaign_id: '42',
      cta_url: 'https://partner.example.org/book/42',
    } } } } });

    expect(mockPost).not.toHaveBeenCalled();
    expect(onLink).toHaveBeenCalledWith('https://partner.example.org/book/42');

    await flushPendingPaidCampaignOpen();
    expect(mockPost).toHaveBeenCalledWith('/api/v2/me/push-campaigns/42/open', {});
  });

  it('retains a paid-campaign tap for retry after a signed-out request fails', async () => {
    const onLink = jest.fn();
    observeNotificationResponses(onLink);
    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0]?.[0];
    listener({ notification: { request: { content: { data: {
      campaign_type: 'paid_push',
      campaign_id: '84',
      cta_url: 'https://partner.example.org/book/84',
    } } } } });

    mockPost.mockRejectedValueOnce(new Error('Unauthenticated'));
    await flushPendingPaidCampaignOpen();
    mockPost.mockResolvedValueOnce(undefined);
    await flushPendingPaidCampaignOpen();

    expect(mockPost).toHaveBeenNthCalledWith(1, '/api/v2/me/push-campaigns/84/open', {});
    expect(mockPost).toHaveBeenNthCalledWith(2, '/api/v2/me/push-campaigns/84/open', {});
  });

  it('does not report malformed or non-paid campaign identifiers', () => {
    const onLink = jest.fn();
    observeNotificationResponses(onLink);
    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0]?.[0];

    listener({ notification: { request: { content: { data: {
      campaign_type: 'paid_push',
      campaign_id: '../admin',
      cta_url: 'https://partner.example.org/book/42',
    } } } } });

    expect(mockPost).not.toHaveBeenCalled();
    expect(onLink).toHaveBeenCalledWith('https://partner.example.org/book/42');
  });

  it('falls back to the notification centre for malformed response data', () => {
    const onLink = jest.fn();
    observeNotificationResponses(onLink);
    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0]?.[0];

    listener({ notification: { request: { content: { data: { link: 'https://evil.example/steal' } } } } });

    expect(onLink).toHaveBeenCalledWith('/notifications');
  });
});

describe('push notification registration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockRequestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockGetExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc123]' });
    mockPost.mockResolvedValue(undefined);
    mockStorageGet.mockResolvedValue('ExponentPushToken[abc123]');
    mockStorageSet.mockResolvedValue(undefined);
    mockStorageRemove.mockResolvedValue(undefined);
  });

  it('registers Expo push tokens with an explicit token type for backend routing', async () => {
    const originalPlatform = Platform.OS;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });

    const result = await registerForPushNotifications();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });

    expect(result).toBe('registered');
    expect(mockSetNotificationChannelAsync).toHaveBeenNthCalledWith(1, 'default', {
      name: 'Notifications',
      importance: 'default',
      lightColor: '#006FEE',
    });
    expect(mockSetNotificationChannelAsync).toHaveBeenNthCalledWith(2, 'emergency', {
      name: 'Support & Safeguarding',
      importance: 'max',
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#006FEE',
    });
    expect(mockGetExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'project-123' });
    expect(mockPost).toHaveBeenCalledWith('/api/push/register-device', {
      token: 'ExponentPushToken[abc123]',
      token_type: 'expo',
      platform: 'android',
    });
    expect(mockStorageSet).toHaveBeenCalledWith('nexus_expo_push_token', 'ExponentPushToken[abc123]');
  });

  it('does not prompt during automatic session restoration', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    mockStorageGet.mockResolvedValue(null);

    const result = await registerForPushNotifications();

    expect(result).toBe('permission-denied');
    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('prompts only after an explicit enable action', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'undetermined' });

    const result = await registerForPushNotifications(true);

    expect(result).toBe('registered');
    expect(mockRequestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('accepts iOS provisional authorization without prompting again', async () => {
    const originalPlatform = Platform.OS;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    mockGetPermissionsAsync.mockResolvedValue({ status: 'undetermined', ios: { status: 3 } });

    const result = await registerForPushNotifications();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });

    expect(result).toBe('registered');
    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('unregisters a stored token after permission is revoked', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'denied' });

    const result = await registerForPushNotifications();

    expect(result).toBe('permission-denied');
    expect(mockPost).toHaveBeenCalledWith('/api/push/unregister-device', {
      token: 'ExponentPushToken[abc123]',
      token_type: 'expo',
    });
    expect(mockStorageRemove).toHaveBeenCalledWith('nexus_expo_push_token');
  });

  it('replaces a rotated Expo token and removes the prior registration', async () => {
    mockStorageGet.mockResolvedValue('ExponentPushToken[old]');
    mockGetExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[new]' });

    const result = await registerForPushNotifications();

    expect(result).toBe('registered');
    expect(mockPost).toHaveBeenNthCalledWith(1, '/api/push/register-device', expect.objectContaining({
      token: 'ExponentPushToken[new]',
    }));
    expect(mockPost).toHaveBeenNthCalledWith(2, '/api/push/unregister-device', {
      token: 'ExponentPushToken[old]',
      token_type: 'expo',
    });
    expect(mockStorageSet).toHaveBeenCalledWith('nexus_expo_push_token', 'ExponentPushToken[new]');
  });

  it('synchronises the launcher badge with a non-negative unread count', async () => {
    mockSetBadgeCountAsync.mockResolvedValue(true);

    await syncPushBadge(-3);

    expect(mockSetBadgeCountAsync).toHaveBeenCalledWith(0);
  });

  it('unregisters the same Expo push token on logout', async () => {
    await unregisterPushNotifications();

    expect(mockPost).toHaveBeenCalledWith('/api/push/unregister-device', {
      token: 'ExponentPushToken[abc123]',
      token_type: 'expo',
    });
    expect(mockStorageRemove).toHaveBeenCalledWith('nexus_expo_push_token');
  });

  // Sentry NEXUS-MOBILE-5 / NEXUS-PHP-6F: a lapsed login answered register-device
  // with 401 and was reported as a crash, from every signed-out device.
  it('does not report an expired session as an error', async () => {
    const { ApiResponseError } = jest.requireMock('@/lib/api/client');
    const Sentry = jest.requireMock('@sentry/react-native');
    mockPost.mockRejectedValueOnce(
      new ApiResponseError(401, 'Your session has expired. Please log in again.'),
    );

    const result = await registerForPushNotifications();

    expect(result).toBe('failed');
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(mockStorageSet).not.toHaveBeenCalled();
  });

  it('still reports a registration failure that is not an expired session', async () => {
    const { ApiResponseError } = jest.requireMock('@/lib/api/client');
    const Sentry = jest.requireMock('@sentry/react-native');
    mockPost.mockRejectedValueOnce(new ApiResponseError(500, 'Server error'));

    const result = await registerForPushNotifications();

    expect(result).toBe('failed');
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});

/**
 * 🔴 Android reports a tap that launched a killed app TWICE — once as the stored launch
 * response and again through the live listener — and the warm listener never cleared the
 * stored response, so a remount of the root navigator could replay an old tap. Found in
 * the 2026-10-18 push audit behind the owner's "opens Home" report.
 */
describe('push tap lifecycle hardening', () => {
  const tap = (identifier: string, data: Record<string, unknown>, actionIdentifier?: string) => ({
    actionIdentifier,
    notification: { date: 1_700_000_000, request: { identifier, content: { data } } },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    __resetNotificationResponseStateForTests();
    mockDeviceState.isDevice = true;
    mockGetLastNotificationResponse.mockReturnValue(null);
    mockGetLastNotificationResponseAsync.mockResolvedValue(null);
    mockAddNotificationResponseReceivedListener.mockReturnValue({ remove: mockResponseSubscriptionRemove });
  });

  it('handles a cold-start tap once when Android delivers it through both the stored response and the live listener', async () => {
    const response = tap('n1', { link: '/messages/7' });
    mockGetLastNotificationResponse.mockReturnValue(response);
    const onLink = jest.fn();

    observeNotificationResponses(onLink);
    await Promise.resolve();
    await Promise.resolve();
    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0]?.[0];
    listener(response);

    expect(onLink).toHaveBeenCalledTimes(1);
    expect(onLink).toHaveBeenCalledWith('/messages/7');
  });

  it('clears the stored response after a warm tap so a remount cannot replay it', () => {
    observeNotificationResponses(jest.fn());
    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0]?.[0];

    listener(tap('n2', { link: '/events/44' }));

    expect(mockClearLastNotificationResponse).toHaveBeenCalledTimes(1);
  });

  it('does not replay a tap already handled when the observer is created again', async () => {
    const response = tap('n3', { link: '/wallet' });
    const onLink = jest.fn();

    const unsubscribe = observeNotificationResponses(onLink);
    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0]?.[0];
    listener(response);
    unsubscribe();

    // The navigator remounts (session-restore gate) and the module-level store still
    // holds the response the listener delivered.
    mockGetLastNotificationResponse.mockReturnValue(response);
    observeNotificationResponses(onLink);
    await Promise.resolve();
    await Promise.resolve();

    expect(onLink).toHaveBeenCalledTimes(1);
  });

  it('leaves a breadcrumb for every tap, with the link summarised', () => {
    observeNotificationResponses(jest.fn());
    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0]?.[0];

    listener(tap('n5', { type: 'new_message', link: '/messages/7' }));

    expect(mockAddBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({
      category: 'push',
      message: 'tap',
      data: { source: 'listener', type: 'new_message', link: '/messages' },
    }));
  });

  it('ignores a notification action that is not the default tap', () => {
    const onLink = jest.fn();
    observeNotificationResponses(onLink);
    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0]?.[0];

    listener(tap('n4', { link: '/messages/7' }, 'dismiss'));

    expect(onLink).not.toHaveBeenCalled();
  });

  it('reads the stored response without the deprecated async wrapper', async () => {
    observeNotificationResponses(jest.fn());
    await Promise.resolve();
    await Promise.resolve();

    expect(mockGetLastNotificationResponse).toHaveBeenCalledTimes(1);
    expect(mockGetLastNotificationResponseAsync).not.toHaveBeenCalled();
  });

  it('follows the launch App Link only when no notification launched the app', async () => {
    const onLink = jest.fn();
    observeNotificationResponses(onLink, Promise.resolve('https://app.project-nexus.ie/events/44'));
    await Promise.resolve();
    await Promise.resolve();

    expect(onLink).toHaveBeenCalledWith('https://app.project-nexus.ie/events/44');
  });
});

describe('Android notification channels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeviceState.isDevice = true;
    Platform.OS = 'android';
    mockGetPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockGetExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc123]' });
    mockStorageGet.mockResolvedValue(null);
    mockPost.mockResolvedValue({});
  });

  it('creates a high-importance messages channel alongside default and emergency', async () => {
    await registerForPushNotifications();

    expect(mockSetNotificationChannelAsync).toHaveBeenNthCalledWith(3, 'messages', expect.objectContaining({
      importance: 'high',
    }));
  });

  it('creates the channels even on an emulator, where no push token can be issued', async () => {
    mockDeviceState.isDevice = false;

    const result = await registerForPushNotifications();

    expect(result).toBe('unavailable');
    expect(mockSetNotificationChannelAsync).toHaveBeenCalledWith('messages', expect.anything());
  });
});
