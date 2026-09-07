// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 Stripe is handed `nexus://marketplace-payment-return` as the 3-D Secure return URL, and
 * nothing in the app answered on that path — so the OS re-opening the app mid-payment pushed
 * the "This page doesn't exist" screen over the listing (audit 2026-09-07, D/F-7).
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;

jest.mock('expo-router', () => ({
  router: {
    back: (...args: unknown[]) => mockBack(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    canGoBack: () => mockCanGoBack,
  },
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ bg: '#ffffff' }),
}));

jest.mock('@/components/ui/LoadingSpinner', () => 'View');

import MarketplacePaymentReturnScreen from './marketplace-payment-return';

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockCanGoBack = true;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('MarketplacePaymentReturnScreen', () => {
  it('exists, so a 3-D Secure return does not land on "page not found"', () => {
    const { getByTestId } = render(<MarketplacePaymentReturnScreen />);

    expect(getByTestId('marketplace-payment-return')).toBeTruthy();
  });

  it('returns the member to whatever they were doing', async () => {
    render(<MarketplacePaymentReturnScreen />);

    await act(async () => { jest.advanceTimersByTime(1); await Promise.resolve(); });

    expect(mockBack).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('falls back to Orders when the app was opened cold on this URL', async () => {
    mockCanGoBack = false;

    render(<MarketplacePaymentReturnScreen />);

    await act(async () => { jest.advanceTimersByTime(1); await Promise.resolve(); });

    expect(mockReplace).toHaveBeenCalledWith('/(modals)/marketplace-orders');
  });
});
