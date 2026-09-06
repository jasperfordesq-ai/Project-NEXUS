// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockShowToast = jest.fn();
const mockUseFocusEffect = jest.fn();

// --- Mocks ---

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useSegments: () => ['(tabs)'],
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ setOptions: jest.fn() }),
  useFocusEffect: (cb: () => void) => mockUseFocusEffect(cb),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'title': 'Listings',
        'searchPlaceholder': 'Search listings\u2026',
        'newListing': 'Create new listing',
        'empty': 'No listings found.',
        'detail.actionFailedTitle': 'Action failed',
        'detail.saveFailed': "We couldn't update your saved listings.",
        'common:buttons.retry': 'Retry',
        'categoriesRetry': 'Retry categories',
        'categoriesLoading': 'Loading categories…',
        'filterAllCategories': 'All categories',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => ({ hasFeature: () => true }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
    borderSubtle: '#eeeeee',
    error: '#e53e3e',
    errorBg: '#fff5f5',
  }),
}));

const mockUsePaginatedApi = jest.fn();
jest.mock('@/lib/hooks/usePaginatedApi', () => ({
  usePaginatedApi: (...args: unknown[]) => mockUsePaginatedApi(...args),
}));

jest.mock('@/lib/hooks/useDebounce', () => ({
  useDebounce: (value: string) => value,
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/lib/api/exchanges', () => ({
  getExchanges: jest.fn(),
  getExchangeCategories: jest.fn(),
  saveExchange: jest.fn(),
  unsaveExchange: jest.fn(),
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

jest.mock('@/components/ExchangeCard', () => {
  const MockExchangeCard = ({
    exchange,
    onToggleSave,
  }: {
    exchange: { id: number; title: string; is_favorited?: boolean };
    onToggleSave?: (id: number, saved: boolean) => void;
  }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable
        accessibilityLabel={`Toggle save ${exchange.title}`}
        onPress={() => onToggleSave?.(exchange.id, Boolean(exchange.is_favorited))}
      >
        <Text>{exchange.title}</Text>
      </Pressable>
    );
  };
  MockExchangeCard.displayName = 'MockExchangeCard';
  return MockExchangeCard;
});

jest.mock('@/components/OfflineBanner', () => () => null);
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/AppToast', () => ({
  useAppToast: () => ({ show: mockShowToast, hide: jest.fn(), isToastVisible: false }),
}));
jest.mock('@/components/ui/Skeleton', () => ({
  ExchangeCardSkeleton: () => null,
  ProfileSkeleton: () => null,
}));

// --- Tests ---

import ExchangesScreen from './exchanges';
import { getExchangeCategories, getExchanges, saveExchange, unsaveExchange } from '@/lib/api/exchanges';
import * as Location from 'expo-location';

const defaultPaginatedState = {
  items: [],
  isLoading: false,
  isLoadingMore: false,
  error: null,
  hasMore: false,
  loadMore: jest.fn(),
  refresh: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  // By default behave like a screen that is on-screen but has not been navigated back to.
  mockUseFocusEffect.mockImplementation((cb: () => void) => { cb(); });
  mockUsePaginatedApi.mockReturnValue(defaultPaginatedState);
  (getExchanges as jest.Mock).mockResolvedValue({ data: [], meta: { cursor: null, has_more: false, per_page: 20 } });
  (getExchangeCategories as jest.Mock).mockResolvedValue({ data: [] });
  (saveExchange as jest.Mock).mockResolvedValue({});
  (unsaveExchange as jest.Mock).mockResolvedValue(undefined);
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ status: 'granted' } as never);
  jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue({
    coords: { latitude: 53.3498, longitude: -6.2603 },
  } as never);
});

const mockExchange = {
  id: 5,
  title: 'Gardening Help Offered',
  type: 'offer' as const,
  description: 'I can help with your garden.',
  time_credits: 2,
  user: { id: 1, name: 'Alice Smith', avatar_url: null },
  created_at: '2026-01-10T09:00:00Z',
  is_favorited: false,
};

