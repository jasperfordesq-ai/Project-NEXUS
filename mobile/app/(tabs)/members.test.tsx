// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render } from '@testing-library/react-native';

// --- Mocks ---

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'title': 'Members',
        'search.placeholder': 'Search members...',
        'empty.title': 'No members found',
        'empty.subtitle': 'Members will appear here once they join.',
        'common:buttons.retry': 'Retry',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
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
    borderSubtle: '#eeeeee',
    error: '#e53e3e',
  }),
}));

jest.mock('@/lib/hooks/useDebounce', () => ({
  useDebounce: (value: string) => value,
}));

const mockUsePaginatedApi = jest.fn();
jest.mock('@/lib/hooks/usePaginatedApi', () => ({
  usePaginatedApi: (...args: unknown[]) => mockUsePaginatedApi(...args),
}));

jest.mock('@/lib/api/members', () => ({
  getMembers: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/MemberCard', () => {
  const { Text } = require('react-native');
  return function MockMemberCard(props: { member: { name: string } }) {
    return <Text>{props.member.name}</Text>;
  };
});
jest.mock('@/components/ui/LoadingSpinner', () => () => null);

// --- Tests ---

import MembersScreen from './members';

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
  mockUsePaginatedApi.mockReturnValue(defaultPaginatedState);
});

describe('MembersScreen (tab)', () => {
  it('renders without crashing', () => {
    const { toJSON } = render(<MembersScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders the title and search input', () => {
    const { getAllByText, getByPlaceholderText, getByTestId } = render(<MembersScreen />);
    expect(getAllByText('Members').length).toBeGreaterThan(0);
    expect(getByPlaceholderText('Search members...')).toBeTruthy();
    expect(getByTestId('members-search')).toBeTruthy();
  });

  it('renders empty state when no members and not loading', () => {
    const { getByText } = render(<MembersScreen />);
    expect(getByText('No members found')).toBeTruthy();
  });

  it('renders member cards when items are provided', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...defaultPaginatedState,
      items: [
        { id: 1, name: 'Alice Green', avatar_url: null },
        { id: 2, name: 'Bob Smith', avatar_url: null },
      ],
    });

    const { getByText } = render(<MembersScreen />);
    expect(getByText('Alice Green')).toBeTruthy();
    expect(getByText('Bob Smith')).toBeTruthy();
  });

  it('does not render empty state when loading', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...defaultPaginatedState,
      isLoading: true,
    });

    const { queryByText } = render(<MembersScreen />);
    expect(queryByText('No members found')).toBeNull();
  });

  it('renders error state with retry', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...defaultPaginatedState,
      error: 'Network error',
    });

    const { getByText } = render(<MembersScreen />);
    expect(getByText('Network error')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
  });
});
