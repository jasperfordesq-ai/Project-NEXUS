// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// --- Mocks ---

const mockUseApi = jest.fn();

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ setOptions: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'title': 'Settings',
        'account': 'Account',
        'accountHint': 'Account settings.',
        'notifications': 'Notifications',
        'privacy.title': 'Privacy',
        'privacy.hint': 'Control who can find, view, and contact you.',
        'privacy.profileVisibility': 'Profile visibility',
        'privacy.changeVisibility': 'Change',
        'privacy.searchIndexing': 'Appear in member search',
        'privacy.saveError': 'Could not save privacy settings. Please try again.',
        'privacy.visibility.public': 'Visible publicly',
        'privacy.visibility.members': 'Visible to signed-in members',
        'privacy.visibility.connections': 'Visible to your connections',
        'blockedUsers.title': 'Blocked users',
        'blockedUsers.settingsHint': 'Review blocked users.',
        'dataExport.title': 'Data export',
        'dataExport.settingsHint': 'Request your data.',
        'linkedAccounts.title': 'Linked accounts',
        'linkedAccounts.settingsHint': 'Manage delegated account access.',
        'translation.preferencesTitle': 'Content preferences',
        'translation.preferencesHint': 'Language and feed ordering.',
        'translation.title': 'Translation preferences',
        'translation.settingsHint': 'Control translation.',
        'editProfile': 'Edit profile',
        'editProfileHint': 'Edit profile details.',
        'pushNotifications': 'Push Notifications',
        'emailNotifications': 'Email Notifications',
        'push.device': 'Allow notifications on this device',
        'push.promotions': 'Promotional notifications',
        'email.messages': 'Email Messages',
        'email.connections': 'Connections',
        'email.transactions': 'Email Transactions',
        'email.reviews': 'Reviews',
        'about': 'About',
        'version': 'Version',
        'license': 'License',
        'security': 'Security',
        'changePassword': 'Change Password',
        'changePasswordHint': 'Change password.',
        'identity.page_title': 'Verify Identity',
        'identity.hint': 'Verify identity.',
        'saveError': 'Failed to save.',
        'common:errors.generic': 'Error',
        'appearance.title': 'Appearance',
        'appearance.hint': 'Choose how the app looks on this device.',
        'appearance.mode.system': 'System',
        'appearance.mode.systemHint': 'Match your device settings',
        'appearance.mode.light': 'Light',
        'appearance.mode.lightHint': 'Always use the light theme',
        'appearance.mode.dark': 'Dark',
        'appearance.mode.darkHint': 'Always use the dark theme',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ hasFeature: () => true }),
}));

const mockSetThemeMode = jest.fn();
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
    borderSubtle: '#eeeeee',
    error: '#e53e3e',
    success: '#22c55e',
    // 🔴 `warning` and `info` are required fields on the real theme. The mock omitted them,
    // so a dead `theme.warning ?? primary` fallback in the screen was the only thing keeping
    // this suite green — removing it crashed a row on an undefined colour (audit 2026-09-06).
    warning: '#f59e0b',
    info: '#3b82f6',
    onPrimary: '#ffffff',
  }),
  useThemeController: () => ({
    mode: 'system',
    scheme: 'dark',
    setMode: mockSetThemeMode,
  }),
}));

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/lib/api/client', () => ({
  api: {
    get: jest.fn().mockResolvedValue({ data: {} }),
    put: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockIsPushPermissionGranted = jest.fn().mockResolvedValue(true);
const mockRegisterForPushNotifications = jest.fn().mockResolvedValue('registered');
const mockUnregisterPushNotifications = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/notifications', () => ({
  isPushPermissionGranted: (...args: unknown[]) => mockIsPushPermissionGranted(...args),
  registerForPushNotifications: (...args: unknown[]) => mockRegisterForPushNotifications(...args),
  unregisterPushNotifications: (...args: unknown[]) => mockUnregisterPushNotifications(...args),
}));

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

/**
 * 🔴 Identity verification is switched off in the app for Google Play's payments policy
 * (owner decision, 2026-08-25). A getter so each test can pick the state it means, and both
 * are covered: off is what ships, on is what the constant promises still works.
 */
let mockIdentityAvailableInApp = false;
jest.mock('@/lib/constants', () => ({
  API_V2: '/api/v2',
  get IDENTITY_VERIFICATION_AVAILABLE_IN_APP() {
    return mockIdentityAvailableInApp;
  },
}));

jest.mock('expo-constants', () => ({
  default: {
    expoConfig: { version: '1.0.0' },
  },
}));

// --- Tests ---

import SettingsScreen from './settings';
import { api } from '@/lib/api/client';

const notificationState = {
  data: {
    data: {
      email_messages: true,
      email_connections: true,
      email_transactions: false,
      email_reviews: true,
      push_enabled: true,
      push_campaigns_opted_in: false,
    },
  },
  isLoading: false,
  error: null,
  refresh: jest.fn(),
};