describe('ExchangesScreen', () => {
  it('renders the screen title', () => {
    const { getByText } = render(<ExchangesScreen />);
    expect(getByText('Listings')).toBeTruthy();
  });

  it('renders the search input', () => {
    const { getByPlaceholderText, getByTestId } = render(<ExchangesScreen />);
    expect(getByPlaceholderText('Search listings\u2026')).toBeTruthy();
    expect(getByTestId('listings-search')).toBeTruthy();
  });

  it('renders empty state when there are no exchanges and not loading', () => {
    const { getByText } = render(<ExchangesScreen />);
    expect(getByText('No listings found.')).toBeTruthy();
  });

  it('does not show empty text while loading', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [],
      isLoading: true,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { queryByText } = render(<ExchangesScreen />);
    expect(queryByText('No listings found.')).toBeNull();
  });

  it('renders exchange cards when data is loaded', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [mockExchange],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { getByText } = render(<ExchangesScreen />);
    expect(getByText('Gardening Help Offered')).toBeTruthy();
  });

  it('shows visible feedback when saving a listing fails', async () => {
    mockUsePaginatedApi.mockReturnValue({
      ...defaultPaginatedState,
      items: [mockExchange],
    });
    (saveExchange as jest.Mock).mockRejectedValueOnce(new Error('offline'));

    const { getByLabelText } = render(<ExchangesScreen />);
    fireEvent.press(getByLabelText('Toggle save Gardening Help Offered'));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith({
      title: 'Action failed',
      description: "We couldn't update your saved listings.",
      variant: 'danger',
    }));
  });

  it('shows error text with Retry button when exchanges fail to load', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [],
      isLoading: false,
      isLoadingMore: false,
      error: 'Failed to load listings.',
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { getByText } = render(<ExchangesScreen />);
    expect(getByText('Failed to load listings.')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
  });

  it('updates the search input value when typed into', () => {
    const { getByPlaceholderText } = render(<ExchangesScreen />);
    const input = getByPlaceholderText('Search listings\u2026');
    fireEvent.changeText(input, 'gardening');
    expect(input.props.value).toBe('gardening');
  });

  it('uses current device location for the near me filter', async () => {
    const { getByText } = render(<ExchangesScreen />);

    expect(getByText('nearMe')).toBeTruthy();
    fireEvent.press(getByText('nearMe'));

    await waitFor(() => {
      expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled();
      expect(Location.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: Location.Accuracy.Balanced });
    });

    const latestFetch = mockUsePaginatedApi.mock.calls.at(-1)?.[0] as ((cursor: string | null) => Promise<unknown>) | undefined;
    expect(latestFetch).toBeDefined();
    await latestFetch?.(null);

    expect(getExchanges).toHaveBeenCalledWith(null, expect.objectContaining({
      near_lat: '53.3498',
      near_lng: '-6.2603',
      radius_km: '25',
    }));
  });

  /**
   * 🔴 Measured on a device 2026-08-22: tapping Offer or Request moved the underline and
   * recoloured the icon, but the request stayed `GET /v2/listings?personalised=true` with no
   * `type`, so the list never changed — a "Requesting" card sat under the Offer tab. The API
   * honours `type` correctly (checked directly), so the fault is here. Journey 3.4.
   */
  it('sends the offer/request type when that tab is chosen', async () => {
    const { getByText } = render(<ExchangesScreen />);

    fireEvent.press(getByText('offer'));

    const latestFetch = mockUsePaginatedApi.mock.calls.at(-1)?.[0] as ((cursor: string | null) => Promise<unknown>) | undefined;
    await latestFetch?.(null);

    expect(getExchanges).toHaveBeenCalledWith(null, expect.objectContaining({ type: 'offer' }));
  });

  /**
   * 🔴 S2-14: the category strip called the API once and, if that call failed, simply
   * disappeared — the member saw a listings page with no way to filter by category and no
   * hint that anything had gone wrong. It now offers a retry (audit 2026-09-06).
   */
  it('offers a retry when the category list fails, and recovers on the second attempt', async () => {
    (getExchangeCategories as jest.Mock)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ data: [{ id: 3, name: 'Gardening', color: '#22aa55' }] });

    const { getByText, queryByText } = render(<ExchangesScreen />);
    fireEvent.press(getByText('filters'));

    await waitFor(() => expect(getByText('Retry categories')).toBeTruthy());
    expect(queryByText('Gardening')).toBeNull();

    fireEvent.press(getByText('Retry categories'));

    await waitFor(() => expect(getByText('Gardening')).toBeTruthy());
    expect(queryByText('Retry categories')).toBeNull();
  });

  it('filters by a category once one is chosen', async () => {
    (getExchangeCategories as jest.Mock).mockResolvedValue({
      data: [{ id: 3, name: 'Gardening', color: '#22aa55' }],
    });

    const { getByText } = render(<ExchangesScreen />);
    fireEvent.press(getByText('filters'));
    await waitFor(() => expect(getByText('Gardening')).toBeTruthy());
    fireEvent.press(getByText('Gardening'));

    const latestFetch = mockUsePaginatedApi.mock.calls.at(-1)?.[0] as ((cursor: string | null) => Promise<unknown>) | undefined;
    await latestFetch?.(null);

    expect(getExchanges).toHaveBeenCalledWith(null, expect.objectContaining({ category_id: '3' }));
  });

  it.each([
    ['duration.short', { min_hours: '1', max_hours: '3' }],
    ['duration.halfDay', { min_hours: '3', max_hours: '6' }],
    ['duration.fullDay', { min_hours: '6' }],
  ])('translates the %s duration filter into hour bounds', async (label, expected) => {
    const { getByText } = render(<ExchangesScreen />);
    fireEvent.press(getByText('filters'));
    fireEvent.press(getByText(label));

    const latestFetch = mockUsePaginatedApi.mock.calls.at(-1)?.[0] as ((cursor: string | null) => Promise<unknown>) | undefined;
    await latestFetch?.(null);

    expect(getExchanges).toHaveBeenCalledWith(null, expect.objectContaining(expected));
  });

  it('sends the in-person service filter as a physical-only search', async () => {
    const { getByText } = render(<ExchangesScreen />);
    fireEvent.press(getByText('filters'));
    fireEvent.press(getByText('service.inPerson'));

    const latestFetch = mockUsePaginatedApi.mock.calls.at(-1)?.[0] as ((cursor: string | null) => Promise<unknown>) | undefined;
    await latestFetch?.(null);

    expect(getExchanges).toHaveBeenCalledWith(null, expect.objectContaining({ service_type: 'physical_only' }));
  });

  it('drops a duplicated listing rather than crashing the list on a repeated key', () => {
    render(<ExchangesScreen />);
    const extract = mockUsePaginatedApi.mock.calls.at(-1)?.[1] as
      ((r: unknown) => { items: unknown[]; cursor: string | null; hasMore: boolean }) | undefined;
    expect(extract).toBeDefined();

    const page = extract?.({
      data: [mockExchange, { ...mockExchange }, { ...mockExchange, id: 6 }],
      meta: { cursor: 'next-page', has_more: true, per_page: 20 },
    });

    expect(page?.items).toHaveLength(2);
    expect(page?.cursor).toBe('next-page');
    expect(page?.hasMore).toBe(true);
  });

  /**
   * 🔴 S2-10: a listing created, edited or deleted on a child screen was still absent or
   * present here until a pull to refresh. The first focus must NOT refetch — the initial
   * load has already done it — but every return must (audit 2026-09-05).
   */
  it('refetches when the member returns to the tab, but not on the first render', () => {
    const refresh = jest.fn();
    mockUsePaginatedApi.mockReturnValue({ ...defaultPaginatedState, refresh });

    let focusCallback: (() => void) | undefined;
    mockUseFocusEffect.mockImplementation((cb: () => void) => { focusCallback = cb; cb(); });

    render(<ExchangesScreen />);
    expect(refresh).not.toHaveBeenCalled();

    focusCallback?.();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('sends advanced filter params to the listings API', async () => {
    const { getByText } = render(<ExchangesScreen />);

    fireEvent.press(getByText('filters'));
    fireEvent.press(getByText('duration.quick'));
    fireEvent.press(getByText('service.remote'));
    fireEvent.press(getByText('posted.week'));
    fireEvent.press(getByText('sort.newest'));

    const latestFetch = mockUsePaginatedApi.mock.calls.at(-1)?.[0] as ((cursor: string | null) => Promise<unknown>) | undefined;
    expect(latestFetch).toBeDefined();
    await latestFetch?.(null);

    expect(getExchanges).toHaveBeenCalledWith(null, expect.objectContaining({
      max_hours: '1',
      service_type: 'remote_only,hybrid',
      posted_within: '7',
      sort: 'newest',
      personalised: 'false',
    }));
  });
});
