// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockUseApi = jest.fn();
const mockReactToAppreciation = jest.fn();

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => ({ userId: '7', name: 'Alice' }),
}));

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
  }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppTopBar', () => {
  const { Text } = require('react-native');
  return function MockAppTopBar({ title }: { title: string }) {
    return <Text>{title}</Text>;
  };
});
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => () => null);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'common:buttons.retry': 'Retry',
        'appreciations.wallTitle': 'Appreciations',
        'appreciations.wallTitleFor': opts ? `${String(opts.name)}'s appreciations` : 'Appreciations',
        'appreciations.wallSubtitle': 'Public thank-you notes and reactions from the community.',
        'appreciations.emptyTitle': 'No public appreciations yet',
        'appreciations.emptySubtitle': 'Thank-you notes will appear here when members share them publicly.',
        'appreciations.errorTitle': 'Could not load appreciations',
        'appreciations.loadMore': 'Load more',
        'appreciations.someone': 'Community member',
        'appreciations.signInTitle': 'Sign in to react',
        'appreciations.signInMessage': 'Reactions are available after you sign in.',
        'appreciations.reactionFailed': 'Could not update that reaction.',
        'appreciations.reaction.heart': 'React with heart',
        'appreciations.react.heart': 'Heart',
        'appreciations.reaction.clap': 'React with clap',
        'appreciations.react.clap': 'Clap',
        'appreciations.reaction.star': 'React with star',
        'appreciations.react.star': 'Star',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@/lib/api/appreciations', () => ({
  getUserAppreciations: jest.fn(),
  reactToAppreciation: (...args: unknown[]) => mockReactToAppreciation(...args),
}));

jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

import AppreciationsScreen from './appreciations';

describe('AppreciationsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReactToAppreciation.mockResolvedValue({ data: { reacted: true, reaction_type: 'heart' } });
    mockUseApi.mockReturnValue({
      data: {
        data: [
          {
            id: 12,
            sender_id: 3,
            receiver_id: 7,
            message: 'Thank you for helping with the garden.',
            is_public: true,
            reactions_count: 1,
            created_at: '2026-05-29T10:00:00Z',
            sender: { id: 3, name: 'Sam Lee', avatar_url: null },
            my_reaction: null,
          },
        ],
        meta: { current_page: 1, last_page: 1 },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });
  });

  it('renders public appreciations and posts reactions', async () => {
    const { findByText, getByText } = render(<AppreciationsScreen />);

    expect(await findByText('Thank you for helping with the garden.')).toBeTruthy();
    expect(getByText('Sam Lee')).toBeTruthy();

    fireEvent.press(getByText('Heart'));

    await waitFor(() => {
      expect(mockReactToAppreciation).toHaveBeenCalledWith(12, 'heart');
    });
  });
});
