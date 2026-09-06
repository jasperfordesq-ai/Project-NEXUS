// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// --- Mocks ---

const mockRouterPush = jest.fn();

jest.mock('expo-router', () => {
  return {
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    useSegments: () => ['(tabs)'],
    router: { push: (...args: unknown[]) => mockRouterPush(...args), replace: jest.fn(), back: jest.fn() },
    useLocalSearchParams: () => ({}),
    useNavigation: () => ({ setOptions: jest.fn() }),
    useFocusEffect: jest.fn(),
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'title': 'Groups',
        'subtitle': 'Find community spaces, join discussions, and collaborate with members.',
        'heroEyebrow': 'Community spaces',
        'empty': 'No groups found.',
        'searchPlaceholder': 'Search groups…',
        'newGroup': 'New Group',
        'filter.all': 'All',
        'filter.public': 'Public',
        'filter.private': 'Private',
        'featured': 'Featured',
        'joined': 'Joined',
        'stats.groups': 'Groups',
        'stats.featured': 'Featured',
        'stats.members': 'Members',
        'stats.joined': 'Joined',
        'members': opts ? `${String(opts.count ?? 0)} members` : '0 members',
        'posts': opts ? `${String(opts.count ?? 0)} posts` : '0 posts',
        'public': 'Public',
        'private': 'Private',
        'common:back': 'Back',
        'common:buttons.retry': 'Retry',
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
    errorBg: '#fff5f5',
    success: '#22c55e',
    successBg: '#f0fdf4',
  }),
}));

const mockUsePaginatedApi = jest.fn();
jest.mock('@/lib/hooks/usePaginatedApi', () => ({
  usePaginatedApi: (...args: unknown[]) => mockUsePaginatedApi(...args),
}));

jest.mock('@/lib/hooks/useDebounce', () => ({
  useDebounce: (value: string) => value,
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/lib/api/groups', () => ({
  getGroups: jest.fn(),
}));

jest.mock('@/components/OfflineBanner', () => () => null);
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/Skeleton', () => ({
  SkeletonBox: () => null,
  ExchangeCardSkeleton: () => null,
  ProfileSkeleton: () => null,
}));

// --- Tests ---

import GroupsScreen from './groups';

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
  mockRouterPush.mockReset();
  mockUsePaginatedApi.mockReturnValue(defaultPaginatedState);
});

const mockGroup = {
  id: 1,
  name: 'Garden Club',
  description: 'We love gardening.',
  visibility: 'public' as const,
  member_count: 12,
  is_featured: false,
  is_member: false,
};

describe('GroupsScreen', () => {
  it('renders the screen title', () => {
    const { getAllByText } = render(<GroupsScreen />);
    expect(getAllByText('Groups').length).toBeGreaterThan(0);
  });

  it('renders empty state when no items and not loading', () => {
    const { getByText } = render(<GroupsScreen />);
    expect(getByText('No groups found.')).toBeTruthy();
  });

  it('renders group cards when items are provided', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [mockGroup],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { getByText } = render(<GroupsScreen />);
    expect(getByText('Garden Club')).toBeTruthy();
  });

  it('opens group details from HeroUI Native-backed group cards', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [mockGroup],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { getByText } = render(<GroupsScreen />);
    fireEvent.press(getByText('Garden Club'));

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/(modals)/group-detail',
      params: { id: '1' },
    });
  });

  it('renders filter pills for All, Public, and Private', () => {
    const { getByText } = render(<GroupsScreen />);
    expect(getByText('All')).toBeTruthy();
    expect(getByText('Public')).toBeTruthy();
    expect(getByText('Private')).toBeTruthy();
  });

  it('renders search input', () => {
    const { getByPlaceholderText, getByTestId } = render(<GroupsScreen />);
    expect(getByPlaceholderText('Search groups…')).toBeTruthy();
    expect(getByTestId('groups-search')).toBeTruthy();
  });

  it('renders skeletons in empty slot when loading', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [],
      isLoading: true,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    // Should not render empty text when loading
    const { queryByText } = render(<GroupsScreen />);
    expect(queryByText('No groups found.')).toBeNull();
  });
});
