// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

let mockAuthState: {
  isAuthenticated: boolean;
  isLoading: boolean;
} = {
  isAuthenticated: true,
  isLoading: false,
};

const mockHasFeature = jest.fn(() => true);
let mockTenantCurrency = 'EUR';

const mockT = (key: string) => {
  const map: Record<string, string> = {
    'common:back': 'Back',
    'auth:login.submit': 'Sign in',
    'shipping.title': 'Shipping options',
    'shipping.signInTitle': 'Sign in to manage shipping options',
    'shipping.signInHint': 'Seller shipping methods and delivery prices are available after you sign in.',
    'shipping.eyebrow': 'Seller fulfilment',
    'shipping.subtitle': 'Create shipping choices buyers can use at checkout.',
    'shipping.courierName': 'Courier name',
    'shipping.courierNamePlaceholder': 'Postal service or local courier',
    'shipping.price': 'Price',
    'shipping.pricePlaceholder': '6.50',
    'shipping.currency': 'Currency',
    'shipping.estimatedDays': 'Estimated days',
    'shipping.estimatedDaysPlaceholder': '3',
    'shipping.defaultToggle': 'Set as default option',
    'shipping.create': 'Create option',
    'shipping.empty': 'No shipping options yet',
    'shipping.emptyHint': 'Add at least one option if sellers can ship marketplace orders.',
    'featureGate.title': 'Marketplace is not available',
    'featureGate.description': 'This community has not enabled marketplace listings.',
  };
  return map[key] ?? key;
};

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
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
jest.mock('@/components/ui/EmptyState', () => ({
  __esModule: true,
  default: (props: { title: string; subtitle?: string; actionLabel?: string }) => {
    const { Text, View } = require('react-native');
    return (
      <View>
        <Text>{props.title}</Text>
        {props.subtitle ? <Text>{props.subtitle}</Text> : null}
        {props.actionLabel ? <Text>{props.actionLabel}</Text> : null}
      </View>
    );
  },
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => ({
    hasFeature: mockHasFeature,
    tenant: { currency: mockTenantCurrency },
  }),
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => mockAuthState,
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
    error: '#dc2626',
    success: '#16a34a',
    warning: '#f59e0b',
  }),
}));

jest.mock('@/lib/api/marketplace', () => ({
  createMarketplaceShippingOption: jest.fn(),
  deleteMarketplaceShippingOption: jest.fn(),
  getMarketplaceShippingOptions: jest.fn(),
  updateMarketplaceShippingOption: jest.fn(),
}));

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

// Auto-confirm: opening the dialog runs the destructive action immediately,
// mirroring the old Alert.alert button-press simulation.
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (opts: { onConfirm: () => void | Promise<void> }) => {
      void opts.onConfirm();
    },
    confirmDialog: null,
  }),
}));

import MarketplaceShippingOptionsRoute from './marketplace-shipping-options';
import { createMarketplaceShippingOption, getMarketplaceShippingOptions } from '@/lib/api/marketplace';

describe('MarketplaceShippingOptionsRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTenantCurrency = 'EUR';
    mockHasFeature.mockReturnValue(true);
    mockAuthState = {
      isAuthenticated: true,
      isLoading: false,
    };
    jest.mocked(getMarketplaceShippingOptions).mockResolvedValue({ data: [] } as never);
  });

  it('shows the sign-in state without calling protected shipping APIs when unauthenticated', () => {
    mockAuthState = { isAuthenticated: false, isLoading: false };

    const { getByText } = render(<MarketplaceShippingOptionsRoute />);

    expect(getByText('Sign in to manage shipping options')).toBeTruthy();
    expect(getMarketplaceShippingOptions).not.toHaveBeenCalled();
  });

  it('renders shared input-backed shipping option fields when authenticated', async () => {
    const { getByPlaceholderText } = render(<MarketplaceShippingOptionsRoute />);

    await waitFor(() => {
      expect(getByPlaceholderText('Postal service or local courier')).toBeTruthy();
    });
    expect(getByPlaceholderText('6.50')).toBeTruthy();
    expect(getByPlaceholderText('3')).toBeTruthy();
  });

  it('uses the tenant currency when creating a shipping option', async () => {
    mockTenantCurrency = 'JPY';
    jest.mocked(createMarketplaceShippingOption).mockResolvedValue({ data: { id: 7 } } as never);

    const { getByPlaceholderText, getByText } = render(<MarketplaceShippingOptionsRoute />);

    await waitFor(() => expect(getByPlaceholderText('Postal service or local courier')).toBeTruthy());
    fireEvent.changeText(getByPlaceholderText('Postal service or local courier'), 'Japan Post');
    fireEvent.changeText(getByPlaceholderText('6.50'), '500');
    fireEvent.press(getByText('Create option'));

    await waitFor(() => expect(createMarketplaceShippingOption).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'JPY' }),
    ));
  });

  it('formats zero-decimal shipping prices without forced decimals', async () => {
    jest.mocked(getMarketplaceShippingOptions).mockResolvedValue({
      data: [{
        id: 4,
        courier_name: 'Japan Post',
        price: 500,
        currency: 'JPY',
        estimated_days: 2,
        is_default: false,
        is_active: true,
      }],
    } as never);

    const { findByText, queryByText } = render(<MarketplaceShippingOptionsRoute />);

    expect(await findByText('Japan Post')).toBeTruthy();
    expect(await findByText(/500/)).toBeTruthy();
    expect(queryByText(/500\.00/)).toBeNull();
  });
});
