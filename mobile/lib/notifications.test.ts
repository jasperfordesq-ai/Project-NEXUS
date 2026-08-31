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
const mockResponseSubscriptionRemove = jest.fn();
const mockAddNotificationResponseReceivedListener = jest.fn();

jest.mock('expo-device', () => ({
  isDevice: true,
}));

jest.mock('expo-constants', () => ({
  expoConfig: { extra: { eas: { projectId: 'project-123' } } },
}));

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 'default', MAX: 'max' },
  IosAuthorizationStatus: { AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
  getExpoPushTokenAsync: (...args: unknown[]) => mockGetExpoPushTokenAsync(...args),
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissionsAsync(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissionsAsync(...args),
  setNotificationChannelAsync: (...args: unknown[]) => mockSetNotificationChannelAsync(...args),
  setBadgeCountAsync: (...args: unknown[]) => mockSetBadgeCountAsync(...args),
  setNotificationHandler: jest.fn(),
  getLastNotificationResponseAsync: (...args: unknown[]) => mockGetLastNotificationResponseAsync(...args),
  clearLastNotificationResponseAsync: (...args: unknown[]) => mockClearLastNotificationResponseAsync(...args),
  addNotificationResponseReceivedListener: (...args: unknown[]) => mockAddNotificationResponseReceivedListener(...args),
}));

jest.mock('@sentry/react-native', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

jest.mock('@/lib/api/client', () => ({
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

  it('keeps group chatroom pushes in the inbox until the native app has a group chat screen', () => {
    expect(getNotificationLink({
      type: 'group_chatroom_message',
      link: '/groups/42/chat',
    })).toBe('/notifications');
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
    '/groups/42/chat',
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
    mockAddNotificationResponseReceivedListener.mockReturnValue({ remove: mockResponseSubscriptionRemove });
  });

  it('replays and clears the notification that launched a killed app', async () => {
    mockGetLastNotificationResponseAsync.mockResolvedValue({
      notification: { request: { content: { data: { link: '/messages/123' } } } },
    });
    const onLink = jest.fn();

    const unsubscribe = observeNotificationResponses(onLink);
    await Promise.resolve();
    await Promise.resolve();

    expect(onLink).toHaveBeenCalledWith('/messages/123');
    expect(mockClearLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
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
});
