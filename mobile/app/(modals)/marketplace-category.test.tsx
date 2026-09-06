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
  useLocalSearchParams: () => ({
    id: '12',
    name: 'Tools',
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'common:buttons.retry': 'Retry',
        'common:errors.alertTitle': 'Error',
        'category.eyebrow': 'Marketplace category',
        'category.title': 'Category',
        'category.subtitle': 'Filter this category by search and condition.',
        'category.priceMin': 'Min price',
        'category.priceMax': 'Max price',
        'category.minPlaceholder': '0',
        'category.maxPlaceholder': '100',
        'category.allConditions': 'All conditions',
        'category.reset': `Reset ${String(opts?.count ?? 0)} filters`,
        'category.unableToLoad': 'Could not load this category.',
        'category.loadMoreFailed': 'Could not load more listings.',
        'category.emptyTitle': 'No listings in this category',
        'category.emptySubtitle': 'Try another search or browse the full marketplace.',
        'search.placeholder': 'Search marketplace...',
        'search.clear': 'Clear marketplace search',
        'actions.browse': 'Browse marketplace',
        'condition.new': 'New',
        'condition.like_new': 'Like new',
        'condition.good': 'Good',
        'condition.fair': 'Fair',
        'condition.poor': 'Poor',
        'advancedSearch.sortOptions.newest': 'Newest',
        'advancedSearch.sortOptions.price_asc': 'Price low to high',
        'advancedSearch.sortOptions.price_desc': 'Price high to low',
        'advancedSearch.sortOptions.popular': 'Popular',
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
  getMarketplaceListings: jest.fn(),
  marketplaceHasMore: jest.fn(() => false),
  marketplaceNextCursor: jest.fn(() => null),
  saveMarketplaceListing: jest.fn(),
  unsaveMarketplaceListing: jest.fn(),
}));

import MarketplaceCategoryRoute from './marketplace-category';
import { getMarketplaceListings } from '@/lib/api/marketplace';

describe('MarketplaceCategoryRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getMarketplaceListings).mockResolvedValue({
      data: [],
      meta: { has_more: false, next_cursor: null },
    } as never);
  });

  it('sends a comma-list condition filter when multiple category conditions are selected', async () => {
    const { getByText } = render(<MarketplaceCategoryRoute />);

    await waitFor(() => {
      expect(getMarketplaceListings).toHaveBeenCalledWith(expect.objectContaining({
        category_id: 12,
      }));
    });

    fireEvent.press(getByText('New'));
    fireEvent.press(getByText('Good'));

    await waitFor(() => {
      expect(getMarketplaceListings).toHaveBeenLastCalledWith(expect.objectContaining({
        category_id: 12,
        condition: 'new,good',
      }));
    });
  });

  it('sends shared input-backed search and price filters', async () => {
    const { getByPlaceholderText } = render(<MarketplaceCategoryRoute />);

    fireEvent.changeText(getByPlaceholderText('Search marketplace...'), 'drill');
    fireEvent.changeText(getByPlaceholderText('0'), '5');

    await waitFor(() => {
      expect(getMarketplaceListings).toHaveBeenLastCalledWith(expect.objectContaining({
        q: 'drill',
        price_min: '5',
      }));
    });
  });
});