const preferencesState = {
  data: {
    data: {
      privacy: {
        privacy_profile: 'members',
        privacy_search: true,
      },
    },
  },
  isLoading: false,
  error: null,
  refresh: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  let call = 0;
  mockUseApi.mockImplementation(() => {
    call += 1;
    return call % 2 === 1 ? notificationState : preferencesState;
  });
});

describe('SettingsScreen', () => {
  it('renders without crashing', () => {
    const { toJSON } = render(<SettingsScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders the Push Notifications section heading', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Push Notifications')).toBeTruthy();
  });

  it('offers explicit device and promotional push controls', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Allow notifications on this device')).toBeTruthy();
    expect(getByText('Promotional notifications')).toBeTruthy();
  });

  it('requests system permission only when the member enables device push', async () => {
    mockIsPushPermissionGranted.mockResolvedValueOnce(false);
    const { getByLabelText } = render(<SettingsScreen />);

    await waitFor(() => expect(mockIsPushPermissionGranted).toHaveBeenCalled());
    fireEvent(getByLabelText('Allow notifications on this device'), 'valueChange', true);

    await waitFor(() => expect(mockRegisterForPushNotifications).toHaveBeenCalledWith(true));
  });

  it('renders the Email Notifications section heading', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Email Notifications')).toBeTruthy();
  });

  it('renders the About section with version info', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('About')).toBeTruthy();
    expect(getByText('Version')).toBeTruthy();
    expect(getByText('1.0.0')).toBeTruthy();
  });

  it('renders the AGPL-3.0-or-later license label', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('AGPL-3.0-or-later')).toBeTruthy();
  });

  it('renders the Security section with Change Password button', () => {
    const { getAllByText, getByText } = render(<SettingsScreen />);
    expect(getAllByText('Account').length).toBeGreaterThan(0);
    expect(getByText('Change Password')).toBeTruthy();
  });

  it('does not offer identity verification while it is switched off', () => {
    // Absent, not disabled. A row leading to "you cannot do this here" would still be
    // advertising a paid feature the app is not allowed to sell.
    const { queryByText } = render(<SettingsScreen />);
    expect(queryByText('Verify Identity')).toBeNull();
  });

  it('renders privacy controls from user preferences', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Privacy')).toBeTruthy();
    expect(getByText('Profile visibility')).toBeTruthy();
    expect(getByText('Visible to signed-in members')).toBeTruthy();
    expect(getByText('Appear in member search')).toBeTruthy();
  });

  it('cycles and saves profile visibility privacy preference', () => {
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Change'));
    expect(api.put).toHaveBeenCalledWith('/api/v2/users/me/preferences', {
      privacy: {
        privacy_profile: 'connections',
        privacy_search: true,
      },
    });
  });

  it('navigates to change-password when Change Password is pressed', () => {
    const { router } = require('expo-router');
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Change Password'));
    expect(router.push).toHaveBeenCalledWith('/(modals)/change-password');
  });

  it('navigates to verify identity when it is switched back on', () => {
    mockIdentityAvailableInApp = true;
    try {
      const { router } = require('expo-router');
      const { getByText } = render(<SettingsScreen />);
      fireEvent.press(getByText('Verify Identity'));
      expect(router.push).toHaveBeenCalledWith('/(modals)/verify-identity');
    } finally {
      mockIdentityAvailableInApp = false;
    }
  });

  it('navigates to advanced settings screens', () => {
    const { router } = require('expo-router');
    const { getByText } = render(<SettingsScreen />);

    fireEvent.press(getByText('Blocked users'));
    expect(router.push).toHaveBeenCalledWith('/(modals)/settings-blocked-users');

    fireEvent.press(getByText('Data export'));
    expect(router.push).toHaveBeenCalledWith('/(modals)/settings-data-export');

    fireEvent.press(getByText('Linked accounts'));
    expect(router.push).toHaveBeenCalledWith('/(modals)/settings-linked-accounts');

    fireEvent.press(getByText('Translation preferences'));
    expect(router.push).toHaveBeenCalledWith('/(modals)/settings-translation');
  });

  it('renders the Appearance section with theme mode options', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Appearance')).toBeTruthy();
    expect(getByText('System')).toBeTruthy();
    expect(getByText('Light')).toBeTruthy();
    expect(getByText('Dark')).toBeTruthy();
  });

  it('sets the theme mode when an appearance option is pressed', () => {
    mockSetThemeMode.mockClear();
    const { getByText } = render(<SettingsScreen />);

    fireEvent.press(getByText('Light'));
    expect(mockSetThemeMode).toHaveBeenCalledWith('light');

    fireEvent.press(getByText('Dark'));
    expect(mockSetThemeMode).toHaveBeenCalledWith('dark');
  });
});
