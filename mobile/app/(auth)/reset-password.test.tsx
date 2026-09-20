// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiResponseError } from '@/lib/api/client';

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

  it('submits a reset credential only once for simultaneous actions', async () => {
    let finish!: (value: { success: true }) => void;
    mockResetPassword.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const screen = render(<ResetPasswordScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('New password'), 'NewPassw0rd!');
    fireEvent.changeText(screen.getByPlaceholderText('Confirm password'), 'NewPassw0rd!');
    await act(async () => {
      fireEvent.press(screen.getByText('Reset password'));
      fireEvent.press(screen.getByText('Reset password'));
    });
    const calls = mockResetPassword.mock.calls.length;
    await act(async () => { finish({ success: true }); });
    expect(calls).toBe(1);
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

  it('replaces an expired-token form with a route to request a new link', async () => {
    mockResetPassword.mockRejectedValue(
      new ApiResponseError(400, 'Invalid or expired reset token.', undefined, 'AUTH_TOKEN_INVALID', 'token'),
    );
    const screen = render(<ResetPasswordScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('New password'), 'NewPassw0rd!');
    fireEvent.changeText(screen.getByPlaceholderText('Confirm password'), 'NewPassw0rd!');
    fireEvent.press(screen.getByText('Reset password'));

    expect(await screen.findByText('Invalid reset link')).toBeTruthy();
    expect(screen.queryByText('Reset password')).toBeNull();
    fireEvent.press(screen.getByText('Request a new link'));
    expect(mockReplace).toHaveBeenCalledWith('/forgot-password');
  });

  it('keeps a correctable password refusal on the form', async () => {
    mockResetPassword.mockRejectedValueOnce(
      new ApiResponseError(422, 'Choose a password you have not used before.', undefined, 'VALIDATION_ERROR', 'password'),
    ).mockResolvedValueOnce({ success: true });
    const screen = render(<ResetPasswordScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('New password'), 'NewPassw0rd!');
    fireEvent.changeText(screen.getByPlaceholderText('Confirm password'), 'NewPassw0rd!');
    fireEvent.press(screen.getByText('Reset password'));

    expect(await screen.findByText('Choose a password you have not used before.')).toBeTruthy();
    expect(screen.getByText('Reset password')).toBeTruthy();
    expect(screen.queryByText('Invalid reset link')).toBeNull();
    fireEvent.changeText(screen.getByPlaceholderText('New password'), 'AnotherNewPassw0rd!');
    fireEvent.changeText(screen.getByPlaceholderText('Confirm password'), 'AnotherNewPassw0rd!');
    fireEvent.press(screen.getByText('Reset password'));
    expect(await screen.findByText('Password updated')).toBeTruthy();
    expect(mockResetPassword).toHaveBeenCalledTimes(2);
  });

  it('clears the first link state when the route receives a different token', async () => {
    mockResetPassword.mockResolvedValue({ success: true });
    const screen = render(<ResetPasswordScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('New password'), 'NewPassw0rd!');
    fireEvent.changeText(screen.getByPlaceholderText('Confirm password'), 'NewPassw0rd!');
    fireEvent.press(screen.getByText('Reset password'));
    expect(await screen.findByText('Password updated')).toBeTruthy();

    mockParams = { token: 'replacement-token' };
    screen.rerender(<ResetPasswordScreen />);

    expect(await screen.findByText('Set a new password')).toBeTruthy();
    expect(screen.getByPlaceholderText('New password').props.value).toBe('');
    expect(screen.getByPlaceholderText('Confirm password').props.value).toBe('');
  });

  it('ignores completion from a token that the route has replaced', async () => {
    let resolveRequest!: (value: { success: true }) => void;
    mockResetPassword.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    const screen = render(<ResetPasswordScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('New password'), 'NewPassw0rd!');
    fireEvent.changeText(screen.getByPlaceholderText('Confirm password'), 'NewPassw0rd!');
    fireEvent.press(screen.getByText('Reset password'));
    await waitFor(() => expect(mockResetPassword).toHaveBeenCalled());

    mockParams = { token: 'replacement-token' };
    screen.rerender(<ResetPasswordScreen />);
    await act(async () => { resolveRequest({ success: true }); });

    expect(screen.queryByText('Password updated')).toBeNull();
    expect(screen.getByText('Set a new password')).toBeTruthy();
  });

  it('keeps the replacement request pending when an older token finishes', async () => {
    let finishOld!: (value: { success: true }) => void;
    let finishNew!: (value: { success: true }) => void;
    mockResetPassword
      .mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }))
      .mockReturnValueOnce(new Promise(resolve => { finishNew = resolve; }));
    const screen = render(<ResetPasswordScreen />);
    const submit = async () => {
      fireEvent.changeText(screen.getByPlaceholderText('New password'), 'NewPassw0rd!');
      fireEvent.changeText(screen.getByPlaceholderText('Confirm password'), 'NewPassw0rd!');
      await act(async () => { fireEvent.press(screen.getByText('Reset password')); });
    };
    await submit();
    mockParams = { token: 'replacement-token' };
    screen.rerender(<ResetPasswordScreen />);
    await submit();
    await act(async () => { finishOld({ success: true }); });
    expect(screen.queryByText('Password updated')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reset password' }).props.accessibilityState)
      .toMatchObject({ busy: true, disabled: true });
    await act(async () => { fireEvent.press(screen.getByText('Reset password')); });
    expect(mockResetPassword).toHaveBeenCalledTimes(2);
    expect(mockResetPassword.mock.calls[1][0].token).toBe('replacement-token');
    await act(async () => { finishNew({ success: true }); });
    expect(screen.getByText('Password updated')).toBeTruthy();
  });
});
