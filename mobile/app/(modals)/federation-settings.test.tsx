// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockRefreshSettings = jest.fn();
const mockUseApi = jest.fn();
const mockUsePaginatedApi = jest.fn();
const mockOptInFederation = jest.fn().mockResolvedValue({ data: { success: true } });
const mockOptOutFederation = jest.fn().mockResolvedValue({ data: { success: true } });

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => ({}),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'directory.settings.eyebrow': 'Federation controls',
        'directory.settings.title': 'Federation Settings',
        'directory.settings.subtitle': 'Control your profile visibility.',
        'directory.settings.active': 'Federation active',
        'directory.settings.inactive': 'Federation inactive',
        'directory.settings.statusDescription': 'These controls decide what partner communities can see and use.',
        'directory.settings.enable': 'Enable federation',
        'directory.settings.disable': 'Disable federation',
        'directory.settings.statusFailedTitle': 'Federation status not updated',
        'directory.settings.statusFailedDescription': 'Please try again.',
        'directory.settings.save': 'Save settings',
        'directory.settings.reach.local_only': 'Local only',
        'directory.settings.reach.remote_ok': 'Remote ok',
        'directory.settings.reach.travel_ok': 'Can travel',
        'directory.settings.profile_visible_federated.label': 'Show my profile',
        'directory.settings.profile_visible_federated.description': 'Let partner communities see your profile.',
        'directory.settings.appear_in_federated_search.label': 'Appear in search',
        'directory.settings.appear_in_federated_search.description': 'Allow partner members to discover you.',
        'directory.settings.show_skills_federated.label': 'Share skills',
        'directory.settings.show_skills_federated.description': 'Include your skills.',
        'directory.settings.show_location_federated.label': 'Share location',
        'directory.settings.show_location_federated.description': 'Show your general location.',
        'directory.settings.show_reviews_federated.label': 'Share reviews',
        'directory.settings.show_reviews_federated.description': 'Include trust signals.',
        'directory.settings.messaging_enabled_federated.label': 'Allow federation messaging',
        'directory.settings.messaging_enabled_federated.description': 'Let partner members message you.',
        'directory.settings.transactions_enabled_federated.label': 'Allow federation exchanges',
        'directory.settings.transactions_enabled_federated.description': 'Let partner members arrange exchanges.',
        'directory.settings.email_notifications.label': 'Email notifications',
        'directory.settings.email_notifications.description': 'Receive email updates.',
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
  optInFederation: (...args: unknown[]) => mockOptInFederation(...args),
  optOutFederation: (...args: unknown[]) => mockOptOutFederation(...args),
  sendFederationMessage: jest.fn(),
  updateFederationSettings: jest.fn(),
}));
jest.mock('@/lib/haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success' },
  impactAsync: jest.fn().mockResolvedValue(undefined),
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('heroui-native', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');

  const Button = ({
    children,
    onPress,
    accessibilityLabel,
    isDisabled,
  }: {
    children: React.ReactNode;
    onPress?: () => void;
    accessibilityLabel?: string;
    isDisabled?: boolean;
  }) => (
    <Pressable accessibilityLabel={accessibilityLabel} onPress={isDisabled ? undefined : onPress}>
      <View>{children}</View>
    </Pressable>
  );
  Button.Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;

  const Card = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Card.Body = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;

  return {
    Button,
    Card,
    Chip: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    Spinner: () => null,
    Surface: ({ children }: { children?: React.ReactNode }) => <View>{children}</View>,
  };
});
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/EmptyState', () => 'View');
jest.mock('@/components/ui/Input', () => 'View');
jest.mock('@/components/ui/Toggle', () => 'View');

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

import FederationSettingsScreen from './federation-settings';

beforeEach(() => {
  jest.clearAllMocks();
  mockUseApi.mockReturnValue({
    data: {
      data: {
        enabled: true,
        settings: {
          profile_visible_federated: true,
          appear_in_federated_search: true,
          show_skills_federated: true,
          show_location_federated: false,
          show_reviews_federated: true,
          messaging_enabled_federated: true,
          transactions_enabled_federated: true,
          email_notifications: true,
          service_reach: 'local_only',
          travel_radius_km: null,
        },
      },
    },
    isLoading: false,
    error: null,
    refresh: mockRefreshSettings,
  });
  mockUsePaginatedApi.mockReturnValue({
    items: [],
    isLoading: false,
    isLoadingMore: false,
    error: null,
    hasMore: false,
    loadMore: jest.fn(),
    refresh: jest.fn(),
  });
});

describe('FederationSettingsScreen', () => {
  it('lets members disable federation from settings using the opt-out route', async () => {
    const { getByLabelText, getByText } = render(<FederationSettingsScreen />);

    expect(getByText('Federation active')).toBeTruthy();
    fireEvent.press(getByLabelText('Disable federation'));

    await waitFor(() => {
      expect(mockOptOutFederation).toHaveBeenCalled();
    });
    expect(mockRefreshSettings).toHaveBeenCalled();
    expect(getByText('Federation inactive')).toBeTruthy();
  });
});
