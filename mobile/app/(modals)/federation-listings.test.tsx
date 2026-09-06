// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockLoadMore = jest.fn();
const mockRefresh = jest.fn();
const mockUseApi = jest.fn();
const mockUsePaginatedApi = jest.fn();
let mockSearchParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'directory.listings.eyebrow': 'Shared offers and requests',
        'directory.listings.title': 'Federated Listings',
        'directory.listings.subtitle': 'Browse offers and requests shared across trusted timebanks.',
        'directory.listings.search': 'Search listings...',
        'directory.listings.type.all': 'All listings',
        'directory.listings.type.offer': 'Offers',
        'directory.listings.type.request': 'Requests',
        'directory.listings.offer': 'Offer',
        'directory.listings.request': 'Request',
        'directory.listings.anonymousUser': 'Community member',
        'directory.listings.viewDetails': 'View details',
        'directory.listings.backToListings': 'Back to listings',
        'directory.listings.noDescription': 'This shared listing does not have a description yet.',
        'directory.listings.details': 'Listing details',
        'directory.listings.postedBy': 'Posted by',
        'directory.listings.viewProfile': 'View profile',
        'directory.listings.contactAuthor': 'Message author',
        'directory.listings.loadMore': 'Load more listings',
        'directory.resultsCount': `${String(opts?.count ?? 0)} results`,
        'directory.filters.allCommunities': 'All communities',
        'directory.unknownCommunity': 'Partner community',
        'directory.external': 'External',
        'common:back': 'Back',
      };
      if (key === 'directory.listings.openDetails') return `Open details for ${String(opts?.title ?? '')}`;
      if (key === 'directory.listings.hours') return `${String(opts?.hours ?? '')} hours`;
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ hasFeature: () => true }),
  usePrimaryColor: () => '#6366f1',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
    error: '#e53e3e',
    success: '#22c55e',
  }),
}));

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/hooks/usePaginatedApi', () => ({
  usePaginatedApi: (...args: unknown[]) => mockUsePaginatedApi(...args),
}));

jest.mock('@/lib/api/federation', () => ({
  getFederationEvents: jest.fn(),
  getFederationGroups: jest.fn(),
  getFederationListings: jest.fn(),
  getFederationMembers: jest.fn(),
  getFederationMessages: jest.fn(),
  getFederationPartners: jest.fn(),
  getFederationSettings: jest.fn(),
  getFederationMember: jest.fn(),
  markFederationMessageRead: jest.fn(),
  sendFederationMessage: jest.fn(),
  updateFederationSettings: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('heroui-native', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');

  const Button = ({ children, onPress, accessibilityLabel, isDisabled }: { children: React.ReactNode; onPress?: () => void; accessibilityLabel?: string; isDisabled?: boolean }) => (
    <Pressable accessibilityLabel={accessibilityLabel} onPress={isDisabled ? undefined : onPress}>
      <View>{children}</View>
    </Pressable>
  );
  Button.Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;

  const Card = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Card.Body = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;

  const Chip = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Chip.Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;

  return {
    Button,
    Card,
    Chip,
    Spinner: () => null,
    Surface: ({ children }: { children?: React.ReactNode }) => <View>{children}</View>,
  };
});

jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/EmptyState', () => 'View');
jest.mock('@/components/ui/Input', () => 'View');
jest.mock('@/components/ui/Toggle', () => 'View');

import FederationListingsScreen from './federation-listings';
import { getFederationListings } from '@/lib/api/federation';

const listing = {
  id: 90624,
  title: 'Shared drill',
  description: 'Borrow a drill from a partner community.',
  type: 'offer' as const,
  category_name: 'Tools',
  estimated_hours: 2,
  location: 'Cork',
  author: { id: 272, name: 'Katherine', avatar: null },
  timebank: { id: 5, name: 'Cork Timebank' },
  created_at: '2026-05-01T12:00:00Z',
};

beforeEach(() => {
  mockSearchParams = {};
  mockLoadMore.mockClear();
  mockRefresh.mockClear();
  mockUsePaginatedApi.mockClear();
  (getFederationListings as jest.Mock).mockReset();
  mockUseApi.mockReturnValue({ data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() });
  mockUsePaginatedApi.mockReturnValue({
    items: [listing],
    isLoading: false,
    isLoadingMore: false,
    error: null,
    hasMore: true,
    loadMore: mockLoadMore,
    refresh: mockRefresh,
  });
});

describe('FederationListingsScreen', () => {
  it('renders listing cards with a paginated load-more action', () => {
    const { getByText } = render(<FederationListingsScreen />);

    expect(getByText('Federated Listings')).toBeTruthy();
    expect(getByText('Shared drill')).toBeTruthy();

    fireEvent.press(getByText('Load more listings'));
    expect(mockLoadMore).toHaveBeenCalledTimes(1);
  });

  it('opens listing detail content from a card press', () => {
    const { router } = require('expo-router');
    const { getByLabelText, getByText } = render(<FederationListingsScreen />);

    fireEvent.press(getByLabelText('Open details for Shared drill'));

    expect(getByText('Listing details')).toBeTruthy();
    expect(getByText('Posted by')).toBeTruthy();
    expect(getByText('Message author')).toBeTruthy();

    fireEvent.press(getByText('View profile'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(modals)/federation-member',
      params: { id: '272', tenant_id: '5' },
    });
  });

  it('passes partner route filters to the listing API fetcher', async () => {
    mockSearchParams = { partner_id: 'ext-2' };
    (getFederationListings as jest.Mock).mockResolvedValue({ data: [], meta: { cursor: null, has_more: false } });

    render(<FederationListingsScreen />);
    const fetchPage = mockUsePaginatedApi.mock.calls[0][0] as (cursor: string | null) => Promise<unknown>;
    await fetchPage(null);

    expect(getFederationListings).toHaveBeenCalledWith({ per_page: '30', partner_id: 'ext-2' });
  });

  it('resyncs partner and search filters when a reused route receives new params', async () => {
    (getFederationListings as jest.Mock).mockResolvedValue({ data: [], meta: { cursor: null, has_more: false } });
    const screen = render(<FederationListingsScreen />);

    mockSearchParams = { partner_id: 'ext-9', q: 'drill' };
    screen.rerender(<FederationListingsScreen />);

    await waitFor(() => {
      const latestCall = mockUsePaginatedApi.mock.calls[mockUsePaginatedApi.mock.calls.length - 1];
      const fetchPage = latestCall[0] as (cursor: string | null) => Promise<unknown>;
      void fetchPage(null);
      expect(getFederationListings).toHaveBeenCalledWith({ per_page: '30', partner_id: 'ext-9', q: 'drill' });
    });
  });

  it('routes external listing author actions through external federation identifiers', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [{
        ...listing,
        id: 'ext-7-456',
        title: 'External ladder',
        author: { id: 123, name: 'External Sam', avatar: null },
        timebank: { id: 99, name: 'Remote partner' },
        is_external: true,
      }],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: mockLoadMore,
      refresh: mockRefresh,
    });

    const { router } = require('expo-router');
    const { getByLabelText, getByText } = render(<FederationListingsScreen />);

    fireEvent.press(getByLabelText('Open details for External ladder'));
    fireEvent.press(getByText('View profile'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(modals)/federation-member',
      params: { id: 'ext-7-123', tenant_id: 'ext-7', name: 'External Sam' },
    });

    router.push.mockClear();
    fireEvent.press(getByText('Message author'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(modals)/federation-messages',
      params: { compose: 'true', to_user: '123', to_tenant: 'ext-7', name: 'External Sam', community: 'Remote partner' },
    });
  });
});
