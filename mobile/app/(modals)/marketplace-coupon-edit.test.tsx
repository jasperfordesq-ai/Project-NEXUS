// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

let mockParams: Record<string, string> = {};
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { replace: (...args: unknown[]) => mockReplace(...args), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'tools.coupons.edit': 'Edit',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppTopBar', () => {
  const { Text } = require('react-native');
  return ({ title }: { title: string }) => <Text>{title}</Text>;
});
jest.mock('@/components/ui/LoadingSpinner', () => {
  const { Text } = require('react-native');
  return () => <Text>Loading</Text>;
});

import MarketplaceCouponEditRoute from './marketplace-coupon-edit';

describe('MarketplaceCouponEditRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
  });

  it('redirects to the seller tools coupon edit panel for the requested coupon', async () => {
    mockParams = { id: '7' };

    const { getByText } = render(<MarketplaceCouponEditRoute />);

    expect(getByText('Edit')).toBeTruthy();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/(modals)/marketplace-tools',
        params: { tab: 'coupons', couponId: '7', couponMode: 'edit' },
      });
    });
  });

  it('falls back to the seller coupon tab when the coupon id is invalid', async () => {
    mockParams = { id: 'not-a-number' };

    render(<MarketplaceCouponEditRoute />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/(modals)/marketplace-tools',
        params: { tab: 'coupons' },
      });
    });
  });
});
