// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));

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
  PermissionStatus: { GRANTED: 'granted' },
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
  return function MockInput(props: { value?: string; placeholder?: string; onChangeText?: (t: string) => void; error?: string; editable?: boolean }) {
    return (
      <View>
        <RNTextInput
          value={props.value}
          placeholder={props.placeholder}
          onChangeText={props.onChangeText}
          editable={props.editable}
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
import { storage } from '@/lib/storage';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from '@/lib/haptics';

const defaultProfileResponse = {
  data: {
    id: 1,
    first_name: 'Jane',
    last_name: 'Doe',
    bio: 'Community builder',
    location: 'New York',
    phone: '+1 555 123 4567',
    avatar_url: null,
  },
};

describe('EditProfileScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getMe as jest.Mock).mockReset().mockResolvedValue(defaultProfileResponse);
  });

  it('renders without crashing', async () => {
    const { toJSON } = render(<EditProfileScreen />);
    await act(async () => {});
    expect(toJSON()).toBeTruthy();
  });

  it('renders the field labels', async () => {
    const { getByText } = render(<EditProfileScreen />);
    await act(async () => {});
    expect(getByText('First Name')).toBeTruthy();
    expect(getByText('Last Name')).toBeTruthy();
    expect(getByText('About You')).toBeTruthy();
    expect(getByText('Location')).toBeTruthy();
    expect(getByText('Phone (Optional)')).toBeTruthy();
  });

  it('renders the Save Changes button', async () => {
    const { getByText } = render(<EditProfileScreen />);
    await act(async () => {});
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

  it('serializes rapid avatar selection before permission or picker state rerenders', async () => {
    const { getByLabelText } = render(<EditProfileScreen />);

    act(() => {
      fireEvent.press(getByLabelText('Change profile photo'));
      fireEvent.press(getByLabelText('Change profile photo'));
    });

    await waitFor(() => expect(updateAvatar).toHaveBeenCalledTimes(1));
    expect(ImagePicker.requestMediaLibraryPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('does not upload a photo returned after leaving the profile editor', async () => {
    let resolvePicker!: (value: ImagePicker.ImagePickerResult) => void;
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockReturnValueOnce(new Promise((resolve) => { resolvePicker = resolve; }));
    const screen = render(<EditProfileScreen />);
    fireEvent.press(screen.getByLabelText('Change profile photo'));
    await waitFor(() => expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled());
    screen.unmount();
    await act(async () => resolvePicker({ canceled: false, assets: [{ uri: 'file:///tmp/departed.jpg', width: 100, height: 100 }] }));
    expect(updateAvatar).not.toHaveBeenCalled();
  });

  it('does not open the photo picker when permission resolves after departure', async () => {
    let resolvePermission!: (value: ImagePicker.MediaLibraryPermissionResponse) => void;
    jest.mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockReturnValueOnce(new Promise((resolve) => { resolvePermission = resolve; }));
    const screen = render(<EditProfileScreen />);
    fireEvent.press(screen.getByLabelText('Change profile photo'));
    screen.unmount();
    await act(async () => resolvePermission({ granted: true, canAskAgain: true, expires: 'never', status: ImagePicker.PermissionStatus.GRANTED }));
    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
    expect(updateAvatar).not.toHaveBeenCalled();
  });

  it('keeps an accepted avatar update successful when the local user cache cannot refresh', async () => {
    const { getByLabelText } = render(<EditProfileScreen />);
    await waitFor(() => expect(storage.setJson).toHaveBeenCalled());
    (storage.setJson as jest.Mock).mockClear();
    (storage.setJson as jest.Mock).mockRejectedValueOnce(new Error('cache unavailable'));

    fireEvent.press(getByLabelText('Change profile photo'));

    await waitFor(() => expect(Haptics.notificationAsync).toHaveBeenCalledWith('success'));
    expect(mockRefreshUser).toHaveBeenCalledWith(expect.objectContaining({
      avatar_url: expect.stringContaining('/uploads/avatars/jane.jpg?v='),
    }));
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

  it('merges a later avatar into the latest hydrated profile', async () => {
    (getMe as jest.Mock).mockResolvedValueOnce({
      data: {
        id: 1,
        first_name: 'Jane',
        last_name: 'Doe',
        bio: 'New biography from the server',
        location: 'New York',
        phone: '+1 555 123 4567',
        avatar_url: null,
      },
    });
    const { getByLabelText } = render(<EditProfileScreen />);
    await waitFor(() => expect(mockRefreshUser).toHaveBeenCalledWith(expect.objectContaining({
      bio: 'New biography from the server',
    })));
    mockRefreshUser.mockClear();

    fireEvent.press(getByLabelText('Change profile photo'));

    await waitFor(() => expect(mockRefreshUser).toHaveBeenCalledWith(expect.objectContaining({
      bio: 'New biography from the server',
      avatar_url: expect.stringContaining('/uploads/avatars/jane.jpg?v='),
    })));
  });

  it('pre-fills form fields with user data', async () => {
    const { getByDisplayValue } = render(<EditProfileScreen />);
    await act(async () => {});
    expect(getByDisplayValue('Jane')).toBeTruthy();
    expect(getByDisplayValue('Doe')).toBeTruthy();
    expect(getByDisplayValue('Community builder')).toBeTruthy();
    expect(getByDisplayValue('New York')).toBeTruthy();
  });

  it('does not overwrite an edit made while the full profile is loading', async () => {
    let resolveProfile!: (value: unknown) => void;
    (getMe as jest.Mock).mockReturnValueOnce(new Promise((resolve) => { resolveProfile = resolve; }));
    const { getByDisplayValue } = render(<EditProfileScreen />);

    fireEvent.changeText(getByDisplayValue('Jane'), 'Janet');
    await act(async () => resolveProfile({
      data: {
        id: 1,
        first_name: 'Jane',
        last_name: 'Doe',
        bio: 'Community builder',
        location: 'New York',
        phone: '+1 555 123 4567',
        avatar_url: null,
      },
    }));

    expect(getByDisplayValue('Janet')).toBeTruthy();
  });

  it('renders placeholders on inputs', async () => {
    const { getByPlaceholderText } = render(<EditProfileScreen />);
    await act(async () => {});
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
    await waitFor(() => expect(storage.setJson).toHaveBeenCalled());

    fireEvent.changeText(getByDisplayValue('+1 555 123 4567'), '');
    fireEvent.press(getByText('Save Changes'));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith(expect.objectContaining({
      phone: '',
    })));
  });

  it('serializes save and locks the submitted fields before React rerenders', async () => {
    let finish!: (value: unknown) => void;
    (updateProfile as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { getByDisplayValue, getByText, getByPlaceholderText } = render(<EditProfileScreen />);
    await waitFor(() => expect(storage.setJson).toHaveBeenCalled());
    fireEvent.changeText(getByDisplayValue('Community builder'), 'Updated profile');

    act(() => {
      fireEvent.press(getByText('Save Changes'));
      fireEvent.press(getByText('Save Changes'));
    });

    expect(updateProfile).toHaveBeenCalledTimes(1);
    expect(getByPlaceholderText('Tell us about yourself...').props.editable).toBe(false);
    await act(async () => finish({ data: {
      id: 1,
      first_name: 'Jane',
      last_name: 'Doe',
      bio: 'Updated profile',
      location: 'New York',
      phone: '+1 555 123 4567',
      avatar_url: null,
    } }));
  });

  it('does not report a committed profile save as failed when local cache refresh fails', async () => {
    (updateProfile as jest.Mock).mockResolvedValueOnce({ data: {
      id: 1,
      first_name: 'Janet',
      last_name: 'Doe',
      bio: 'Community builder',
      location: 'New York',
      phone: '+1 555 123 4567',
      avatar_url: null,
    } });
    const { router } = require('expo-router');
    const { getByDisplayValue, getByText } = render(<EditProfileScreen />);
    await waitFor(() => expect(storage.setJson).toHaveBeenCalled());
    (storage.setJson as jest.Mock).mockClear();
    (storage.setJson as jest.Mock).mockRejectedValueOnce(new Error('cache unavailable'));
    fireEvent.changeText(getByDisplayValue('Jane'), 'Janet');
    fireEvent.press(getByText('Save Changes'));

    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(updateProfile).toHaveBeenCalledTimes(1);
  });

  it('keeps a newer queued edit open when the submitted profile finishes saving', async () => {
    let finish!: (value: unknown) => void;
    (updateProfile as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { router } = require('expo-router');
    const screen = render(<EditProfileScreen />);
    await waitFor(() => expect(storage.setJson).toHaveBeenCalled());
    fireEvent.changeText(screen.getByDisplayValue('Community builder'), 'Submitted bio');
    fireEvent.press(screen.getByText('Save Changes'));
    // A native change already queued before editable=false can still be delivered.
    act(() => screen.getByPlaceholderText('Tell us about yourself...').props.onChangeText('Newer draft'));
    await act(async () => finish({ data: { ...defaultProfileResponse.data, bio: 'Submitted bio' } }));
    expect(screen.getByDisplayValue('Newer draft')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Tell us about yourself...').props.editable).toBe(true);
    expect(mockRefreshUser).toHaveBeenLastCalledWith(expect.objectContaining({ bio: 'Submitted bio' }));
  });

  it('preserves the profile draft and unlocks retry after a failed save', async () => {
    (updateProfile as jest.Mock).mockRejectedValueOnce(new Error('Unavailable'));
    const { router } = require('expo-router');
    const screen = render(<EditProfileScreen />);
    await waitFor(() => expect(storage.setJson).toHaveBeenCalled());
    fireEvent.changeText(screen.getByDisplayValue('Community builder'), 'Preserved draft');
    fireEvent.press(screen.getByText('Save Changes'));
    await waitFor(() => expect(screen.getByPlaceholderText('Tell us about yourself...').props.editable).toBe(true));
    expect(screen.getByDisplayValue('Preserved draft')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
    (updateProfile as jest.Mock).mockResolvedValueOnce({ data: { ...defaultProfileResponse.data, bio: 'Preserved draft' } });
    fireEvent.press(screen.getByText('Save Changes'));
    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(updateProfile).toHaveBeenCalledTimes(2);
  });

  it('does not reload stale profile data while a save is pending', async () => {
    (getMe as jest.Mock).mockRejectedValueOnce(new Error('Profile unavailable'));
    let finish!: (value: unknown) => void;
    (updateProfile as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const screen = render(<EditProfileScreen />);
    await screen.findByTestId('profile-load-error');
    let retry = screen.getByText('common:buttons.retry');
    while (!retry.props.onPress && retry.parent) retry = retry.parent;
    const retryLoad = retry.props.onPress;
    fireEvent.changeText(screen.getByDisplayValue('Community builder'), 'Saved draft');
    fireEvent.press(screen.getByText('Save Changes'));
    await act(async () => { retryLoad(); });
    expect(getMe).toHaveBeenCalledTimes(1);
    await act(async () => finish({ data: { ...defaultProfileResponse.data, bio: 'Saved draft' } }));
  });

  it('does not resubmit untouched cached fields when full profile loading fails', async () => {
    (getMe as jest.Mock).mockRejectedValueOnce(new Error('Profile unavailable'));
    const screen = render(<EditProfileScreen />);
    await act(async () => {});
    fireEvent.changeText(screen.getByDisplayValue('Jane'), 'Janet');
    fireEvent.press(screen.getByText('Save Changes'));
    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ first_name: 'Janet' }));
  });

  it.each([false, true])('retries profile loading while preserving a changed draft: %s', async (editDraft) => {
    (getMe as jest.Mock).mockRejectedValueOnce(new Error('Profile unavailable'));
    const screen = render(<EditProfileScreen />);
    await screen.findByTestId('profile-load-error');
    if (editDraft) fireEvent.changeText(screen.getByDisplayValue('Community builder'), 'Unsaved local bio');
    (getMe as jest.Mock).mockResolvedValueOnce({ data: { ...defaultProfileResponse.data, bio: 'Fresh server bio' } });
    fireEvent.press(screen.getByText('common:buttons.retry'));
    await waitFor(() => expect(getMe).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('profile-load-error')).toBeNull());
    expect(screen.getByDisplayValue(editDraft ? 'Unsaved local bio' : 'Fresh server bio')).toBeTruthy();
  });
});
