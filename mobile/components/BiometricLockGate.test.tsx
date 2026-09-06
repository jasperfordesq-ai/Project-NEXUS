// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

const mockAuthenticate = jest.fn();
const mockCapability = jest.fn();
const mockEnabled = jest.fn();
const mockLogout = jest.fn();
let mockAuthState = { isAuthenticated: true, isLoading: false };

jest.mock('@/lib/biometricLock', () => ({
  authenticate: (...args: unknown[]) => mockAuthenticate(...args),
  biometricCapability: (...args: unknown[]) => mockCapability(...args),
  isBiometricLockEnabled: (...args: unknown[]) => mockEnabled(...args),
}));

jest.mock('@/lib/context/AuthContext', () => ({
  useAuthContext: () => ({ ...mockAuthState, logout: mockLogout }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#2563eb' }));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff', text: '#111111', textSecondary: '#555555', error: '#b91c1c',
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import BiometricLockGate from './BiometricLockGate';

describe('BiometricLockGate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthState = { isAuthenticated: true, isLoading: false };
    mockEnabled.mockResolvedValue(true);
    mockCapability.mockResolvedValue({ usable: true });
    mockAuthenticate.mockResolvedValue({ ok: true });
  });

  it('never blocks a signed-out member from reaching the login UI', async () => {
    mockAuthState = { isAuthenticated: false, isLoading: false };
    const { getByText, queryByTestId } = render(
      <BiometricLockGate><Text>Login form</Text></BiometricLockGate>,
    );

    expect(getByText('Login form')).toBeTruthy();
    await waitFor(() => expect(queryByTestId('biometric-lock-gate')).toBeNull());
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('keeps protected content covered until successful device authentication', async () => {
    let finishAuthentication: ((value: { ok: true }) => void) | undefined;
    mockAuthenticate.mockReturnValue(new Promise((resolve) => { finishAuthentication = resolve; }));

    const { getByText, getByTestId, queryByTestId } = render(
      <BiometricLockGate><Text>Private account</Text></BiometricLockGate>,
    );

    expect(getByText('Private account')).toBeTruthy();
    expect(getByTestId('biometric-lock-gate')).toBeTruthy();
    await waitFor(() => expect(mockAuthenticate).toHaveBeenCalledWith('settings:biometricLock.prompt'));

    // Resolved inside `act` so React has flushed the update before the assertion. Without
    // it this raced and failed intermittently on CI, which is a slower machine than this one.
    await act(async () => {
      finishAuthentication?.({ ok: true });
    });
    await waitFor(() => expect(queryByTestId('biometric-lock-gate')).toBeNull());
  });

  it('shows an honest failure, permits retry, and always permits sign out', async () => {
    mockAuthenticate
      .mockResolvedValueOnce({ ok: false, reason: 'cancelled' })
      .mockResolvedValueOnce({ ok: true });

    const { findByTestId, getByText, queryByTestId } = render(
      <BiometricLockGate><Text>Private account</Text></BiometricLockGate>,
    );

    expect(await findByTestId('biometric-lock-error')).toHaveTextContent(
      'settings:biometricLock.errors.cancelled',
    );
    fireEvent.press(getByText('common:labels.signOut'));
    expect(mockLogout).toHaveBeenCalledTimes(1);

    fireEvent.press(getByText('settings:biometricLock.unlock'));
    await waitFor(() => expect(queryByTestId('biometric-lock-gate')).toBeNull());
    expect(mockAuthenticate).toHaveBeenCalledTimes(2);
  });

  it('fails open when the phone can no longer authenticate', async () => {
    mockCapability.mockResolvedValue({ usable: false });
    const { queryByTestId } = render(
      <BiometricLockGate><Text>Private account</Text></BiometricLockGate>,
    );

    await waitFor(() => expect(queryByTestId('biometric-lock-gate')).toBeNull());
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });
});
