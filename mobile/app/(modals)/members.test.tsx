// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render } from '@testing-library/react-native';

// --- Mocks ---

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  router: { push: jest.fn() },
  useNavigation: () => ({ setOptions: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'title': 'Members',
        'search.placeholder': 'Search members...',
        'empty.title': 'No members yet',
        'empty.noResults': opts ? `No results for "${String(opts.query ?? '')}"` : 'No results',
        'memberCard.accessibilityLabel': opts ? `View ${String(opts.name ?? '')} profile` : 'View profile',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
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

const mockUsePaginatedApi = jest.fn();
jest.mock('@/lib/hooks/usePaginatedApi', () => ({
  usePaginatedApi: (...args: unknown[]) => mockUsePaginatedApi(...args),
}));

jest.mock('@/lib/api/members', () => ({
  getMembers: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/Skeleton', () => ({
  SkeletonBox: 'View',
}));

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

const mockMembers = [
  { id: 1, name: 'Alice Green', tagline: 'Community gardener', avatar_url: null, skills: [], credits_balance: 5 },
  { id: 2, name: 'Bob Smith', tagline: null, avatar_url: null, skills: [], credits_balance: 3 },
];

beforeEach(() => {
  mockUsePaginatedApi.mockReturnValue(defaultPaginatedState);
});

describe('MembersScreen (modal)', () => {
  it('renders without crashing', () => {
    const { toJSON } = render(<MembersScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders the search input', () => {
    const { getByPlaceholderText } = render(<MembersScreen />);
    expect(getByPlaceholderText('Search members...')).toBeTruthy();
  });

  it('renders empty state when no members and not loading', () => {
    const { getByText } = render(<MembersScreen />);
    expect(getByText('No members yet')).toBeTruthy();
  });

  it('renders member names when items are provided', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...defaultPaginatedState,
      items: mockMembers,
    });

    const { getByText } = render(<MembersScreen />);
    expect(getByText('Alice Green')).toBeTruthy();
    expect(getByText('Bob Smith')).toBeTruthy();
  });

  it('renders member taglines when present', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...defaultPaginatedState,
      items: mockMembers,
    });

    const { getByText } = render(<MembersScreen />);
    expect(getByText('Community gardener')).toBeTruthy();
  });

  it('does not render empty state when loading', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...defaultPaginatedState,
      isLoading: true,
    });

    const { queryByText } = render(<MembersScreen />);
    expect(queryByText('No members yet')).toBeNull();
  });
});
