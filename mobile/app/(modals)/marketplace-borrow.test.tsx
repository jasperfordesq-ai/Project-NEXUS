// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
let mockFeatures = new Set(['marketplace']);

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => false),
  },
  useLocalSearchParams: () => ({}),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'common:buttons.retry': 'Retry',
        'common:errors.alertTitle': 'Error',
        loadMore: 'Load more',
        'featureGate.title': 'Marketplace unavailable',
        'featureGate.description': 'Marketplace is not enabled.',
        'borrow.title': 'Borrow & lend',
        'borrow.eyebrow': 'Borrow & lend',
        'borrow.subtitle': 'Tools members are happy to lend.',
        'borrow.lendSomething': 'Lend something',
        'borrow.unableToLoad': 'Could not load items to borrow.',
        'borrow.loadMoreFailed': 'Could not load more items to borrow.',
        'borrow.emptyTitle': 'Nothing to borrow yet',
        'borrow.emptySubtitle': 'When members offer tools to lend, they will appear here.',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});
jest.mock('@/components/ui/AppTopBar', () => {
  const { Text, Pressable, View } = require('react-native');
  return ({ title, rightAction }: { title: string; rightAction?: { accessibilityLabel: string; onPress: () => void } }) => (
    <View>
      <Text>{title}</Text>
      {rightAction ? (
        <Pressable accessibilityLabel={rightAction.accessibilityLabel} onPress={rightAction.onPress}>
          <Text>{rightAction.accessibilityLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
});
jest.mock('@/components/ui/EmptyState', () => {
  const { Text, Pressable, View } = require('react-native');
  return ({ title, subtitle, actionLabel, onAction }: { title: string; subtitle?: string; actionLabel?: string; onAction?: () => void }) => (
    <View>
      <Text>{title}</Text>
      {subtitle ? <Text>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable onPress={onAction}><Text>{actionLabel}</Text></Pressable>
      ) : null}
    </View>
  );
});
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/marketplace/MarketplaceListingCard', () => {
  const { Text, Pressable } = require('react-native');
  return ({ item, onPress }: { item: { title: string }; onPress: () => void }) => (
    <Pressable onPress={onPress}><Text>{item.title}</Text></Pressable>
  );
});
jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => ({
    tenant: { currency: 'EUR' },
    hasFeature: (feature: string) => mockFeatures.has(feature),
  }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
    border: '#d1d5db',
    borderSubtle: '#e5e7eb',
    success: '#16a34a',
    warning: '#f59e0b',
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

import MarketplaceBorrowRoute from './marketplace-borrow';
import { getMarketplaceListings } from '@/lib/api/marketplace';

describe('MarketplaceBorrowRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFeatures = new Set(['marketplace']);
    jest.mocked(getMarketplaceListings).mockResolvedValue({
      data: [],
      meta: { has_more: false, next_cursor: null },
    } as never);
  });

  it('loads only borrow & lend listings and opens lend-listing creation with the lend type', async () => {
    jest.mocked(getMarketplaceListings).mockResolvedValueOnce({
      data: [{ id: 4, title: 'Cordless drill', is_saved: false }],
      meta: { has_more: false, next_cursor: null },
    } as never);

    const { getAllByText, getByText } = render(<MarketplaceBorrowRoute />);

    await waitFor(() => {
      expect(getMarketplaceListings).toHaveBeenCalledWith(expect.objectContaining({
        price_type: 'lend',
        sort: 'newest',
      }));
      expect(getByText('Cordless drill')).toBeTruthy();
    });

    fireEvent.press(getAllByText('Lend something')[0]);

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(modals)/new-marketplace-listing',
      params: { price_type: 'lend' },
    });

    fireEvent.press(getByText('Cordless drill'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(modals)/marketplace-detail',
      params: { id: '4' },
    });
  });

  it('shows the empty state with a lend call to action when nothing is offered', async () => {
    const { getByText } = render(<MarketplaceBorrowRoute />);

    await waitFor(() => expect(getByText('Nothing to borrow yet')).toBeTruthy());
    expect(getByText('When members offer tools to lend, they will appear here.')).toBeTruthy();
  });

  it('offers a retry instead of a lend button when the first page fails', async () => {
    jest.mocked(getMarketplaceListings).mockRejectedValueOnce(new Error('offline'));

    const { getByText, queryByText } = render(<MarketplaceBorrowRoute />);

    await waitFor(() => expect(getByText('Retry')).toBeTruthy());
    expect(queryByText('Nothing to borrow yet')).toBeNull();

    jest.mocked(getMarketplaceListings).mockResolvedValueOnce({
      data: [{ id: 7, title: 'Hedge trimmer', is_saved: false }],
      meta: { has_more: false, next_cursor: null },
    } as never);
    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(getByText('Hedge trimmer')).toBeTruthy());
  });

  it('shows the feature gate when the community has not enabled the marketplace', () => {
    mockFeatures = new Set();

    const { getByText } = render(<MarketplaceBorrowRoute />);

    expect(getByText('Marketplace unavailable')).toBeTruthy();
    expect(getMarketplaceListings).not.toHaveBeenCalled();
  });
});
