// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

// --- Mocks ---

let mockSearchParams: Record<string, string | undefined> = {};
const mockRouterPush = jest.fn();
const mockUsePaginatedApi = jest.fn();
const mockGetMyListings = jest.fn();

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => mockSearchParams,
  router: { push: (...args: unknown[]) => mockRouterPush(...args), replace: jest.fn(), back: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'mine.title': 'My listings',
        'mine.description': 'Everything you have offered or asked for.',
        'mine.tabsLabel': 'Show your listings by state',
        'mine.tab.live': 'Live',
        'mine.tab.review': 'Waiting for review',
        'mine.tab.rejected': 'Not approved',
        'mine.tab.expired': 'Expired',
        'mine.tab.closed': 'Closed',
        'mine.empty.live': 'You have no live listings',
        'mine.empty.expired': 'Nothing has expired',
        'mine.emptyLiveBody': 'Offer a skill or ask for help.',
        'mine.newListing': 'New listing',
        'mine.loadError': 'We could not load your listings.',
        'mine.state.expired': 'This listing has expired.',
        'mine.state.rejected': 'An administrator did not approve this listing.',
        'mine.rejectedReason': opts ? `Reason given: ${String(opts.reason ?? '')}` : 'Reason given',
        'mine.visibleUntil': opts ? `Visible until ${String(opts.date ?? '')}` : 'Visible until',
        'common:back': 'Back',
        'common:endOfList': 'End of list',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppTopBar', () => {
  const { Text } = require('react-native');
  return ({ title }: { title: string }) => <Text>{title}</Text>;
});
jest.mock('@/components/ExchangeCard', () => {
  const { Text } = require('react-native');
  return ({ exchange }: { exchange: { title: string } }) => <Text>{exchange.title}</Text>;
});
jest.mock('@/components/ui/Skeleton', () => ({
  ExchangeCardSkeleton: () => null,
}));
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
  useTenant: () => ({ hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#006FEE',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    error: '#dc2626',
  }),
}));

jest.mock('@/lib/hooks/usePaginatedApi', () => ({
  usePaginatedApi: (...args: unknown[]) => mockUsePaginatedApi(...args),
}));

jest.mock('@/lib/api/exchanges', () => ({
  OWNED_LISTING_GROUPS: ['live', 'review', 'rejected', 'expired', 'closed'],
  getMyListings: (...args: unknown[]) => mockGetMyListings(...args),
}));

// --- Tests ---

import MyListingsScreen from './my-listings';

const defaultState = {
  items: [],
  isLoading: false,
  isLoadingMore: false,
  error: null,
  hasMore: false,
  loadMore: jest.fn(),
  refresh: jest.fn(),
};

type Fetcher = (cursor: string | null) => unknown;
type Extractor = (response: unknown) => { items: unknown[]; cursor: string | null; hasMore: boolean };

function latestFetcher(): Fetcher {
  return mockUsePaginatedApi.mock.calls.at(-1)?.[0] as Fetcher;
}

function latestExtractor(): Extractor {
  return mockUsePaginatedApi.mock.calls.at(-1)?.[1] as Extractor;
}

beforeEach(() => {
  mockSearchParams = {};
  mockRouterPush.mockReset();
  mockGetMyListings.mockReset();
  mockUsePaginatedApi.mockReset();
  mockUsePaginatedApi.mockReturnValue(defaultState);
});

describe('MyListingsScreen', () => {
  it('loads the live group of GET /v2/listings/mine by default', () => {
    const { getByText } = render(<MyListingsScreen />);

    expect(getByText('My listings')).toBeTruthy();
    latestFetcher()(null);
    expect(mockGetMyListings).toHaveBeenLastCalledWith('live', null, 20);
    // Live and Expired are always offered, as on the website.
    expect(getByText('Live (0)')).toBeTruthy();
    expect(getByText('Expired (0)')).toBeTruthy();
  });

  it('shows the groups that hold listings, with their counts from meta.counts, and switches group', () => {
    const view = render(<MyListingsScreen />);

    // The extractor records the server's counts for every group.
    act(() => {
      latestExtractor()({ data: [], meta: { cursor: null, has_more: false, counts: { live: 2, review: 1, expired: 3 } } });
    });

    expect(view.getByText('Live (2)')).toBeTruthy();
    expect(view.getByText('Waiting for review (1)')).toBeTruthy();
    expect(view.queryByText(/Not approved/)).toBeNull();

    fireEvent.press(view.getByText('Expired (3)'));
    latestFetcher()('cursor-2');
    expect(mockGetMyListings).toHaveBeenLastCalledWith('expired', 'cursor-2', 20);
  });

  it('opens on the group named by ?tab=', () => {
    mockSearchParams = { tab: 'expired' };
    render(<MyListingsScreen />);

    latestFetcher()(null);
    expect(mockGetMyListings).toHaveBeenLastCalledWith('expired', null, 20);
  });

  it('ignores an unknown ?tab=', () => {
    mockSearchParams = { tab: 'deleted' };
    render(<MyListingsScreen />);

    latestFetcher()(null);
    expect(mockGetMyListings).toHaveBeenLastCalledWith('live', null, 20);
  });

  it('explains where each listing stands, including an administrator\'s reason', () => {
    mockSearchParams = { tab: 'rejected' };
    mockUsePaginatedApi.mockReturnValue({
      ...defaultState,
      items: [{ id: 5, title: 'Dog walking', type: 'offer', rejection_reason: 'Duplicate listing' }],
    });

    const { getByText } = render(<MyListingsScreen />);

    expect(getByText('Dog walking')).toBeTruthy();
    expect(getByText('An administrator did not approve this listing. Reason given: Duplicate listing')).toBeTruthy();
  });

  it('offers to create a listing when there are no live listings', () => {
    const { getByText } = render(<MyListingsScreen />);

    expect(getByText('You have no live listings')).toBeTruthy();
    expect(getByText('New listing')).toBeTruthy();
  });

  it('says so when the listings cannot be loaded', () => {
    mockUsePaginatedApi.mockReturnValue({ ...defaultState, error: 'Server unavailable' });

    const { getByText } = render(<MyListingsScreen />);

    expect(getByText('We could not load your listings.')).toBeTruthy();
    expect(getByText('Server unavailable')).toBeTruthy();
  });
});
