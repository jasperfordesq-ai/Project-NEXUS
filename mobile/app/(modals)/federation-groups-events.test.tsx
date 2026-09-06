// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

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
        'directory.groups.eyebrow': 'Partner groups',
        'directory.groups.title': 'Federated Groups',
        'directory.groups.subtitle': 'Discover shared community spaces from partner timebanks.',
        'directory.groups.search': 'Search groups...',
        'directory.groups.memberCount': `${String(opts?.count ?? 0)} members`,
        'directory.groups.loadMore': 'Load more groups',
        'directory.groups.backToGroups': 'Back to groups',
        'directory.groups.detailEyebrow': 'Federated group',
        'directory.groups.noDescription': 'This shared group does not have a description yet.',
        'directory.groups.privacy.public': 'Public',
        'directory.events.eyebrow': 'Partner calendar',
        'directory.events.title': 'Federated Events',
        'directory.events.subtitle': 'Discover partner workshops, socials, and online gatherings.',
        'directory.events.search': 'Search events...',
        'directory.events.upcomingOnly': 'Upcoming only',
        'directory.events.loadMore': 'Load more events',
        'directory.events.backToEvents': 'Back to events',
        'directory.events.detailEyebrow': 'Federated event',
        'directory.events.noDescription': 'This shared event does not have a description yet.',
        'directory.events.online': 'Online',
        'directory.events.organizer': 'Hosted by',
        'directory.events.organizerFallback': 'Event organizer',
        'directory.partners.eyebrow': 'Partner communities',
        'directory.partners.title': 'Federated Partners',
        'directory.partners.subtitle': 'Browse communities connected to your federation.',
        'directory.partners.search': 'Search partners...',
        'directory.memberCount': `${String(opts?.count ?? 0)} members`,
        'directory.resultsCount': `${String(opts?.count ?? 0)} results`,
        'directory.filters.allCommunities': 'All communities',
        'directory.unknownCommunity': 'Partner community',
        'directory.external': 'External',
        connectedSince: `Connected ${String(opts?.date ?? '')}`,
        'hub.viewCommunity': 'View community',
        'common:back': 'Back',
      };
      if (key === 'directory.groups.openDetails') return `Open details for ${String(opts?.name ?? '')}`;
      if (key === 'directory.events.openDetails') return `Open details for ${String(opts?.title ?? '')}`;
      if (key === 'directory.events.ends') return `Ends ${String(opts?.date ?? '')}`;
      if (key === 'directory.events.attendeeCount') return `${String(opts?.count ?? 0)} attendees`;
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
    error: '#e53e3e',
    success: '#22c55e',
  }),
}));

jest.mock('@/lib/hooks/useApi', () => ({ useApi: (...args: unknown[]) => mockUseApi(...args) }));
jest.mock('@/lib/hooks/usePaginatedApi', () => ({ usePaginatedApi: (...args: unknown[]) => mockUsePaginatedApi(...args) }));
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
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('heroui-native', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  const Button = ({ children, onPress, accessibilityLabel, isDisabled }: { children: React.ReactNode; onPress?: () => void; accessibilityLabel?: string; isDisabled?: boolean }) => (
    <Pressable accessibilityLabel={accessibilityLabel} onPress={isDisabled ? undefined : onPress}><View>{children}</View></Pressable>
  );
  Button.Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  const Card = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Card.Body = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  const Chip = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Chip.Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  return { Button, Card, Chip, Spinner: () => null, Surface: ({ children }: { children?: React.ReactNode }) => <View>{children}</View> };
});

jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/EmptyState', () => 'View');
jest.mock('@/components/ui/Input', () => 'View');
jest.mock('@/components/ui/Toggle', () => 'View');

import FederationGroupsScreen from './federation-groups';
import FederationEventsScreen from './federation-events';
import FederationPartnersScreen from './federation-partners';
import { getFederationEvents, getFederationGroups, getFederationPartners } from '@/lib/api/federation';

