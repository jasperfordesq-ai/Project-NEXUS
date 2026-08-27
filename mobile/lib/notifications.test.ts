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

import { getNotificationLink, registerForPushNotifications, unregisterPushNotifications } from './notifications';

describe('push notification links', () => {
  it.each([
    [{ link: '/messages/1' }, '/messages/1'],
    [{ url: '/wallet' }, '/wallet'],
    [{ cta_url: 'https://app.project-nexus.ie/events/4' }, 'https://app.project-nexus.ie/events/4'],
  ])('normalises every supported producer key', (data, expected) => {
    expect(getNotificationLink(data)).toBe(expected);
  });

  it('rejects absent and non-string link values', () => {
    expect(getNotificationLink({ link: 123 })).toBeNull();
    expect(getNotificationLink(null)).toBeNull();
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
