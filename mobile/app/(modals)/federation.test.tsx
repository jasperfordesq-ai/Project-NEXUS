// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ setOptions: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        title: 'Federation',
        partners: 'Partner Communities',
        empty: 'No federation partners yet.',
        connectedSince: opts ? `Connected since ${String(opts.date ?? '')}` : 'Connected since',
        'hub.eyebrow': 'Partner communities',
        'hub.heroTitle': 'Federation Hub',
        'hub.heroDescription': 'Connect with trusted timebanks, discover federated members, and share exchanges across partner communities.',
        'hub.statusActive': 'Federation active',
        'hub.statusInactive': 'Federation inactive',
        'hub.shortActive': 'Active',
        'hub.shortInactive': 'Inactive',
        'hub.statPartners': 'Partners',
        'hub.statMessages': 'Messages',
        'hub.statExchanges': 'Exchanges',
        'hub.statStatus': 'Status',
        'hub.exploreNetwork': 'Explore network',
        'hub.partnerCommunities': 'Partner communities',
        'hub.recentActivity': 'Recent activity',
        'hub.noPartnersYet': 'No partner communities yet',
        'hub.noPartnersDescription': 'Approved federation partners will appear here once your community connects.',
        'hub.noActivityYet': 'No activity yet',
        'hub.noActivityDescription': 'Cross-community messages, partnerships, and exchanges will appear here.',
        'hub.memberCount': opts ? `${String(opts.count ?? 0)} members` : '0 members',
        'hub.viewCommunity': 'View community',
        'hub.quick.partners.title': 'Partners',
        'hub.quick.partners.description': 'Browse connected communities',
        'hub.quick.members.title': 'Members',
        'hub.quick.members.description': 'Find federated members',
        'hub.quick.messages.title': 'Messages',
        'hub.quick.messages.description': 'Coordinate across timebanks',
        'hub.quick.listings.title': 'Listings',
        'hub.quick.listings.description': 'See shared offers and requests',
        'hub.quick.events.title': 'Events',
        'hub.quick.events.description': 'Join partner community events',
        'hub.quick.settings.title': 'Settings',
        'hub.quick.settings.description': 'Manage federation visibility',
        'relative.today': 'today',
        'relative.daysAgo': opts ? `${String(opts.count ?? 0)} days ago` : '0 days ago',
        'relative.monthsAgo': opts ? `${String(opts.count ?? 0)} months ago` : '0 months ago',
        'common:back': 'Back',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
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
    success: '#22c55e',
  }),
}));

const mockUseApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

const mockUsePaginatedApi = jest.fn();
jest.mock('@/lib/hooks/usePaginatedApi', () => ({
  usePaginatedApi: (...args: unknown[]) => mockUsePaginatedApi(...args),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('heroui-native', () => {
  const React = require('react');
  const { Text, View } = require('react-native');

  const Button = ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
    <Text onPress={onPress}>{children}</Text>
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

jest.mock('@/lib/api/federation', () => ({
  getFederationActivity: jest.fn(),
  getFederationPartners: jest.fn(),
  getFederationStats: jest.fn(),
  getFederationStatus: jest.fn(),
}));

jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/AppTopBar', () => 'View');

import FederationScreen from './federation';

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
  mockUseApi
    .mockReturnValueOnce({
      data: { data: { partner_count: 3, federated_members: 250, cross_community_exchanges: 47, messages_count: 6 } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    })
    .mockReturnValueOnce({
      data: { data: { enabled: true, partnerships_count: 3, messages_count: 6, transactions_count: 47 } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    })
    .mockReturnValueOnce({
      data: { data: [] },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

  mockUsePaginatedApi.mockReturnValue(defaultPaginatedState);
});

const mockPartner = {
  id: 1,
  name: 'Cork Timebank',
  slug: 'cork-timebank',
  description: 'A connected timebank.',
  tagline: 'Neighbourly exchange across Cork.',
  logo: null,
  location: 'Cork, Ireland',
  website: null,
  member_count: 120,
  connected_since: '2025-06-01T00:00:00Z',
  federation_level_name: 'Trusted',
};

describe('FederationScreen', () => {
  it('renders without crashing', () => {
    const { toJSON } = render(<FederationScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders the federation hub hero', () => {
    const { getByText } = render(<FederationScreen />);
    expect(getByText('Federation Hub')).toBeTruthy();
    expect(getByText('Federation active')).toBeTruthy();
  });

  it('renders the federation stats', () => {
    const { getByText } = render(<FederationScreen />);
    expect(getByText('3')).toBeTruthy();
    expect(getByText('6')).toBeTruthy();
    expect(getByText('47')).toBeTruthy();
  });

  it('renders the explore network section', () => {
    const { getAllByText, getByText } = render(<FederationScreen />);
    expect(getByText('Explore network')).toBeTruthy();
    expect(getAllByText('Partners').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('Messages').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the empty partner and activity states', () => {
    const { getByText } = render(<FederationScreen />);
    expect(getByText('No partner communities yet')).toBeTruthy();
    expect(getByText('No activity yet')).toBeTruthy();
  });

  it('renders partner cards when partners are available', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      ...defaultPaginatedState,
      items: [mockPartner],
    });

    const { getByText } = render(<FederationScreen />);
    expect(getByText('Cork Timebank')).toBeTruthy();
    expect(getByText('Cork, Ireland')).toBeTruthy();
    expect(getByText('View community')).toBeTruthy();
  });
});