beforeEach(() => {
  mockSearchParams = {};
  mockUsePaginatedApi.mockClear();
  (getFederationEvents as jest.Mock).mockReset();
  (getFederationGroups as jest.Mock).mockReset();
  (getFederationPartners as jest.Mock).mockReset();
  mockUseApi.mockReturnValue({ data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() });
});

describe('Federation group and event directory actions', () => {
  it('opens a federated partner detail view from a partner card', () => {
    mockUsePaginatedApi.mockReturnValue({
      items: [{
        id: 5,
        name: 'Cork Timebank',
        location: 'Cork',
        tagline: 'Neighbourly help across the city.',
        member_count: 42,
        federation_level_name: 'Trusted partner',
        is_external: true,
      }],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { getByLabelText, getByText } = render(<FederationPartnersScreen />);
    fireEvent.press(getByLabelText('Cork Timebank'));

    expect(getByText('Federated Partners')).toBeTruthy();
    expect(getByText('Neighbourly help across the city.')).toBeTruthy();
    expect(getByText('Trusted partner')).toBeTruthy();
    expect(jest.requireMock('expo-router').router.push).toHaveBeenCalledWith({
      pathname: '/(modals)/federation-partner',
      params: { id: '5' },
    });
  });

  it('opens a federated group detail view from a group card', () => {
    mockUsePaginatedApi.mockReturnValue({
      items: [{
        id: 484,
        name: 'Neighbourhood Helpers',
        description: 'Shared support space.',
        privacy: 'public',
        member_count: 12,
        timebank: { id: 5, name: 'Cork Timebank' },
      }],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { getByLabelText, getByText } = render(<FederationGroupsScreen />);
    fireEvent.press(getByLabelText('Open details for Neighbourhood Helpers'));

    expect(getByText('Federated group')).toBeTruthy();
    expect(getByText('Back to groups')).toBeTruthy();
  });

  it('passes partner route filters to the group API fetcher', async () => {
    mockSearchParams = { partner_id: 'ext-2' };
    (getFederationGroups as jest.Mock).mockResolvedValue({ data: [], meta: { cursor: null, has_more: false } });
    mockUsePaginatedApi.mockReturnValue({
      items: [],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    render(<FederationGroupsScreen />);
    const fetchPage = mockUsePaginatedApi.mock.calls[0][0] as (cursor: string | null) => Promise<unknown>;
    await fetchPage(null);

    expect(getFederationGroups).toHaveBeenCalledWith({ per_page: '30', partner_id: 'ext-2' });
  });

  it('opens a federated event detail view from an event card', () => {
    mockUsePaginatedApi.mockReturnValue({
      items: [{
        id: 6,
        title: 'Partner meetup',
        description: 'A shared partner gathering.',
        start_date: '2026-06-01T12:00:00Z',
        end_date: '2026-06-01T14:00:00Z',
        location: 'Town Hall',
        is_online: false,
        attendees_count: 18,
        organizer: { id: 11, name: 'Pat Organizer', avatar: null },
        timebank: { id: 5, name: 'Cork Timebank' },
      }],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { getByLabelText, getByText } = render(<FederationEventsScreen />);

    expect(getByText('Pat Organizer')).toBeTruthy();
    fireEvent.press(getByLabelText('Open details for Partner meetup'));

    expect(getByText('Federated event')).toBeTruthy();
    expect(getByText('Hosted by')).toBeTruthy();
    expect(getByText('Pat Organizer')).toBeTruthy();
    expect(getByText('Back to events')).toBeTruthy();
  });

  it('passes partner route filters to the event API fetcher', async () => {
    mockSearchParams = { partner_id: '5' };
    (getFederationEvents as jest.Mock).mockResolvedValue({ data: [], meta: { cursor: null, has_more: false } });
    mockUsePaginatedApi.mockReturnValue({
      items: [],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    render(<FederationEventsScreen />);
    const fetchPage = mockUsePaginatedApi.mock.calls[0][0] as (cursor: string | null) => Promise<unknown>;
    await fetchPage(null);

    expect(getFederationEvents).toHaveBeenCalledWith({ per_page: '30', partner_id: '5', upcoming: 'true' });
  });
});
