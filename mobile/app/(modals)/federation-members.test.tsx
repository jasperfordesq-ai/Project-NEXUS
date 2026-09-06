// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

const mockUseApi = jest.fn();
const mockUsePaginatedApi = jest.fn();

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => ({}),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'directory.members.eyebrow': 'Federated directory',
        'directory.members.title': 'Federated Members',
        'directory.members.subtitle': 'Find members from partner communities.',
        'directory.members.search': 'Search members...',
        'directory.members.skillsSearch': 'Filter by skills...',
        'directory.members.memberFallback': 'Member',
        'directory.members.viewProfile': 'View profile',
        'directory.members.message': 'Message',
        'directory.members.reach.all': 'All reach',
        'directory.members.reach.local_only': 'Local only',
        'directory.members.reach.remote_ok': 'Remote ok',
        'directory.members.reach.travel_ok': 'Can travel',
        'directory.resultsCount': `${String(opts?.count ?? 0)} results`,
        'directory.filters.allCommunities': 'All communities',
        'directory.unknownCommunity': 'Partner community',
        'directory.external': 'External',
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

import FederationMembersScreen from './federation-members';

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
  mockUseApi.mockReturnValue({ data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() });
  mockUsePaginatedApi.mockReturnValue({
    ...defaultPaginatedState,
    items: [{
      id: 272,
      name: 'Katherine Murphy',
      bio: 'Happy to share repair skills.',
      avatar: null,
      skills: ['Repairs'],
      tenant_id: 5,
      tenant_name: 'Cork Timebank',
      timebank: { id: 5, name: 'Cork Timebank' },
    }],
  });
});

describe('FederationMembersScreen', () => {
  it('routes federated member profile actions through the federation member modal', () => {
    const { router } = require('expo-router');
    const { getByText } = render(<FederationMembersScreen />);

    expect(getByText('Katherine Murphy')).toBeTruthy();
    fireEvent.press(getByText('View profile'));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(modals)/federation-member',
      params: { id: '272', tenant_id: '5' },
    });
  });

  it('routes external member profile and message actions with the external partner tenant id', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      ...defaultPaginatedState,
      items: [{
        id: 'ext-7-123',
        name: 'External Sam',
        bio: 'Shared by an external partner.',
        avatar: null,
        skills: ['Translation'],
        tenant_id: 99,
        tenant_name: 'Remote partner',
        timebank: { id: 99, name: 'Remote partner' },
        is_external: true,
      }],
    });
    const { router } = require('expo-router');
    const { getByText } = render(<FederationMembersScreen />);

    fireEvent.press(getByText('View profile'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(modals)/federation-member',
      params: { id: 'ext-7-123', tenant_id: 'ext-7', name: 'External Sam' },
    });

    router.push.mockClear();
    fireEvent.press(getByText('Message'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(modals)/federation-messages',
      params: { compose: 'true', to_user: 'ext-7-123', to_tenant: 'ext-7', name: 'External Sam', community: 'Remote partner' },
    });
  });
});
