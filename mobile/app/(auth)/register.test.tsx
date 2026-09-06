// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { ScrollView } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// --- Mocks ---

const mockApiRegister = jest.fn();
const mockExtractToken: jest.Mock<any, any> = jest.fn((r: { access_token?: string }) => r.access_token ?? '');
const mockStorageSet = jest.fn().mockResolvedValue(undefined);
const mockStorageSetJson = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-router', () => {
  const React = require('react');
  const { Text } = require('react-native');
  // Define router inside the factory so it is always initialized when the factory runs
  const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
  return {
    useRouter: () => router,
    useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn() }),
    Link: ({ children, style }: { children: React.ReactNode; style?: any }) =>
      React.createElement(Text, { style }, children),
    router,
  };
});

// Access the mock router via requireMock so the same object instance is used in assertions
const mockRouter = jest.requireMock('expo-router').router as {
  push: jest.Mock; replace: jest.Mock; back: jest.Mock;
};

jest.mock('@/lib/api/auth', () => ({
  register: (...args: any[]) => mockApiRegister(...args),
  extractToken: (...args: any[]) => mockExtractToken(...args),
  getRegistrationResult: (response: any) => ('data' in response ? response.data : response),
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
}));

jest.mock('@/lib/constants', () => ({
  STORAGE_KEYS: {
    AUTH_TOKEN: 'auth_token',
    REFRESH_TOKEN: 'refresh_token',
    USER_DATA: 'user_data',
  },
}));

