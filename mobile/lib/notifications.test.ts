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
  AndroidImportance: { MAX: 'max' },
  getExpoPushTokenAsync: (...args: unknown[]) => mockGetExpoPushTokenAsync(...args),
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissionsAsync(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissionsAsync(...args),
  setNotificationChannelAsync: (...args: unknown[]) => mockSetNotificationChannelAsync(...args),
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
  getNotificationLink,
  observeNotificationResponses,
  registerForPushNotifications,
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
    const result = await registerForPushNotifications();

    expect(result).toBe('registered');
    expect(mockGetExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'project-123' });
    expect(mockPost).toHaveBeenCalledWith('/api/push/register-device', {
      token: 'ExponentPushToken[abc123]',
      token_type: 'expo',
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
    expect(mockStorageSet).toHaveBeenCalledWith('nexus_expo_push_token', 'ExponentPushToken[abc123]');
  });

  it('does not prompt during automatic session restoration', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'undetermined' });

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

  it('unregisters the same Expo push token on logout', async () => {
    await unregisterPushNotifications();

    expect(mockPost).toHaveBeenCalledWith('/api/push/unregister-device', {
      token: 'ExponentPushToken[abc123]',
      token_type: 'expo',
    });
    expect(mockStorageRemove).toHaveBeenCalledWith('nexus_expo_push_token');
  });
});
