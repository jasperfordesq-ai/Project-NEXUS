// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

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
        'password.hint': 'Your new password must be at least 8 characters.',
        'password.currentLabel': 'Current Password',
        'password.currentPlaceholder': 'Enter current password',
        'password.newLabel': 'New Password',
        'password.newPlaceholder': 'Enter new password',
        'password.confirmLabel': 'Confirm New Password',
        'password.confirmPlaceholder': 'Confirm new password',
        'password.save': 'Save Password',
        'password.success': 'Password Changed',
        'password.successMessage': 'Your password has been updated successfully.',
        'password.changeError': 'Failed to change password.',
        'password.validation.currentRequired': 'Current password is required.',
        'password.footerMissing': 'Fill in all three fields to continue.',
        'password.footerMismatch': 'The new password and its confirmation do not match yet.',
        'password.validation.newRequired': 'New password is required.',
        'password.validation.tooShort': 'Password must be at least 8 characters.',
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
  useTenant: () => ({ hasFeature: () => true }),
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

describe('ChangePasswordScreen', () => {
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
    expect(getByText('Your new password must be at least 8 characters.')).toBeTruthy();
  });
});
