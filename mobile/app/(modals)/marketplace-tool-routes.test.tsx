// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const mockReplace = jest.fn();
let mockSearchParams: Record<string, string | undefined> = {};

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { replace: (...args: unknown[]) => mockReplace(...args), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'collections.savedTab': 'Saved searches',
        'merchantOnboarding.title': 'Seller setup',
        'orders.sales': 'Sales',
        'tools.tabs.promotions': 'Promotions',
        'tools.pickups.title': 'Pickups',
        'tools.pickups.scan': 'Mark pickup complete',
        'tools.coupons.edit': 'Edit coupon',
        'tools.coupons.redemptionsTitle': 'Coupon redemptions',
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

import MarketplaceSavedSearchesRoute from './marketplace-saved-searches';
import MarketplacePromotionsRoute from './marketplace-promotions';
import MarketplacePickupSlotsRoute from './marketplace-pickup-slots';
import MarketplacePickupScanRoute from './marketplace-pickup-scan';
import MarketplaceSellerOnboardingRoute from './marketplace-seller-onboarding';
import MarketplaceBecomePartnerRoute from './marketplace-become-partner';
import MarketplaceSalesOrdersRoute from './marketplace-sales-orders';
import MarketplaceCouponEditRoute from './marketplace-coupon-edit';
import MarketplaceCouponRedemptionsRoute from './marketplace-coupon-redemptions';

describe('marketplace seller tool action routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = {};
  });

  it('redirects saved searches to the saved marketplace collection tab', async () => {
    const { getByText } = render(<MarketplaceSavedSearchesRoute />);

    expect(getByText('Saved searches')).toBeTruthy();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/(modals)/marketplace-collections',
        params: { tab: 'saved' },
      });
    });
  });

  it('redirects promotions to the seller tools promotions tab', async () => {
    const { getByText } = render(<MarketplacePromotionsRoute />);

    expect(getByText('Promotions')).toBeTruthy();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/(modals)/marketplace-tools',
        params: { tab: 'promotions' },
      });
    });
  });

  it('redirects pickup slots to the seller tools pickups tab', async () => {
    const { getByText } = render(<MarketplacePickupSlotsRoute />);

    expect(getByText('Pickups')).toBeTruthy();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/(modals)/marketplace-tools',
        params: { tab: 'pickups' },
      });
    });
  });

  it('redirects pickup scanning to the seller tools pickups tab', async () => {
    const { getByText } = render(<MarketplacePickupScanRoute />);

    expect(getByText('Mark pickup complete')).toBeTruthy();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/(modals)/marketplace-tools',
        params: { tab: 'pickups' },
      });
    });
  });

  it('redirects seller onboarding aliases to merchant onboarding', async () => {
    const first = render(<MarketplaceSellerOnboardingRoute />);

    expect(first.getByText('Seller setup')).toBeTruthy();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/(modals)/marketplace-merchant-onboarding');
    });
    first.unmount();
    mockReplace.mockClear();

    const second = render(<MarketplaceBecomePartnerRoute />);
    expect(second.getByText('Seller setup')).toBeTruthy();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/(modals)/marketplace-merchant-onboarding');
    });
    second.unmount();
  });

  it('redirects seller order deep links to the sales order mode', async () => {
    const { getByText } = render(<MarketplaceSalesOrdersRoute />);

    expect(getByText('Sales')).toBeTruthy();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/(modals)/marketplace-orders',
        params: { mode: 'sales' },
      });
    });
  });

  it('redirects coupon edit deep links to the coupon editor mode', async () => {
    mockSearchParams = { id: '44' };
    const { getByText } = render(<MarketplaceCouponEditRoute />);

    expect(getByText('Edit coupon')).toBeTruthy();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/(modals)/marketplace-tools',
        params: { tab: 'coupons', couponId: '44', couponMode: 'edit' },
      });
    });
  });

  it('redirects coupon redemptions deep links to the coupon redemptions mode', async () => {
    mockSearchParams = { id: '51' };
    const { getByText } = render(<MarketplaceCouponRedemptionsRoute />);

    expect(getByText('Coupon redemptions')).toBeTruthy();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/(modals)/marketplace-tools',
        params: { tab: 'coupons', couponId: '51', couponMode: 'redemptions' },
      });
    });
  });

  it('falls back to the coupons tab when coupon helper routes receive invalid ids', async () => {
    mockSearchParams = { id: 'not-a-number' };
    const first = render(<MarketplaceCouponEditRoute />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/(modals)/marketplace-tools',
        params: { tab: 'coupons' },
      });
    });
    first.unmount();
    mockReplace.mockClear();

    mockSearchParams = { id: '0' };
    render(<MarketplaceCouponRedemptionsRoute />);
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/(modals)/marketplace-tools',
        params: { tab: 'coupons' },
      });
    });
  });
});
