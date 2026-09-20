// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';

const mockEndSessionLocally = jest.fn().mockResolvedValue(undefined);
const mockSessionIsCurrent = jest.fn(() => true);

jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));

// --- Mocks ---

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
        'password.title': 'Change Password',
        'password.hint': 'Enter your current password, then choose a new one.',
        'password.currentLabel': 'Current Password',
        'password.currentPlaceholder': 'Enter current password',
        'password.newLabel': 'New Password',
        'password.newPlaceholder': 'Enter new password',
        'password.confirmLabel': 'Confirm New Password',
        'password.confirmPlaceholder': 'Confirm new password',
        'password.save': 'Save Password',
        'password.success': 'Password Changed',
        'password.successMessage': 'Your password has been updated successfully.',
        'password.successSignIn': 'Sign in again with your new password.',
        'password.unconfirmedTitle': 'Check your password',
        'password.unconfirmedMessage': 'Try your new password first, then your previous password.',
        'password.changeError': 'Failed to change password.',
        'password.validation.currentRequired': 'Current password is required.',
        'password.footerMissing': 'Fill in all three fields to continue.',
        'password.footerMismatch': 'The new password and its confirmation do not match yet.',
        'password.validation.newRequired': 'New password is required.',
        'password.newHint': 'Use at least 12 characters.',
        'password.validation.tooShort': 'Password must be at least 12 characters.',
        'password.validation.mismatch': 'Passwords do not match.',
        'common:buttons.done': 'Done',
        'common:errors.generic': 'Error',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true }),
}));
jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 1 }, endSessionLocally: mockEndSessionLocally, captureSessionGuard: () => mockSessionIsCurrent }),
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
    success: '#22c55e',
    warning: '#f59e0b',
    info: '#3b82f6',
    errorBg: '#fef2f2',
    successBg: '#f0fdf4',
    infoBg: '#eff6ff',
    warningBg: '#fffbeb',
  }),
}));

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/lib/api/profile', () => ({
  updatePassword: jest.fn().mockResolvedValue(undefined),
}));

// Input and Button use already-mocked useTheme/usePrimaryColor — no extra mocks needed

jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

jest.mock('@/components/OfflineBanner', () => () => null);

// --- Tests ---

import ChangePasswordScreen from './change-password';
import { updatePassword } from '@/lib/api/profile';
import { ApiResponseError } from '@/lib/api/client';

const mockUpdatePassword = updatePassword as jest.MockedFunction<typeof updatePassword>;

beforeEach(() => {
  jest.clearAllMocks();
  mockSessionIsCurrent.mockReturnValue(true);
  mockUpdatePassword.mockResolvedValue(undefined);
  mockEndSessionLocally.mockResolvedValue(undefined);
});

