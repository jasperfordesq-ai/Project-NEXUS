// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render } from '@testing-library/react-native';

let mockAuthState: {
  isAuthenticated: boolean;
  isLoading: boolean;
} = {
  isAuthenticated: true,
  isLoading: false,
};

const mockHasFeature = jest.fn(() => true);

const mockT = (key: string) => {
  const map: Record<string, string> = {
    'common:back': 'Back',
    'actions.browse': 'Browse marketplace',
    'auth:login.submit': 'Sign in',
    'pickup.myTitle': 'My pickups',
    'pickup.myEyebrow': 'Click and collect',
    'pickup.mySubtitle': 'Review pickup reservations and QR codes.',
    'pickup.openOrders': 'Open orders',
    'pickup.noPickups': 'No pickup reservations yet',
    'pickup.noPickupsHint': 'Pickup reservations appear after checkout.',
    'pickup.signInTitle': 'Sign in to view pickup reservations',
    'pickup.signInHint': 'Pickup windows and collection QR codes are available after you sign in.',
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
  useTenant: () => ({ hasFeature: mockHasFeature }),
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
  getMyMarketplacePickups: jest.fn(),
}));

import MarketplacePickupsRoute from './marketplace-pickups';
import { getMyMarketplacePickups } from '@/lib/api/marketplace';

describe('MarketplacePickupsRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasFeature.mockReturnValue(true);
    mockAuthState = {
      isAuthenticated: true,
      isLoading: false,
    };
    jest.mocked(getMyMarketplacePickups).mockResolvedValue({ data: [] } as never);
  });

  it('shows the sign-in state without calling protected pickup APIs when unauthenticated', () => {
    mockAuthState = { isAuthenticated: false, isLoading: false };

    const { getByText } = render(<MarketplacePickupsRoute />);

    expect(getByText('Sign in to view pickup reservations')).toBeTruthy();
    expect(getMyMarketplacePickups).not.toHaveBeenCalled();
  });
});
