// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

// --- Mocks ---

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), back: jest.fn() },
  useNavigation: () => ({
    setOptions: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
    dispatch: jest.fn(),
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'edit.title': 'Edit Profile',
        'edit.firstName': 'First Name',
        'edit.lastName': 'Last Name',
        'edit.aboutYou': 'About You',
        'edit.aboutPlaceholder': 'Tell us about yourself...',
        'edit.location': 'Location',
        'edit.locationPlaceholder': 'e.g. New York, USA',
        'edit.phoneOptional': 'Phone (Optional)',
        'edit.phonePlaceholder': '+1 555 123 4567',
        'edit.saveChanges': 'Save Changes',
        'edit.saved': 'Saved',
        'edit.savedMessage': 'Your profile has been updated.',
        'edit.saveError': 'Failed to save profile.',
        'edit.firstNameRequired': 'First name is required.',
        'edit.phoneInvalid': 'Enter a valid phone number.',
        'edit.uploadingPhoto': 'Uploading photo...',
        'edit.unsavedTitle': 'Unsaved Changes',
        'edit.unsavedMessage': 'You have unsaved changes. Discard them?',
        'edit.discard': 'Discard',
        'changePhoto': 'Change profile photo',
        'permissionNeeded': 'Permission needed',
        'permissionMessage': 'Please allow access to your photo library to change your avatar.',
        'uploadFailed': 'Upload failed',
        'uploadFailedMessage': 'Could not update your avatar. Please try again.',
        'common:buttons.cancel': 'Cancel',
        'common:buttons.done': 'Done',
        'common:errors.generic': 'Error',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

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
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));

const mockRefreshUser = jest.fn();
jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      id: 1,
      first_name: 'Jane',
      last_name: 'Doe',
      bio: 'Community builder',
      location: 'New York',
      phone: '+1 555 123 4567',
      avatar_url: null,
    },
    refreshUser: mockRefreshUser,
  }),
}));

jest.mock('@/lib/storage', () => ({
  storage: { setJson: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('@/lib/constants', () => ({
  STORAGE_KEYS: { USER_DATA: 'user_data' },
}));

jest.mock('@/lib/api/profile', () => ({
  updateProfile: jest.fn().mockResolvedValue({ data: {} }),
  updateAvatar: jest.fn().mockResolvedValue({ data: { avatar_url: '/uploads/avatars/jane.jpg' } }),
}));

jest.mock('@/lib/api/auth', () => ({
  getMe: jest.fn().mockResolvedValue({
    data: {
      id: 1,
      first_name: 'Jane',
      last_name: 'Doe',
      bio: 'Community builder',
      location: 'New York',
      phone: '+1 555 123 4567',
      avatar_url: null,
    },
  }),
}));

jest.mock('@/lib/haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

jest.mock('expo-image-picker', () => ({
  MediaTypeOptions: { Images: 'Images' },
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchImageLibraryAsync: jest.fn().mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///tmp/jane.jpg' }],
  }),
}));

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

// Auto-confirm: invoking confirm() runs the action immediately, mirroring the
// old Alert.alert button-press simulation.
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (opts: { onConfirm: () => void | Promise<void> }) => {
      void opts.onConfirm();
    },
    confirmDialog: null,
  }),
}));

jest.mock('@/components/OfflineBanner', () => () => null);
jest.mock('@/components/ui/Input', () => {
  const { View, Text, TextInput: RNTextInput } = require('react-native');
  return function MockInput(props: { value?: string; placeholder?: string; onChangeText?: (t: string) => void; error?: string }) {
    return (
      <View>
        <RNTextInput
          value={props.value}
          placeholder={props.placeholder}
          onChangeText={props.onChangeText}
          testID={props.placeholder}
        />
        {props.error ? <Text>{props.error}</Text> : null}
      </View>
    );
  };
});
jest.mock('@/components/ui/Button', () => {
  const { TouchableOpacity, Text } = require('react-native');
  return function MockButton(props: { children?: React.ReactNode; onPress?: () => void; disabled?: boolean; accessibilityLabel?: string }) {
    return (
      <TouchableOpacity onPress={props.onPress} disabled={props.disabled} accessibilityLabel={props.accessibilityLabel}>
        <Text>{props.children}</Text>
      </TouchableOpacity>
    );
  };
});

