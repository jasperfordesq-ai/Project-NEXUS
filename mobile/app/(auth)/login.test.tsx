// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// --- Mocks ---

const mockLogin = jest.fn();
const mockRouterPush = jest.fn();

// Override expo-router mock so Link renders children as a Text node (queryable by text)
jest.mock('expo-router', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    useRouter: () => ({ push: mockRouterPush, replace: jest.fn(), back: jest.fn() }),
    useSegments: () => ['(auth)'],
    Link: ({ children, style }: { children: React.ReactNode; style?: any }) =>
      React.createElement(Text, { style }, children),
    router: { push: mockRouterPush, replace: jest.fn(), back: jest.fn() },
  };
});

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ login: mockLogin }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ hasFeature: () => true, tenant: null }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    surface: '#ffffff',
    text: '#000000',
    textSecondary: '#666666',
    border: '#dddddd',
    error: '#e53e3e',
    errorBg: '#fff5f5',
  }),
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

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

jest.mock('@/components/ui/Icon', () => ({ Ionicons: () => null }));

const mockGetRegistrationInfo = jest.fn();
jest.mock('@/lib/api/auth', () => ({
  getRegistrationInfo: (...args: unknown[]) => mockGetRegistrationInfo(...args),
}));

// --- Tests ---

import LoginScreen from './login';
import { ApiResponseError } from '@/lib/api/client';

describe('LoginScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders key UI elements', () => {
    const { getByText, getByPlaceholderText, getByTestId } = render(<LoginScreen />);
    expect(getByText('Sign in')).toBeTruthy();
    expect(getByPlaceholderText('you@example.com')).toBeTruthy();
    expect(getByTestId('email-input')).toBeTruthy();
    expect(getByTestId('password-input')).toBeTruthy();
    expect(getByTestId('login-submit')).toBeTruthy();
    expect(getByText('Create account')).toBeTruthy();
  });

  it('keeps the sign-in form readable on landscape tablets', () => {
    const { getByTestId } = render(<LoginScreen />);

    expect(getByTestId('login-content')).toHaveStyle({
      width: '100%',
      maxWidth: 720,
      alignSelf: 'center',
    });
  });

  it('shows field error when email is invalid on submit', async () => {
    const { getByText, getByPlaceholderText } = render(<LoginScreen />);

    // type an invalid email
    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'not-an-email');
    fireEvent.press(getByText('Sign in'));

    await waitFor(() => {
      expect(getByText('Please enter a valid email address')).toBeTruthy();
    });
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('shows field error when password is empty on submit', async () => {
    const { getByText, getByPlaceholderText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'user@example.com');
    // leave password empty
    fireEvent.press(getByText('Sign in'));

    await waitFor(() => {
      expect(getByText('Password is required')).toBeTruthy();
    });
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('calls login with trimmed, lowercased email on valid submit', async () => {
    mockLogin.mockResolvedValue(undefined);
    const { getByText, getByPlaceholderText } = render(<LoginScreen />);

    // Note: Zod validates before onSubmit trims; use a valid email, verify lowercase normalisation
    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'User@Example.COM');
    fireEvent.changeText(getByPlaceholderText('Your password'), 'mypassword');
    fireEvent.press(getByText('Sign in'));

    await waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(1));
    expect(mockLogin).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'mypassword',
    });
  });

  it('shows API error message in banner when login fails', async () => {
    mockLogin.mockRejectedValue(new ApiResponseError(401, 'Invalid credentials'));
    const { getByText, getByPlaceholderText, findByText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'user@example.com');
    fireEvent.changeText(getByPlaceholderText('Your password'), 'wrongpassword');
    fireEvent.press(getByText('Sign in'));

    expect(await findByText('Invalid credentials')).toBeTruthy();
  });

  it('shows generic error when login fails with non-API error', async () => {
    mockLogin.mockRejectedValue(new Error('Network failure'));
    const { getByText, getByPlaceholderText, findByText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'user@example.com');
    fireEvent.changeText(getByPlaceholderText('Your password'), 'somepassword');
    fireEvent.press(getByText('Sign in'));

    expect(await findByText('Unable to sign in. Please try again.')).toBeTruthy();
  });

  it('opens the registration route from the create account action', () => {
    const { getByLabelText } = render(<LoginScreen />);

    fireEvent.press(getByLabelText('Create account'));

    expect(mockRouterPush).toHaveBeenCalledWith('/register');
  });

  it('opens the native forgot-password route', () => {
    const { getByLabelText } = render(<LoginScreen />);

    fireEvent.press(getByLabelText('Forgot password?'));

    expect(mockRouterPush).toHaveBeenCalledWith('/forgot-password');
  });

  it('opens the community switcher from the switch community action', () => {
    const { getByLabelText } = render(<LoginScreen />);

    fireEvent.press(getByLabelText('Switch community'));

    expect(mockRouterPush).toHaveBeenCalledWith('/select-tenant');
  });

  /*
    🔴 A community with registration closed still offered "Create account", and the
    member could fill in the whole form before the server turned them away.
    `/v2/auth/registration-info` has always answered this; nothing asked.
    Audit 2026-09-07, fixed 2026-09-08.
  */
  describe('when the community is not taking new members', () => {
    it('does not offer to create an account', async () => {
      mockGetRegistrationInfo.mockResolvedValue({
        data: { registration_mode: 'closed', can_register: false, is_closed: true, message: null,
          requires_invite_code: false, requires_verification: false, is_waitlist: false },
      });

      const screen = render(<LoginScreen />);

      expect(await screen.findByTestId('login-registration-closed')).toBeTruthy();
      expect(screen.queryByText('Create account')).toBeNull();
    });

    it('prefers the community\'s own wording when it set one', async () => {
      mockGetRegistrationInfo.mockResolvedValue({
        data: { registration_mode: 'closed', can_register: false, is_closed: true,
          message: 'We reopen in September.', requires_invite_code: false,
          requires_verification: false, is_waitlist: false },
      });

      const screen = render(<LoginScreen />);

      expect(await screen.findByText('We reopen in September.')).toBeTruthy();
    });
  });

  it('still offers to create an account when the policy cannot be read', async () => {
    // 🔴 Failing closed here would be the worse mistake: one unanswered request
    // must not remove the only route into a community that IS open.
    mockGetRegistrationInfo.mockRejectedValue(new Error('offline'));

    const screen = render(<LoginScreen />);

    await waitFor(() => expect(screen.getByText('Create account')).toBeTruthy());
    expect(screen.queryByTestId('login-registration-closed')).toBeNull();
  });
});
