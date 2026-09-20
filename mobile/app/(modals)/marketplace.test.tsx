// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { FlatList, RefreshControl } from 'react-native';

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
        'actions.deliveries': 'Community delivery',
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
  const { Pressable, Text, View } = require('react-native');
  return ({ item, onSavePress, isSaving }: { item: { id: number; title: string; is_saved?: boolean }; onSavePress: () => void; isSaving?: boolean }) => (
    <View><Text>{item.title}</Text><Pressable testID={`save-${item.id}`} disabled={isSaving} accessibilityState={{ busy: isSaving }} onPress={onSavePress}><Text>{item.is_saved ? 'Saved' : 'Save'}</Text></Pressable></View>
  );
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
  marketplaceHasMore,
  marketplaceNextCursor,
  saveMarketplaceListing,
} from '@/lib/api/marketplace';

describe('MarketplaceRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(marketplaceHasMore).mockReturnValue(false);
    jest.mocked(marketplaceNextCursor).mockReturnValue(null);
    jest.mocked(saveMarketplaceListing).mockReset().mockResolvedValue(undefined as never);
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

  it('sends one save for repeated taps before the request settles', async () => {
    jest.mocked(getMarketplaceListings).mockResolvedValueOnce({ data: [{ id: 1, title: 'Drill', is_saved: false }] } as never);
    jest.mocked(saveMarketplaceListing).mockImplementation(() => new Promise(() => {}));
    const screen = render(<MarketplaceRoute />);
    await waitFor(() => expect(screen.getByText('Drill')).toBeTruthy());
    const save = screen.getByTestId('save-1');
    act(() => { fireEvent.press(save); fireEvent.press(save); });
    expect(saveMarketplaceListing).toHaveBeenCalledTimes(1);
  });

  it('rolls back only the save flag when a refreshed listing has changed', async () => {
    jest.mocked(getMarketplaceListings).mockResolvedValueOnce({ data: [{ id: 1, title: 'Old drill', is_saved: false }] } as never);
    let failSave!: (error: Error) => void;
    jest.mocked(saveMarketplaceListing).mockImplementationOnce(() => new Promise((_resolve, reject) => { failSave = reject; }));
    const screen = render(<MarketplaceRoute />);
    await waitFor(() => expect(screen.getByText('Old drill')).toBeTruthy());
    fireEvent.press(screen.getByTestId('save-1'));
    jest.mocked(getMarketplaceListings).mockResolvedValueOnce({ data: [{ id: 1, title: 'Updated drill', is_saved: false }] } as never);
    fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');
    await waitFor(() => expect(screen.getByText('Updated drill')).toBeTruthy());
    await act(async () => { failSave(new Error('offline')); });
    expect(screen.queryByText('Old drill')).toBeNull();
    expect(screen.getByText('Updated drill')).toBeTruthy();
    expect(screen.getByText('Save')).toBeTruthy();
    fireEvent.press(screen.getByTestId('save-1'));
    await waitFor(() => expect(saveMarketplaceListing).toHaveBeenCalledTimes(2));
  });

  it('applies a confirmed save after an overlapping refresh returns the previous flag', async () => {
    jest.mocked(getMarketplaceListings).mockResolvedValueOnce({ data: [{ id: 1, title: 'Drill', is_saved: false }] } as never);
    let finishSave!: () => void;
    jest.mocked(saveMarketplaceListing).mockImplementationOnce(() => new Promise(resolve => { finishSave = () => resolve(undefined as never); }));
    const screen = render(<MarketplaceRoute />);
    await waitFor(() => expect(screen.getByText('Drill')).toBeTruthy());
    fireEvent.press(screen.getByTestId('save-1'));
    expect(screen.getByTestId('save-1').props.accessibilityState.busy).toBe(true);
    jest.mocked(getMarketplaceListings).mockResolvedValueOnce({ data: [{ id: 1, title: 'Updated drill', is_saved: false }] } as never);
    fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');
    await waitFor(() => expect(screen.getByText('Updated drill')).toBeTruthy());
    await act(async () => { finishSave(); });
    expect(screen.getByTestId('save-1').props.accessibilityState.busy).toBe(false);
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(screen.getByText('Updated drill')).toBeTruthy();
  });

  it('renders the real card save control as busy and disabled during a write', () => {
    const Card = jest.requireActual('@/components/marketplace/MarketplaceListingCard').default;
    const save = jest.fn();
    const screen = render(<Card item={{ id: 1, title: 'Drill', price_type: 'free', is_saved: false }} onPress={jest.fn()} onSavePress={save} isSaving />);
    const button = screen.getByLabelText('detail.save');
    expect(button.props.accessibilityState).toEqual(expect.objectContaining({ busy: true, disabled: true }));
    fireEvent.press(button);
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps a confirmed save when an older refresh resolves afterwards', async () => {
    jest.mocked(getMarketplaceListings).mockResolvedValueOnce({ data: [{ id: 1, title: 'Drill', is_saved: false }] } as never);
    const screen = render(<MarketplaceRoute />);
    await waitFor(() => expect(screen.getByText('Drill')).toBeTruthy());
    let finishRefresh!: (value: unknown) => void;
    jest.mocked(getMarketplaceListings).mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve as (value: unknown) => void; }));
    fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');
    await act(async () => { fireEvent.press(screen.getByTestId('save-1')); });
    expect(screen.getByText('Saved')).toBeTruthy();
    await act(async () => { finishRefresh({ data: [{ id: 1, title: 'Updated drill', is_saved: false }] }); });
    expect(screen.getByText('Updated drill')).toBeTruthy();
    expect(screen.getByText('Saved')).toBeTruthy();
    jest.mocked(getMarketplaceListings).mockResolvedValueOnce({ data: [{ id: 1, title: 'Latest drill', is_saved: false }] } as never);
    fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');
    await waitFor(() => expect(screen.getByText('Latest drill')).toBeTruthy());
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('ignores an old catalogue response after changing the price filter', async () => {
    let finishOld!: (value: unknown) => void;
    jest.mocked(getMarketplaceListings).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve as (value: unknown) => void; }));
    const screen = render(<MarketplaceRoute />);
    await waitFor(() => expect(getMarketplaceListings).toHaveBeenCalledTimes(1));
    jest.mocked(getMarketplaceListings).mockResolvedValueOnce({ data: [{ id: 2, title: 'Free drill' }] } as never);
    fireEvent.press(screen.getByText('Free'));
    await waitFor(() => expect(screen.getByText('Free drill')).toBeTruthy());
    await act(async () => { finishOld({ data: [{ id: 1, title: 'Old catalogue' }] }); });
    expect(screen.queryByText('Old catalogue')).toBeNull();
    expect(screen.getByText('Free drill')).toBeTruthy();
  });

  it('dispatches one later-page request for two same-frame end events', async () => {
    jest.mocked(marketplaceHasMore).mockReturnValue(true);
    jest.mocked(marketplaceNextCursor).mockReturnValue('next');
    jest.mocked(getMarketplaceListings).mockResolvedValueOnce({ data: [{ id: 1, title: 'Drill' }] } as never);
    const screen = render(<MarketplaceRoute />);
    await waitFor(() => expect(screen.getByText('Drill')).toBeTruthy());
    jest.mocked(getMarketplaceListings).mockImplementation(() => new Promise(() => {}));
    const list = screen.UNSAFE_getByType(FlatList);
    act(() => { fireEvent(list, 'endReached'); fireEvent(list, 'endReached'); });
    expect(getMarketplaceListings).toHaveBeenCalledTimes(2);
  });

  it.each(['refresh', 'page'])('keeps rows with a retry after a failed %s', async operation => {
    jest.mocked(marketplaceHasMore).mockReturnValue(true);
    jest.mocked(marketplaceNextCursor).mockReturnValue('next');
    jest.mocked(getMarketplaceListings).mockResolvedValueOnce({ data: [{ id: 1, title: 'Drill' }] } as never);
    const screen = render(<MarketplaceRoute />);
    await waitFor(() => expect(screen.getByText('Drill')).toBeTruthy());
    jest.mocked(getMarketplaceListings).mockRejectedValueOnce(new Error('Marketplace unavailable'));
    if (operation === 'refresh') fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');
    else fireEvent(screen.UNSAFE_getByType(FlatList), 'endReached');
    await waitFor(() => expect(screen.getByText('Marketplace unavailable')).toBeTruthy());
    expect(screen.getByText('Drill')).toBeTruthy();
    const callsBeforeRetry = jest.mocked(getMarketplaceListings).mock.calls.length;
    fireEvent(screen.UNSAFE_getByType(FlatList), 'endReached');
    expect(getMarketplaceListings).toHaveBeenCalledTimes(callsBeforeRetry);
    jest.mocked(getMarketplaceListings).mockResolvedValueOnce({ data: [{ id: 2, title: 'Updated drill' }] } as never);
    fireEvent.press(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByText('Updated drill')).toBeTruthy());
    expect(screen.queryByText('Marketplace unavailable')).toBeNull();
    expect(getMarketplaceListings).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: operation === 'page' ? 'next' : null }));
    if (operation === 'page') expect(screen.getByText('Drill')).toBeTruthy();
  });

  it('deduplicates rows across and within pages', async () => {
    jest.mocked(marketplaceHasMore).mockReturnValue(true);
    jest.mocked(marketplaceNextCursor).mockReturnValue('next');
    jest.mocked(getMarketplaceListings)
      .mockResolvedValueOnce({ data: [{ id: 1, title: 'Drill' }] } as never)
      .mockResolvedValueOnce({ data: [{ id: 1, title: 'Drill' }, { id: 2, title: 'Saw' }, { id: 2, title: 'Saw' }] } as never);
    const screen = render(<MarketplaceRoute />);
    await waitFor(() => expect(screen.getByText('Drill')).toBeTruthy());
    fireEvent(screen.UNSAFE_getByType(FlatList), 'endReached');
    await waitFor(() => expect(screen.getAllByText('Saw')).toHaveLength(1));
    expect(screen.getAllByText('Drill')).toHaveLength(1);
  });

  it('ignores an older page after a refresh replaces the catalogue', async () => {
    jest.mocked(marketplaceHasMore).mockReturnValue(true);
    jest.mocked(marketplaceNextCursor).mockReturnValue('next');
    jest.mocked(getMarketplaceListings).mockResolvedValueOnce({ data: [{ id: 1, title: 'Drill' }] } as never);
    const screen = render(<MarketplaceRoute />);
    await waitFor(() => expect(screen.getByText('Drill')).toBeTruthy());
    let finishPage!: (value: unknown) => void;
    jest.mocked(getMarketplaceListings).mockImplementationOnce(() => new Promise(resolve => { finishPage = resolve as (value: unknown) => void; }));
    fireEvent(screen.UNSAFE_getByType(FlatList), 'endReached');
    jest.mocked(getMarketplaceListings).mockResolvedValueOnce({ data: [{ id: 3, title: 'Current catalogue' }] } as never);
    fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');
    await waitFor(() => expect(screen.getByText('Current catalogue')).toBeTruthy());
    await act(async () => { finishPage({ data: [{ id: 2, title: 'Old page' }] }); });
    expect(screen.queryByText('Old page')).toBeNull();
    expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
    expect(screen.getByText('Current catalogue')).toBeTruthy();
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
    const { getByLabelText, getByPlaceholderText, getByText, unmount } = render(<MarketplaceRoute />);

    await waitFor(() => {
      expect(getByPlaceholderText('Search marketplace...')).toBeTruthy();
      expect(getByText('Tools')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('Search marketplace...'), 'bike');
    expect(getByLabelText('Clear marketplace search')).toBeTruthy();
    unmount();
  });

  it('opens the community delivery journey from the marketplace hub', async () => {
    const { getByText, unmount } = render(<MarketplaceRoute />);
    await waitFor(() => {
      expect(getMarketplaceListings).toHaveBeenCalled();
      expect(getByText('Tools')).toBeTruthy();
    });
    fireEvent.press(await waitFor(() => getByText('Community delivery')));
    const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };
    expect(router.push).toHaveBeenCalledWith('/(modals)/marketplace-deliveries');
    unmount();
  });
});
