// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockResetPassword = jest.fn();
const mockReplace = jest.fn();
let mockParams: Record<string, string | undefined> = { token: 'reset-token' };

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));

jest.mock('@/lib/api/auth', () => ({
  resetPassword: (...args: unknown[]) => mockResetPassword(...args),
}));

import ResetPasswordScreen from './reset-password';

describe('ResetPasswordScreen', () => {
  beforeEach(() => {
    mockResetPassword.mockReset();
    mockReplace.mockReset();
    mockParams = { token: 'reset-token' };
  });

  it('submits a new password with the route token', async () => {
    mockResetPassword.mockResolvedValue({ success: true });
    const { getByPlaceholderText, getByText, findByText } = render(<ResetPasswordScreen />);

    fireEvent.changeText(getByPlaceholderText('New password'), 'NewPassw0rd!');
    fireEvent.changeText(getByPlaceholderText('Confirm password'), 'NewPassw0rd!');
    fireEvent.press(getByText('Reset password'));

    await waitFor(() => expect(mockResetPassword).toHaveBeenCalledWith({
      token: 'reset-token',
      password: 'NewPassw0rd!',
      password_confirmation: 'NewPassw0rd!',
    }));
    expect(await findByText('Password updated')).toBeTruthy();
  });

  it('shows a validation error when passwords do not match', async () => {
    const { getByPlaceholderText, getByText, findByText } = render(<ResetPasswordScreen />);

    fireEvent.changeText(getByPlaceholderText('New password'), 'NewPassw0rd!');
    fireEvent.changeText(getByPlaceholderText('Confirm password'), 'Different1!');
    fireEvent.press(getByText('Reset password'));

    expect(await findByText('Passwords do not match.')).toBeTruthy();
    expect(mockResetPassword).not.toHaveBeenCalled();
  });

  it('shows the invalid-link state when the token is missing', () => {
    mockParams = {};

    const { getByText } = render(<ResetPasswordScreen />);

    expect(getByText('Invalid reset link')).toBeTruthy();
  });
});