describe('ChangePasswordScreen', () => {
  it.each([false, true])('handles a lost password response after departure only for its session (replaced=%s)', async (replaced) => {
    let reject!: (error: Error) => void;
    mockUpdatePassword.mockImplementationOnce(() => new Promise((_, rejectRequest) => { reject = rejectRequest; }));
    const screen = render(<ChangePasswordScreen />);
    fireEvent.changeText(screen.getByLabelText('Current Password'), 'old-password');
    fireEvent.changeText(screen.getByLabelText('New Password'), 'new-password-123');
    fireEvent.changeText(screen.getByLabelText('Confirm New Password'), 'new-password-123');
    fireEvent.press(screen.getByText('Save Password'));
    screen.unmount();
    mockSessionIsCurrent.mockReturnValue(!replaced);
    await act(async () => reject(new ApiResponseError(0, 'Network request failed')));
    expect(mockEndSessionLocally).toHaveBeenCalledTimes(replaced ? 0 : 1);
    if (!replaced) expect(mockEndSessionLocally).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' }));
  });

  it.each([false, true])('finishes only the submitting session after departure (replaced=%s)', async (replaced) => {
    let finish!: () => void;
    mockUpdatePassword.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve(undefined); }));
    const screen = render(<ChangePasswordScreen />);
    fireEvent.changeText(screen.getByLabelText('Current Password'), 'old-password');
    fireEvent.changeText(screen.getByLabelText('New Password'), 'new-password-123');
    fireEvent.changeText(screen.getByLabelText('Confirm New Password'), 'new-password-123');
    fireEvent.press(screen.getByText('Save Password'));
    screen.unmount();
    mockSessionIsCurrent.mockReturnValue(!replaced);
    await act(async () => finish());
    expect(mockEndSessionLocally).toHaveBeenCalledTimes(replaced ? 0 : 1);
  });

  it('does not change a password from a retained callback after departure', async () => {
    const screen = render(<ChangePasswordScreen />);
    fireEvent.changeText(screen.getByLabelText('Current Password'), 'old-password');
    fireEvent.changeText(screen.getByLabelText('New Password'), 'new-password-123');
    fireEvent.changeText(screen.getByLabelText('Confirm New Password'), 'new-password-123');
    let button = screen.getByText('Save Password');
    while (!button.props.onPress && button.parent) button = button.parent;
    const onPress = button.props.onPress;
    expect(onPress).toEqual(expect.any(Function));
    screen.unmount();
    await act(async () => { onPress(); });
    expect(mockUpdatePassword).not.toHaveBeenCalled();
  });

  it('renders without crashing', () => {
    const { toJSON } = render(<ChangePasswordScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('shows all three password input labels', () => {
    const { getByText } = render(<ChangePasswordScreen />);
    expect(getByText('Current Password')).toBeTruthy();
    expect(getByText('New Password')).toBeTruthy();
    expect(getByText('Confirm New Password')).toBeTruthy();
  });

  it('shows the Save Password submit button', () => {
    const { getByText } = render(<ChangePasswordScreen />);
    expect(getByText('Save Password')).toBeTruthy();
  });

  it('tells the member in the footer what is still missing instead of "Ready to update?" alone', () => {
    const { getByText } = render(<ChangePasswordScreen />);
    expect(getByText('Fill in all three fields to continue.')).toBeTruthy();
  });

  it('shows validation errors when the form is submitted with empty fields', async () => {
    const { getByText } = render(<ChangePasswordScreen />);

    fireEvent.press(getByText('Save Password'));

    // Wait for state update to propagate
    await Promise.resolve();

    expect(getByText('Current password is required.')).toBeTruthy();
    expect(getByText('New password is required.')).toBeTruthy();
  });

  it('shows hint text describing the password requirements', () => {
    const { getByText } = render(<ChangePasswordScreen />);
    expect(getByText('Use at least 12 characters.')).toBeTruthy();
  });

  it('serializes rapid saves and locks all password fields while the submitted credentials are pending', async () => {
    let finish!: () => void;
    mockUpdatePassword.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve(undefined); }));
    const screen = render(<ChangePasswordScreen />);
    fireEvent.changeText(screen.getByLabelText('Current Password'), 'old-password');
    fireEvent.changeText(screen.getByLabelText('New Password'), 'new-password-123');
    fireEvent.changeText(screen.getByLabelText('Confirm New Password'), 'new-password-123');

    const save = screen.getByText('Save Password');
    fireEvent.press(save);
    fireEvent.press(save);
    expect(mockUpdatePassword).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByLabelText('Current Password')).toHaveProp('editable', false);
      expect(screen.getByLabelText('New Password')).toHaveProp('editable', false);
      expect(screen.getByLabelText('Confirm New Password')).toHaveProp('editable', false);
    });

    await act(async () => finish());
  });

  it('ends the revoked local session after a confirmed password change', async () => {
    const screen = render(<ChangePasswordScreen />);
    fireEvent.changeText(screen.getByLabelText('Current Password'), 'old-password');
    fireEvent.changeText(screen.getByLabelText('New Password'), 'new-password-123');
    fireEvent.changeText(screen.getByLabelText('Confirm New Password'), 'new-password-123');

    fireEvent.press(screen.getByText('Save Password'));

    await waitFor(() => expect(mockEndSessionLocally).toHaveBeenCalledWith({
      title: 'Password Changed',
      description: 'Sign in again with your new password.',
      variant: 'success',
    }));
  });

  it('ends the session with honest guidance when the password response is lost', async () => {
    mockUpdatePassword.mockRejectedValueOnce(new ApiResponseError(0, 'Network request failed'));
    const screen = render(<ChangePasswordScreen />);
    fireEvent.changeText(screen.getByLabelText('Current Password'), 'old-password');
    fireEvent.changeText(screen.getByLabelText('New Password'), 'new-password-123');
    fireEvent.changeText(screen.getByLabelText('Confirm New Password'), 'new-password-123');

    fireEvent.press(screen.getByText('Save Password'));

    await waitFor(() => expect(mockEndSessionLocally).toHaveBeenCalledWith({
      title: 'Check your password',
      description: 'Try your new password first, then your previous password.',
      variant: 'warning',
    }));
  });
});
