// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

let mockParams: Record<string, string | string[] | undefined> = {};

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'common:buttons.retry': 'Retry',
        'common:errors.alertTitle': 'Error',
        title: 'Marketplace',
        eyebrow: 'Community marketplace',
        subtitle: 'Browse, sell, save, and manage community marketplace listings.',
        'actions.sell': 'Sell item',
        'actions.myListings': 'My listings',
        'actions.orders': 'Orders',
        'actions.pickups': 'Pickups',
        'actions.tools': 'Tools',
        'actions.freeItems': 'Free items',
        'actions.collections': 'Collections',
        'actions.search': 'Advanced search',
        'actions.coupons': 'Coupons',
        'actions.nearby': 'Nearby marketplace',
        'actions.offers': 'Offers',
        'search.placeholder': 'Search marketplace...',
        'search.clear': 'Clear marketplace search',
        'filters.allCategories': 'All categories',
        'filters.priceType.all': 'All prices',
        'filters.priceType.free': 'Free',
        'filters.priceType.fixed': 'Fixed price',
        'filters.priceType.negotiable': 'Negotiable',
        'filters.priceType.contact': 'Contact seller',
        'featured.title': 'Featured listings',
        'featured.count': `${String(opts?.count ?? 0)} featured`,
        'empty.title': 'No marketplace listings yet',
        'empty.subtitle': 'Try another search or post the first listing.',
        'common.save_failed': 'Could not update saved listings.',
        loadMore: 'Load more',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback dependency
  // array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppTopBar', () => {
  const { Text } = require('react-native');
  return ({ title }: { title: string }) => <Text>{title}</Text>;
});
jest.mock('@/components/ui/EmptyState', () => {
  const { Text, View } = require('react-native');
  return ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <View>
      <Text>{title}</Text>
      {subtitle ? <Text>{subtitle}</Text> : null}
    </View>
  );
});
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/marketplace/MarketplaceListingCard', () => {
  const { Text } = require('react-native');
  return ({ item }: { item: { title: string } }) => <Text>{item.title}</Text>;
});
jest.mock('@/lib/haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => ({ hasFeature: (feature: string) => feature === 'marketplace' || feature === 'merchant_coupons' }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
    border: '#d1d5db',
    success: '#16a34a',
    warning: '#f59e0b',
    error: '#dc2626',
  }),
}));
jest.mock('@/lib/api/marketplace', () => ({
  getFeaturedMarketplaceListings: jest.fn(),
  getMarketplaceCategories: jest.fn(),
  getMarketplaceListings: jest.fn(),
  marketplaceHasMore: jest.fn(() => false),
  marketplaceNextCursor: jest.fn(() => null),
  saveMarketplaceListing: jest.fn(),
  unsaveMarketplaceListing: jest.fn(),
}));

import MarketplaceRoute from './marketplace';
import {
  getFeaturedMarketplaceListings,
  getMarketplaceCategories,
  getMarketplaceListings,
} from '@/lib/api/marketplace';

describe('MarketplaceRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    jest.mocked(getMarketplaceCategories).mockResolvedValue({
      data: [{ id: 4, name: 'Tools', slug: 'tools', icon: null, listing_count: 3 }],
    } as never);
    jest.mocked(getFeaturedMarketplaceListings).mockResolvedValue({ data: [] } as never);
    jest.mocked(getMarketplaceListings).mockResolvedValue({
      data: [],
      meta: { has_more: false, next_cursor: null },
    } as never);
  });

  it('honors marketplace hub deep-link filters from the React route query params', async () => {
    mockParams = {
      q: 'drill',
      category: '4',
      price_type: 'free',
    };

    const { getByText } = render(<MarketplaceRoute />);

    await waitFor(() => {
      expect(getByText('Tools')).toBeTruthy();
    });

    await waitFor(() => {
      expect(getMarketplaceListings).toHaveBeenCalledWith(expect.objectContaining({
        q: 'drill',
        category_id: 4,
        price_type: 'free',
      }));
    });
  });

  it('shows clear action after typing in the shared input-backed search field', async () => {
    const { getByLabelText, getByPlaceholderText } = render(<MarketplaceRoute />);

    await waitFor(() => {
      expect(getByPlaceholderText('Search marketplace...')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('Search marketplace...'), 'bike');
    expect(getByLabelText('Clear marketplace search')).toBeTruthy();
  });
});
