// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * How the federated directory reacts to being refused, and how often it searches.
 *
 * 🔴 The tests that matter here are the ones written in German. Until 2026-09-08
 * this screen decided "is this a refusal?" by running an English regular
 * expression over the server's message. English members saw an explanation;
 * German, Irish, Spanish, French, Italian and Portuguese members saw a generic
 * error with a Try again button that could never work, because pressing it
 * re-asks a question that was refused for a reason no retry can change. Asserting
 * only in English is what let that ship — so every refusal case below is asserted
 * against a message with no English in it at all.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

const mockUseApi = jest.fn();
const mockUsePaginatedApi = jest.fn();

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => ({}),
}));

// `t` returns the key. Every assertion below is then about WHICH card was chosen,
// never about the wording, so these tests cannot themselves become English-only.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'de' },
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
  markFederationMessagesReadBatch: jest.fn(),
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
jest.mock('@/components/ui/Toggle', () => 'View');
jest.mock('@/components/ui/Input', () => {
  const React = require('react');
  const { TextInput } = require('react-native');
  return ({ value, onChangeText, placeholder }: { value?: string; onChangeText?: (t: string) => void; placeholder?: string }) => (
    <TextInput testID={`input-${placeholder ?? 'field'}`} value={value} onChangeText={onChangeText} placeholder={placeholder} />
  );
});

import FederationDirectoryScreen from './FederationDirectoryScreen';

const emptyPage = {
  items: [],
  isLoading: false,
  isLoadingMore: false,
  error: null,
  errorStatus: null,
  errorCode: null,
  hasMore: false,
  loadMore: jest.fn(),
  refresh: jest.fn(),
};

/** A refusal exactly as a German member receives it — no English anywhere in it. */
const GERMAN_FEATURE_DISABLED = 'Die Verbundfunktion ist für diesen Mandanten deaktiviert';
const GERMAN_OPT_IN_REQUIRED = 'Sie müssen sich zunächst für die Föderation anmelden.';

beforeEach(() => {
  jest.clearAllMocks();
  mockUseApi.mockReturnValue({
    data: { data: [] },
    isLoading: false,
    error: null,
    errorStatus: null,
    errorCode: null,
    refresh: jest.fn(),
  });
  mockUsePaginatedApi.mockReturnValue(emptyPage);
});

describe('FederationDirectoryScreen — refusals are recognised in every language', () => {
  it('explains a switched-off feature to a German member instead of offering Retry', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...emptyPage,
      error: GERMAN_FEATURE_DISABLED,
      errorStatus: 403,
      errorCode: 'FORBIDDEN',
    });

    const { getByText, queryByText } = render(<FederationDirectoryScreen mode="members" />);

    expect(getByText('directory.members.unavailableTitle')).toBeTruthy();
    // The dead button, and the raw server sentence it sat under, must both be gone.
    expect(queryByText('directory.tryAgain')).toBeNull();
    expect(queryByText(GERMAN_FEATURE_DISABLED)).toBeNull();
  });

  it('tells a German member who has not joined how to join, rather than claiming it is off', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...emptyPage,
      error: GERMAN_OPT_IN_REQUIRED,
      errorStatus: 403,
      errorCode: 'FEDERATION_NOT_ENABLED',
    });

    const { getByText, queryByText } = render(<FederationDirectoryScreen mode="members" />);

    expect(getByText('directory.optIn.title')).toBeTruthy();
    // Not the same card: saying the feature is unavailable would be untrue here.
    expect(queryByText('directory.members.unavailableTitle')).toBeNull();
    expect(queryByText('directory.tryAgain')).toBeNull();
  });

  it('opens the federation setup wizard from the opt-in card', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...emptyPage,
      error: GERMAN_OPT_IN_REQUIRED,
      errorStatus: 403,
      errorCode: 'FEDERATION_NOT_ENABLED',
    });
    const { router } = require('expo-router');
    const { getByText } = render(<FederationDirectoryScreen mode="members" />);

    fireEvent.press(getByText('directory.optIn.action'));

    expect(router.push).toHaveBeenCalledWith('/(modals)/federation-onboarding');
  });

  it('treats a 403 with no machine code as a refusal, not something to retry', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...emptyPage,
      error: 'Zugriff verweigert',
      errorStatus: 403,
      errorCode: null,
    });

    const { getByText, queryByText } = render(<FederationDirectoryScreen mode="members" />);

    expect(getByText('directory.members.unavailableTitle')).toBeTruthy();
    expect(queryByText('directory.tryAgain')).toBeNull();
  });

  it('still recognises a refusal from a server old enough to send no code at all', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...emptyPage,
      error: 'Federation feature disabled for this tenant',
      errorStatus: null,
      errorCode: null,
    });

    const { getByText } = render(<FederationDirectoryScreen mode="members" />);

    expect(getByText('directory.members.unavailableTitle')).toBeTruthy();
  });

  it('keeps Retry for a failure that retrying can actually fix', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...emptyPage,
      error: 'Zeitüberschreitung der Anforderung',
      errorStatus: null,
      errorCode: null,
    });

    const { getByText, queryByText } = render(<FederationDirectoryScreen mode="members" />);

    expect(getByText('directory.tryAgain')).toBeTruthy();
    expect(queryByText('directory.members.unavailableTitle')).toBeNull();
    expect(queryByText('directory.optIn.title')).toBeNull();
  });

  it('recognises a messages-mode refusal, which comes from the other hook', () => {
    mockUseApi.mockReturnValue({
      data: null,
      isLoading: false,
      error: 'Der Nachrichtenaustausch ist deaktiviert',
      errorStatus: 403,
      errorCode: 'MESSAGING_DISABLED',
      refresh: jest.fn(),
    });

    const { getByText, queryByText } = render(<FederationDirectoryScreen mode="messages" />);

    expect(getByText('directory.messages.unavailableTitle')).toBeTruthy();
    expect(queryByText('directory.tryAgain')).toBeNull();
  });
});

describe('FederationDirectoryScreen — the search does not fire per keystroke', () => {
  /** The dependency string the hook is re-run on. Changing it means a new request. */
  function currentQueryDeps() {
    const calls = mockUsePaginatedApi.mock.calls;
    return (calls[calls.length - 1]?.[2] as unknown[])?.[1] as string;
  }

  it('waits for typing to stop before changing what it asks the server for', () => {
    jest.useFakeTimers();
    try {
      const { getByTestId } = render(<FederationDirectoryScreen mode="members" />);
      const before = currentQueryDeps();

      const input = getByTestId('input-directory.members.search');
      act(() => { fireEvent.changeText(input, 'g'); });
      act(() => { fireEvent.changeText(input, 'ga'); });
      act(() => { fireEvent.changeText(input, 'gar'); });

      // Three keystrokes, no new query yet.
      expect(currentQueryDeps()).toBe(before);

      act(() => { jest.advanceTimersByTime(400); });

      const after = currentQueryDeps();
      expect(after).not.toBe(before);
      expect(after).toContain('gar');
      // …and only the settled word, never the two prefixes.
      expect(after).not.toContain('"ga"');
    } finally {
      jest.useRealTimers();
    }
  });
});
