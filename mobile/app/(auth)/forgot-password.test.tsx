// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockForgotPassword = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));

jest.mock('@/lib/api/auth', () => ({
  forgotPassword: (...args: unknown[]) => mockForgotPassword(...args),
}));

jest.mock('@/lib/api/client', () => ({
  ApiResponseError: class ApiResponseError extends Error {
    status!: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'ApiResponseError';
    }
  },
  registerUnauthorizedCallback: jest.fn(),
}));

import ForgotPasswordScreen from './forgot-password';

describe('ForgotPasswordScreen', () => {
  beforeEach(() => {
    mockForgotPassword.mockReset();
    mockReplace.mockReset();
  });

  it('requests a reset link with a normalized email', async () => {
    mockForgotPassword.mockResolvedValue({ success: true });

    const { getByPlaceholderText, getByText, findByText } = render(<ForgotPasswordScreen />);

    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'USER@Example.COM');
    fireEvent.press(getByText('Send reset link'));

    await waitFor(() => expect(mockForgotPassword).toHaveBeenCalledWith('user@example.com'));
    expect(await findByText('Check your email')).toBeTruthy();
  });

  it('shows validation when the email is invalid', async () => {
    const { getByPlaceholderText, getByText, findByText } = render(<ForgotPasswordScreen />);

    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'not-an-email');
    fireEvent.press(getByText('Send reset link'));

    expect(await findByText('Please enter a valid email address')).toBeTruthy();
    expect(mockForgotPassword).not.toHaveBeenCalled();
  });

  it('routes back to login', () => {
    const { getByText } = render(<ForgotPasswordScreen />);

    fireEvent.press(getByText('Back to sign in'));

    expect(mockReplace).toHaveBeenCalledWith('/login');
  });
});
