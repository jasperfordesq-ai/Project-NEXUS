// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { ApiResponseError } from '@/lib/api/client';
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const mockVerifyEmail = jest.fn();
const mockReplace = jest.fn();
let mockParams: Record<string, string | undefined> = { token: 'verify-token' };

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
  verifyEmail: (...args: unknown[]) => mockVerifyEmail(...args),
}));

import VerifyEmailScreen from './verify-email';

describe('VerifyEmailScreen', () => {
  beforeEach(() => {
    mockVerifyEmail.mockReset();
    mockReplace.mockReset();
    mockParams = { token: 'verify-token' };
  });

  it('verifies the route token and shows success', async () => {
    mockVerifyEmail.mockResolvedValue({ success: true, data: { verified: true } });

    const { findByText } = render(<VerifyEmailScreen />);

    await waitFor(() => expect(mockVerifyEmail).toHaveBeenCalledWith('verify-token'));
    expect(await findByText('Email verified')).toBeTruthy();
  });

  it('shows an invalid-link state when token is missing', () => {
    mockParams = {};

    const { getByText } = render(<VerifyEmailScreen />);

    expect(getByText('Invalid verification link')).toBeTruthy();
    expect(mockVerifyEmail).not.toHaveBeenCalled();
  });

  it('shows the server wording when verification is refused', async () => {
    mockVerifyEmail.mockRejectedValue(new ApiResponseError(400, 'Expired token'));

    const { findByText } = render(<VerifyEmailScreen />);

    expect(await findByText('Could not verify email')).toBeTruthy();
    expect(await findByText('Expired token')).toBeTruthy();
  });

  it('does not show raw JavaScript error text when verification fails', async () => {
    mockVerifyEmail.mockRejectedValue(new TypeError("Cannot read properties of undefined (reading 'data')"));

    const { findByText, queryByText } = render(<VerifyEmailScreen />);

    expect(await findByText('Could not verify email')).toBeTruthy();
    expect(queryByText(/Cannot read properties/)).toBeNull();
  });
});
