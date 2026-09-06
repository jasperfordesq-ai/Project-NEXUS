// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

const mockUseApi = jest.fn();
const mockRefresh = jest.fn();
const mockGetGroupExchanges = jest.fn();
const mockRouterPush = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'groupExchanges.title': 'Group Exchanges',
        'groupExchanges.eyebrow': 'Shared time exchange',
        'groupExchanges.subtitle': 'Review multi-person exchanges, hours, splits, and confirmation status.',
        'groupExchanges.create.open': 'Create group exchange',
        'groupExchanges.filters.all': 'All',
        'groupExchanges.filters.active': 'Active',
        'groupExchanges.filters.pending_confirmation': 'Needs confirmation',
        'groupExchanges.filters.completed': 'Completed',
        'groupExchanges.filters.cancelled': 'Cancelled',
        'groupExchanges.status.active': 'Active',
        'groupExchanges.status.pending_confirmation': 'Needs confirmation',
        'groupExchanges.split.weighted': 'Weighted split',
        'groupExchanges.participants': `${String(opts?.count ?? 0)} participants`,
        'groupExchanges.hours': `${String(opts?.count ?? 0)} hours`,
        'groupExchanges.unknownOrganizer': 'Community member',
        'groupExchanges.emptyTitle': 'No group exchanges found',
        'groupExchanges.emptyAll': 'Group exchanges you organise or join will appear here.',
        'groupExchanges.emptyFiltered': 'No group exchanges match this status yet.',
        'groupExchanges.errorTitle': 'Could not load group exchanges',
        'groupExchanges.errorDescription': 'Pull to refresh or try again later.',
        'common:buttons.back': 'Back',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#fff',
    surface: '#f8f9fa',
    text: '#000',
    textSecondary: '#666',
    textMuted: '#999',
    border: '#ddd',
  }),
}));

jest.mock('@/lib/api/groupExchanges', () => ({
  getGroupExchanges: (...args: unknown[]) => mockGetGroupExchanges(...args),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn() }),
  useFocusEffect: jest.fn(),
}));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/EmptyState', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return function EmptyState({ title, subtitle }: { title?: string; subtitle?: string }) {
    return <View>{title ? <Text>{title}</Text> : null}{subtitle ? <Text>{subtitle}</Text> : null}</View>;
  };
});

import GroupExchangesScreen from './group-exchanges';

const exchangeRow = {
  id: 10,
  title: 'Community garden shift',
  description: 'Three members worked together.',
  organizer_id: 1,
  organizer_name: 'Alice Smith',
  organizer_avatar: null,
  status: 'active',
  split_type: 'weighted',
  total_hours: 6,
  participant_count: 3,
  created_at: '2026-05-01T12:00:00Z',
};

/*
  🔴 This fixture used to be `{ data: { data: [row], has_more: false } }` — the client's own
  invented envelope. The server sends `{ data: [row], meta: { has_more } }`. Because the
  fixture agreed with the client, the suite proved the screen could render a row it would
  never actually be given: on a device the list was empty every time, including immediately
  after the app itself created a group exchange.
*/
beforeEach(() => {
  mockUseApi.mockReset().mockReturnValue({
    data: { data: [exchangeRow], meta: { has_more: false } },
    isLoading: false,
    error: null,
    refresh: mockRefresh,
  });
  mockGetGroupExchanges.mockReset();
  mockRouterPush.mockReset();
});

describe('GroupExchangesScreen', () => {
  it('still renders a row when the server wraps the list, so an envelope change cannot empty the screen', () => {
    mockUseApi.mockReturnValue({
      data: { data: { data: [exchangeRow], has_more: false } },
      isLoading: false,
      error: null,
      refresh: mockRefresh,
    });

    const { getByLabelText } = render(<GroupExchangesScreen />);

    expect(getByLabelText(/^Community garden shift, Active,/)).toBeTruthy();
  });

  it('shows the empty state only when the server really sent no rows', () => {
    mockUseApi.mockReturnValue({
      data: { data: [], meta: { has_more: false } },
      isLoading: false,
      error: null,
      refresh: mockRefresh,
    });

    const { getByText, queryByText } = render(<GroupExchangesScreen />);

    expect(queryByText('Community garden shift')).toBeNull();
    expect(getByText('No group exchanges found')).toBeTruthy();
  });

  it('renders backend group exchange rows with status and split metadata', () => {
    const { getByLabelText, getByText } = render(<GroupExchangesScreen />);

    expect(getByText('Group Exchanges')).toBeTruthy();
    expect(getByLabelText(
      'Community garden shift, Active, 3 participants, 6 hours, Weighted split, 1 May 2026',
    )).toBeTruthy();
  });

  it('reloads with the selected status filter', () => {
    const { getByText } = render(<GroupExchangesScreen />);

    fireEvent.press(getByText('Needs confirmation'));

    const latestCall = mockUseApi.mock.calls[mockUseApi.mock.calls.length - 1];
    expect(latestCall[1]).toEqual(['pending_confirmation', 20]);
  });

  it('opens a backend-supported detail route', () => {
    const { getByLabelText } = render(<GroupExchangesScreen />);

    fireEvent.press(getByLabelText(/^Community garden shift, Active,/));

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/(modals)/group-exchange-detail',
      params: { id: '10' },
    });
  });

  it('opens the native create group exchange flow', () => {
    const { getByText } = render(<GroupExchangesScreen />);

    fireEvent.press(getByText('Create group exchange'));

    expect(mockRouterPush).toHaveBeenCalledWith('/(modals)/new-group-exchange');
  });
});
