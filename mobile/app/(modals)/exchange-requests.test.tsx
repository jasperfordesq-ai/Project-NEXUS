// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

const mockUseApi = jest.fn();
const mockRefresh = jest.fn();
const mockRouterPush = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'requests.title': 'Exchanges',
        'requests.back': 'Back',
        'requests.sectionWaiting': 'Waiting on you',
        'requests.sectionOther': 'Everything else',
        'requests.roleProvider': 'You are helping',
        'requests.roleRequester': 'You asked for help',
        'requests.status.pending_provider': 'Awaiting acceptance',
        'requests.status.completed': 'Completed',
        'requests.emptyTitle': 'No exchanges yet',
        'requests.untitledListing': 'Untitled listing',
      };
      if (key === 'requests.withMember') return `With ${String(opts?.name ?? '')}`;
      if (key === 'requests.hoursValue') return `${String(opts?.count ?? 0)} hours`;
      if (key === 'requests.openLabel') return `Open ${String(opts?.title ?? '')}`;
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 674 } }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ bg: '#fff', surface: '#f8f9fa', text: '#000', border: '#ddd' }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
  // Runs the effect once on mount, which is what focus does on a freshly opened screen.
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), [cb]);
  },
}));
jest.mock('@/components/ui/AppTopBar', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return function AppTopBar({ title }: { title?: string }) {
    return <Text>{title}</Text>;
  };
});
jest.mock('@/components/ui/EmptyState', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return function EmptyState({ title }: { title?: string }) {
    return <View>{title ? <Text>{title}</Text> : null}</View>;
  };
});
jest.mock('@/components/ui/ErrorState', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return function ErrorState({ title }: { title?: string }) {
    return <View>{title ? <Text>{title}</Text> : null}</View>;
  };
});
jest.mock('@/components/ui/LoadingSpinner', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => {
  const React = require('react');
  return function ModalErrorBoundary({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  };
});

import ExchangeRequestsScreen from './exchange-requests';

const AS_PROVIDER = {
  id: 61,
  listing_id: 513,
  requester_id: 675,
  provider_id: 674,
  listing: { id: 513, title: 'Gardening help', type: 'offer' },
  requester: { id: 675, name: 'E2E UserB', avatar: null },
  provider: { id: 674, name: 'E2E UserA', avatar: null },
  proposed_hours: 1,
  prep_time: null,
  final_hours: null,
  status: 'pending_provider',
  risk_level: null,
  message: null,
  requester_confirmed_at: null,
  requester_confirmed_hours: null,
  provider_confirmed_at: null,
  provider_confirmed_hours: null,
  broker_notes: null,
  created_at: '2026-08-21 20:21:12',
};

const FINISHED = { ...AS_PROVIDER, id: 62, status: 'completed', final_hours: 2 };

beforeEach(() => {
  mockUseApi.mockReset().mockReturnValue({
    data: { data: [AS_PROVIDER, FINISHED] },
    isLoading: false,
    error: null,
    refresh: mockRefresh,
  });
  mockRouterPush.mockReset();
});

describe('ExchangeRequestsScreen', () => {
  it('separates the exchanges waiting on this member from the rest', () => {
    const { getByText } = render(<ExchangeRequestsScreen />);

    // 🔴 The whole point of the screen. A request the provider has not accepted is the
    // member's move; a completed one is not, and mixing them is how an exchange sat in
    // `pending_provider` unnoticed.
    expect(getByText('Waiting on you')).toBeTruthy();
    expect(getByText('Everything else')).toBeTruthy();
    expect(getByText('Awaiting acceptance')).toBeTruthy();
    expect(getByText('Completed')).toBeTruthy();
  });

  it('names the counterparty and the role, not just the listing', () => {
    const { getAllByText } = render(<ExchangeRequestsScreen />);

    expect(getAllByText('With E2E UserB').length).toBe(2);
    expect(getAllByText('You are helping').length).toBe(2);
  });

  it('opens the exchange detail screen — NOT the listing detail screen', () => {
    const { getByTestId } = render(<ExchangeRequestsScreen />);

    fireEvent.press(getByTestId('exchange-request-61'));

    // 🔴 `exchange-detail` is the LISTING screen. Sending exchange id 61 there is the
    // defect that showed the provider "Listing not found".
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/(modals)/exchange-request-detail',
      params: { id: '61' },
    });
  });

  it('shows the empty state rather than bare sections when there is nothing', () => {
    mockUseApi.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      error: null,
      refresh: mockRefresh,
    });

    const { getByText, queryByText } = render(<ExchangeRequestsScreen />);

    expect(getByText('No exchanges yet')).toBeTruthy();
    expect(queryByText('Waiting on you')).toBeNull();
  });

  it('survives a response whose data is not an array', () => {
    // The envelope has changed shape before on this platform; a screen that throws here
    // takes the whole modal down instead of showing an empty list.
    mockUseApi.mockReturnValue({
      data: { data: null },
      isLoading: false,
      error: null,
      refresh: mockRefresh,
    });

    const { getByText } = render(<ExchangeRequestsScreen />);
    expect(getByText('No exchanges yet')).toBeTruthy();
  });
});
