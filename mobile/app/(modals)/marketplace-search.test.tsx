// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => ({}),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'common:buttons.retry': 'Retry',
        'common:errors.alertTitle': 'Error',
        'advancedSearch.eyebrow': 'Faceted marketplace search',
        'advancedSearch.title': 'Advanced search',
        'advancedSearch.subtitle': 'Use filters to narrow results.',
        'advancedSearch.placeholder': 'Search by title, keyword, or seller...',
        'advancedSearch.priceMin': 'Min price',
        'advancedSearch.priceMax': 'Max price',
        'advancedSearch.minPlaceholder': '0',
        'advancedSearch.maxPlaceholder': '100',
        'advancedSearch.category': 'Category',
        'advancedSearch.condition': 'Condition',
        'advancedSearch.sellerType': 'Seller type',
        'advancedSearch.allSellers': 'All sellers',
        'advancedSearch.delivery': 'Delivery',
        'advancedSearch.anyDelivery': 'Any delivery',
        'advancedSearch.sort': 'Sort',
        'advancedSearch.postedWithin': 'Posted within',
        'advancedSearch.anyTime': 'Any time',
        'advancedSearch.days': `${String(opts?.count ?? 0)} days`,
        'advancedSearch.reset': `Reset ${String(opts?.count ?? 0)} filters`,
        'advancedSearch.results': `${String(opts?.count ?? 0)} results`,
        'advancedSearch.loadFailed': 'Could not search marketplace listings.',
        'advancedSearch.loadMoreFailed': 'Could not load more search results.',
        'advancedSearch.emptyTitle': 'No matching listings',
        'advancedSearch.emptySubtitle': 'Try fewer filters or a different search term.',
        'advancedSearch.clearFilters': 'Clear filters',
        'advancedSearch.sortOptions.newest': 'Newest',
        'advancedSearch.sortOptions.price_asc': 'Price low to high',
        'advancedSearch.sortOptions.price_desc': 'Price high to low',
        'advancedSearch.sortOptions.popular': 'Popular',
        'filters.allCategories': 'All categories',
        'condition.new': 'New',
        'condition.like_new': 'Like new',
        'condition.good': 'Good',
        'condition.fair': 'Fair',
        'condition.poor': 'Poor',
        'sellerType.private': 'Private seller',
        'sellerType.business': 'Business',
        'delivery_method.pickup': 'Local pickup',
        'delivery_method.shipping': 'Shipping',
        'delivery_method.both': 'Pickup or shipping',
        'delivery_method.community_delivery': 'Community delivery',
        'search.clear': 'Clear marketplace search',
        'actions.sell': 'Sell item',
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
jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => ({ hasFeature: () => true }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
    border: '#d1d5db',
    error: '#dc2626',
  }),
}));
jest.mock('@/lib/api/marketplace', () => ({
  getMarketplaceCategories: jest.fn(),
  getMarketplaceListings: jest.fn(),
  marketplaceHasMore: jest.fn(() => false),
  marketplaceNextCursor: jest.fn(() => null),
  saveMarketplaceListing: jest.fn(),
  unsaveMarketplaceListing: jest.fn(),
}));

import MarketplaceSearchRoute from './marketplace-search';
import { getMarketplaceCategories, getMarketplaceListings } from '@/lib/api/marketplace';

describe('MarketplaceSearchRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getMarketplaceCategories).mockResolvedValue({ data: [] } as never);
    jest.mocked(getMarketplaceListings).mockResolvedValue({
      data: [],
      meta: { has_more: false, next_cursor: null },
    } as never);
  });

  it('sends shared input-backed query and price filters', async () => {
    const { getByPlaceholderText } = render(<MarketplaceSearchRoute />);

    fireEvent.changeText(getByPlaceholderText('Search by title, keyword, or seller...'), 'bike');
    fireEvent.changeText(getByPlaceholderText('0'), '10');

    // The query is debounced 300ms before it reaches the fetch effect; allow
    // generous headroom so the assertion stays deterministic under CPU load.
    await waitFor(() => {
      expect(getMarketplaceListings).toHaveBeenLastCalledWith(expect.objectContaining({
        q: 'bike',
        price_min: '10',
      }));
    }, { timeout: 3000 });
  });
});
