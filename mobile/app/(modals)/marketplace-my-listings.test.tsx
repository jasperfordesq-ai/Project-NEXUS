// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render } from '@testing-library/react-native';

const mockT = (key: string, opts?: Record<string, unknown>) => {
  const map: Record<string, string> = {
    'common:back': 'Back',
    'common:buttons.cancel': 'Cancel',
    'common:buttons.delete': 'Delete',
    'common:errors.alertTitle': 'Error',
    'actions.sell': 'Sell something',
    'auth:login.submit': 'Sign in',
    'myListings.title': 'My listings',
    'myListings.eyebrow': 'Seller dashboard',
    'myListings.subtitle': 'Manage active listings, renew items, and review sales signals.',
    'myListings.active': `${String(opts?.count ?? 0)} active`,
    'myListings.sold': `${String(opts?.count ?? 0)} sold`,
    'myListings.views': `${String(opts?.count ?? 0)} views`,
    'myListings.offers': `${String(opts?.count ?? 0)} offers`,
    'myListings.tabs.active': `Active (${String(opts?.count ?? 0)})`,
    'myListings.tabs.draft': `Draft (${String(opts?.count ?? 0)})`,
    'myListings.tabs.sold': `Sold (${String(opts?.count ?? 0)})`,
    'myListings.tabs.expired': `Expired (${String(opts?.count ?? 0)})`,
    'myListings.onboarding': 'Seller setup',
    'myListings.payments': 'Payments',
    'myListings.salesOrders': 'Sales orders',
    'myListings.offersCta': 'Offers',
    'myListings.sellerTools': 'Seller tools',
    'myListings.shipping': 'Shipping options',
    'myListings.signInTitle': 'Sign in to manage marketplace listings',
    'myListings.signInHint': 'Your listings, seller stats, and marketplace setup are available after you sign in.',
    'myListings.emptyState.active.title': 'No active listings',
    'myListings.emptyState.active.subtitle': 'Publish a listing to start selling in your community.',
  };
  return map[key] ?? key;
};

let mockAuthState: {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: { id: number; name: string } | null;
} = {
  isAuthenticated: true,
  isLoading: false,
  user: { id: 7, name: 'Seller' },
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
jest.mock('@/components/marketplace/MarketplaceListingCard', () => {
  const { Text } = require('react-native');
  return () => <Text>Listing card</Text>;
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
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#006FEE',
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
  }),
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => mockAuthState,
}));

jest.mock('@/lib/storage', () => ({
  storage: {
    get: jest.fn().mockResolvedValue('1'),
    set: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/lib/api/marketplace', () => ({
  deleteMarketplaceListing: jest.fn(),
  getMarketplaceDashboard: jest.fn(),
  getMerchantOnboardingStatus: jest.fn(),
  getMyMarketplaceListings: jest.fn(),
  marketplaceHasMore: jest.fn(() => false),
  marketplaceNextCursor: jest.fn(() => null),
  renewMarketplaceListing: jest.fn(),
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

import MarketplaceMyListingsRoute from './marketplace-my-listings';
import {
  getMarketplaceDashboard,
  getMerchantOnboardingStatus,
  getMyMarketplaceListings,
} from '@/lib/api/marketplace';

describe('MarketplaceMyListingsRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthState = {
      isAuthenticated: true,
      isLoading: false,
      user: { id: 7, name: 'Seller' },
    };
    jest.mocked(getMarketplaceDashboard).mockResolvedValue({
      data: {
        active_listings: 1,
        draft_listings: 0,
        sold_listings: 0,
        expired_listings: 0,
        total_views: 5,
        pending_offers: 0,
      },
    } as never);
    jest.mocked(getMerchantOnboardingStatus).mockResolvedValue({
      data: { onboarding_completed: true },
    } as never);
    jest.mocked(getMyMarketplaceListings).mockResolvedValue({
      data: [],
      meta: { cursor: null, has_more: false },
    } as never);
  });

  it('shows the sign-in state without calling protected seller APIs when unauthenticated', async () => {
    mockAuthState = { isAuthenticated: false, isLoading: false, user: null };

    const { findByText } = render(<MarketplaceMyListingsRoute />);

    expect(await findByText('Sign in to manage marketplace listings')).toBeTruthy();
    expect(getMarketplaceDashboard).not.toHaveBeenCalled();
    expect(getMerchantOnboardingStatus).not.toHaveBeenCalled();
    expect(getMyMarketplaceListings).not.toHaveBeenCalled();
  });
});