// --- Tests ---

import EditProfileScreen from './edit-profile';
import { updateAvatar, updateProfile } from '@/lib/api/profile';
import { getMe } from '@/lib/api/auth';

describe('EditProfileScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { toJSON } = render(<EditProfileScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders the field labels', () => {
    const { getByText } = render(<EditProfileScreen />);
    expect(getByText('First Name')).toBeTruthy();
    expect(getByText('Last Name')).toBeTruthy();
    expect(getByText('About You')).toBeTruthy();
    expect(getByText('Location')).toBeTruthy();
    expect(getByText('Phone (Optional)')).toBeTruthy();
  });

  it('renders the Save Changes button', () => {
    const { getByText } = render(<EditProfileScreen />);
    expect(getByText('Save Changes')).toBeTruthy();
  });

  it('uploads a new avatar from the photo library', async () => {
    const { getByLabelText } = render(<EditProfileScreen />);

    fireEvent.press(getByLabelText('Change profile photo'));

    await waitFor(() => expect(updateAvatar).toHaveBeenCalledWith('file:///tmp/jane.jpg'));
    await waitFor(() => expect(mockRefreshUser).toHaveBeenCalledWith(expect.objectContaining({
      avatar_url: expect.stringContaining('/uploads/avatars/jane.jpg?v='),
    })));
  });

  it('keeps a freshly uploaded avatar if profile hydration returns stale data', async () => {
    let resolveProfile: (value: unknown) => void = () => undefined;
    (getMe as jest.Mock).mockReturnValueOnce(new Promise((resolve) => {
      resolveProfile = resolve;
    }));

    const { getByLabelText } = render(<EditProfileScreen />);

    fireEvent.press(getByLabelText('Change profile photo'));

    await waitFor(() => expect(updateAvatar).toHaveBeenCalledWith('file:///tmp/jane.jpg'));

    await act(async () => {
      resolveProfile({
        data: {
          id: 1,
          first_name: 'Jane',
          last_name: 'Doe',
          bio: 'Community builder',
          location: 'New York',
          phone: '+1 555 123 4567',
          avatar_url: null,
        },
      });
    });

    await waitFor(() => {
      expect(mockRefreshUser.mock.calls.length).toBeGreaterThanOrEqual(2);
      const lastRefresh = mockRefreshUser.mock.calls.at(-1)?.[0];
      expect(lastRefresh).toEqual(expect.objectContaining({
        avatar_url: expect.stringContaining('/uploads/avatars/jane.jpg?v='),
      }));
    });
  });

  it('pre-fills form fields with user data', () => {
    const { getByDisplayValue } = render(<EditProfileScreen />);
    expect(getByDisplayValue('Jane')).toBeTruthy();
    expect(getByDisplayValue('Doe')).toBeTruthy();
    expect(getByDisplayValue('Community builder')).toBeTruthy();
    expect(getByDisplayValue('New York')).toBeTruthy();
  });

  it('renders placeholders on inputs', () => {
    const { getByPlaceholderText } = render(<EditProfileScreen />);
    expect(getByPlaceholderText('Tell us about yourself...')).toBeTruthy();
    expect(getByPlaceholderText('e.g. New York, USA')).toBeTruthy();
  });

  it('sends an empty phone value when the user clears their phone number', async () => {
    (updateProfile as jest.Mock).mockResolvedValueOnce({
      data: {
        id: 1,
        first_name: 'Jane',
        last_name: 'Doe',
        bio: 'Community builder',
        location: 'New York',
        phone: '',
        avatar_url: null,
      },
    });

    const { getByDisplayValue, getByText } = render(<EditProfileScreen />);

    fireEvent.changeText(getByDisplayValue('+1 555 123 4567'), '');
    fireEvent.press(getByText('Save Changes'));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith(expect.objectContaining({
      phone: '',
    })));
  });
});
