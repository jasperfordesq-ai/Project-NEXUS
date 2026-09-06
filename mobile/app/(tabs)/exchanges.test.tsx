// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockShowToast = jest.fn();

// --- Mocks ---

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useSegments: () => ['(tabs)'],
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
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