jest.mock('@/lib/storage', () => ({
  storage: {
    set: (...args: unknown[]) => mockStorageSet(...args),
    setJson: (...args: unknown[]) => mockStorageSetJson(...args),
    get: jest.fn().mockResolvedValue(null),
    remove: jest.fn().mockResolvedValue(undefined),
    getJson: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('@/lib/notifications', () => ({
  registerForPushNotifications: jest.fn().mockResolvedValue(undefined),
  unregisterPushNotifications: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({
    user: null, token: null, isLoading: false, isAuthenticated: false,
    login: jest.fn(), logout: jest.fn(), displayName: '',
    setSession: jest.fn(), refreshUser: jest.fn(),
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
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

// --- Tests ---

import RegisterScreen from './register';
import { ApiResponseError } from '@/lib/api/client';

const mockUser = {
  id: 1, first_name: 'Jane', last_name: 'Smith',
  email: 'jane@example.com', avatar_url: null,
  tenant_id: 1, role: 'member', is_admin: false, onboarding_completed: false,
};

const validAuthResponse = {
  success: true,
  access_token: 'tok_abc',
  refresh_token: 'ref_xyz',
  token_type: 'Bearer' as const,
  expires_in: 3600,
  user: mockUser,
};

// "Create account" appears as both the screen title and the submit button label.
// The button is always the last match — pick it with .at(-1).
function pressSubmit(getAllByText: ReturnType<typeof render>['getAllByText']) {
  fireEvent.press(getAllByText('Create account').at(-1)!);
}

type RegisterFixture = {
  firstName: string;
  lastName: string;
  phone: string;
  location: string;
  email: string;
  password: string;
  passwordConfirm: string;
  termsAccepted: boolean;
};

const defaultRegisterFixture: RegisterFixture = {
  firstName: 'Jane',
  lastName: 'Smith',
  phone: '+1 555 123 4567',
  location: 'Toronto, Canada',
  email: 'jane@example.com',
  password: 'TestPassword123!',
  passwordConfirm: 'TestPassword123!',
  termsAccepted: true,
};

function fillRequiredRegistrationFields(
  getByTestId: ReturnType<typeof render>['getByTestId'],
  getByText: ReturnType<typeof render>['getByText'],
  overrides: Partial<RegisterFixture> = {},
) {
  const values = { ...defaultRegisterFixture, ...overrides };

  fireEvent.changeText(getByTestId('register-first-name'), values.firstName);
  fireEvent.changeText(getByTestId('register-last-name'), values.lastName);
  fireEvent.changeText(getByTestId('register-phone'), values.phone);
  fireEvent.changeText(getByTestId('register-location'), values.location);
  fireEvent.changeText(getByTestId('register-email'), values.email);
  fireEvent.changeText(getByTestId('register-password'), values.password);
  fireEvent.changeText(getByTestId('register-confirm-password'), values.passwordConfirm);

  if (values.termsAccepted) {
    // 🔴 By testID, not by label text. This looked up the checkbox by its English
    // sentence, so adding the 18+ declaration to the sign-up wording on 2026-08-25 broke
    // ten tests in this file for a reason that had nothing to do with what they assert.
    // The label text is asserted deliberately, once, by scripts/check-age-declaration.mjs.
    fireEvent.press(getByTestId('register-terms'));
  }
}

describe('RegisterScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorageSet.mockResolvedValue(undefined);
    mockStorageSetJson.mockResolvedValue(undefined);
  });

  it('renders key form elements', () => {
    const { getAllByText, getByPlaceholderText, getByTestId } = render(<RegisterScreen />);
    // Both the heading and the button have this text; at least one must exist
    expect(getAllByText('Create account').length).toBeGreaterThanOrEqual(1);
    expect(getByPlaceholderText('Jane')).toBeTruthy();       // first name
    expect(getByPlaceholderText('+1 555 123 4567')).toBeTruthy(); // phone
    expect(getByPlaceholderText('City, country')).toBeTruthy(); // location
    expect(getByPlaceholderText('you@example.com')).toBeTruthy(); // email
    expect(getByTestId('register-first-name')).toBeTruthy();
    expect(getByTestId('register-last-name')).toBeTruthy();
    expect(getByTestId('register-phone')).toBeTruthy();
    expect(getByTestId('register-location')).toBeTruthy();
    expect(getByTestId('register-email')).toBeTruthy();
    expect(getByTestId('register-password')).toBeTruthy();
    expect(getByTestId('register-confirm-password')).toBeTruthy();
    expect(getByTestId('register-terms')).toBeTruthy();
  });

  it('shows first name validation error when first name is empty', async () => {
    const { getAllByText, getByTestId, getByText } = render(<RegisterScreen />);

    fillRequiredRegistrationFields(getByTestId, getByText, { firstName: '' });
    pressSubmit(getAllByText);

    await waitFor(() => expect(getByText('First name is required')).toBeTruthy());
    expect(mockApiRegister).not.toHaveBeenCalled();
  });

  it('shows last name validation error when last name is empty (it was the only field without one)', async () => {
    const { getAllByText, getByTestId, getByText } = render(<RegisterScreen />);

    fillRequiredRegistrationFields(getByTestId, getByText, { lastName: '' });
    pressSubmit(getAllByText);

    await waitFor(() => expect(getByText('Last name is required')).toBeTruthy());
    expect(mockApiRegister).not.toHaveBeenCalled();
  });

  it('shows email validation error for invalid email', async () => {
    const { getAllByText, getByTestId, getByText } = render(<RegisterScreen />);

    fillRequiredRegistrationFields(getByTestId, getByText, { email: 'not-an-email' });
    pressSubmit(getAllByText);

    await waitFor(() => expect(getByText('Please enter a valid email address')).toBeTruthy());
    expect(mockApiRegister).not.toHaveBeenCalled();
  });

  it('shows password-too-short error', async () => {
    const { getAllByText, getByTestId, getByText } = render(<RegisterScreen />);

    fillRequiredRegistrationFields(getByTestId, getByText, {
      password: 'short',
      passwordConfirm: 'short',
    });
    pressSubmit(getAllByText);

    await waitFor(() => expect(getByText('Password must be at least 12 characters.')).toBeTruthy());
    expect(mockApiRegister).not.toHaveBeenCalled();
  });

  it('shows passwords-do-not-match error', async () => {
    const { getAllByText, getByTestId, getByText } = render(<RegisterScreen />);

    fillRequiredRegistrationFields(getByTestId, getByText, {
      passwordConfirm: 'Different123!',
    });
    pressSubmit(getAllByText);

    await waitFor(() => expect(getByText('Passwords do not match.')).toBeTruthy());
    expect(mockApiRegister).not.toHaveBeenCalled();
  });

  it('calls apiRegister and navigates to home on success', async () => {
    mockApiRegister.mockResolvedValue(validAuthResponse);
    mockExtractToken.mockReturnValue('tok_abc');

    const { getAllByText, getByTestId, getByText } = render(<RegisterScreen />);

    fillRequiredRegistrationFields(getByTestId, getByText);
    pressSubmit(getAllByText);

    await waitFor(() => expect(mockApiRegister).toHaveBeenCalledTimes(1));
    expect(mockApiRegister).toHaveBeenCalledWith(expect.objectContaining({
      first_name: 'Jane',
      last_name: 'Smith',
      phone: '+1 555 123 4567',
      location: 'Toronto, Canada',
      email: 'jane@example.com',
      password: 'TestPassword123!',
      password_confirmation: 'TestPassword123!',
      terms_accepted: true,
      form_started_at: expect.any(Number),
    }));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/(modals)/onboarding'));
  });

  it('submits backend-required registration fields and shows pending verification when no token is issued', async () => {
    mockApiRegister.mockResolvedValue({
      data: {
        user: { id: 2, email: 'mobile.pending@example.com', first_name: 'Mobile', last_name: 'Member' },
        requires_verification: true,
        message: 'Check your email before signing in.',
      },
    });

    const { findByText, getAllByText, getByTestId } = render(<RegisterScreen />);

    fireEvent.changeText(getByTestId('register-first-name'), 'Mobile');
    fireEvent.changeText(getByTestId('register-last-name'), 'Member');
    fireEvent.changeText(getByTestId('register-phone'), '+1 555 123 4567');
    fireEvent.changeText(getByTestId('register-location'), 'Toronto, Canada');
    fireEvent.changeText(getByTestId('register-email'), 'Mobile.Pending@Example.com');
    fireEvent.changeText(getByTestId('register-password'), 'TestPassword123!');
    fireEvent.changeText(getByTestId('register-confirm-password'), 'TestPassword123!');
    fireEvent.press(getByTestId('register-terms'));
    pressSubmit(getAllByText);

    await waitFor(() => expect(mockApiRegister).toHaveBeenCalledTimes(1));
    expect(mockApiRegister).toHaveBeenCalledWith(expect.objectContaining({
      first_name: 'Mobile',
      last_name: 'Member',
      phone: '+1 555 123 4567',
      location: 'Toronto, Canada',
      email: 'mobile.pending@example.com',
      password: 'TestPassword123!',
      password_confirmation: 'TestPassword123!',
      terms_accepted: true,
      form_started_at: expect.any(Number),
    }));
    expect(mockStorageSet).not.toHaveBeenCalled();
    expect(mockStorageSetJson).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(await findByText('Check your email before signing in.')).toBeTruthy();
  });

  it('shows API error message in the error banner', async () => {
    mockApiRegister.mockRejectedValue(new ApiResponseError(422, 'Email already in use'));
    const { getAllByText, getByTestId, getByText, findByText } = render(<RegisterScreen />);

    fillRequiredRegistrationFields(getByTestId, getByText, {
      email: 'taken@example.com',
    });
    pressSubmit(getAllByText);

    expect(await findByText('Email already in use')).toBeTruthy();
  });

  /**
   * 🔴 The banner renders at the top of a form taller than the screen, so a member who has
   * just pressed "Create account" at the bottom sees nothing happen. Measured on a device
   * 2026-08-22: the message was two screens above where they were looking. Registration is
   * the first thing anyone does, so a silent failure loses them entirely.
   */
  it('scrolls the error banner into view so the member actually sees it', async () => {
    const scrollTo = jest.fn();
    const scrollSpy = jest
      .spyOn(ScrollView.prototype, 'scrollTo')
      .mockImplementation(scrollTo as never);

    mockApiRegister.mockRejectedValue(new ApiResponseError(422, 'Email already in use'));
    const { getAllByText, getByTestId, getByText, findByText } = render(<RegisterScreen />);

    fillRequiredRegistrationFields(getByTestId, getByText, { email: 'taken@example.com' });
    pressSubmit(getAllByText);

    expect(await findByText('Email already in use')).toBeTruthy();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 0 })));

    scrollSpy.mockRestore();
  });

  /**
   * 🔴 The account may well exist. Measured on a device 2026-08-22: the server created
   * `users` row 900019 and the app said "Request timed out. Please check your connection."
   * A member who believes that and registers again is told the address is taken — on their
   * first ever interaction. `status === 0` is the client's "never got an answer".
   */
  it('does not claim failure when the server never answered', async () => {
    mockApiRegister.mockRejectedValue(new ApiResponseError(0, 'Request timed out. Please check your connection.'));
    const { getAllByText, getByTestId, getByText, findByText } = render(<RegisterScreen />);

    fillRequiredRegistrationFields(getByTestId, getByText);
    pressSubmit(getAllByText);

    expect(await findByText(/may already have been created/i)).toBeTruthy();
  });

  it('shows generic error for non-API failures', async () => {
    mockApiRegister.mockRejectedValue(new Error('Network failure'));
    const { getAllByText, getByTestId, getByText, findByText } = render(<RegisterScreen />);

    fillRequiredRegistrationFields(getByTestId, getByText);
    pressSubmit(getAllByText);

    expect(await findByText('Unable to register. Please try again.')).toBeTruthy();
  });

  it('opens the login route from the sign in action', () => {
    const { getByLabelText } = render(<RegisterScreen />);

    fireEvent.press(getByLabelText('Sign in'));

    expect(mockRouter.push).toHaveBeenCalledWith('/login');
  });
});
