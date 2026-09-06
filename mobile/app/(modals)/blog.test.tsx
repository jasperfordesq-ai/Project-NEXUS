// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

// --- Mocks ---

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ setOptions: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'title': 'Blog',
        'heroEyebrow': 'Community journal',
        'subtitle': 'Stories, guides, and updates from the timebank community.',
        'searchPlaceholder': 'Search articles...',
        'searchAction': 'Search',
        'clearSearch': 'Clear search',
        'empty': 'No posts yet.',
        'emptyHint': 'Community stories and updates will appear here.',
        'emptyFiltered': 'No matching articles',
        'emptyFilteredHint': 'Try a different search.',
        'loadMore': 'Load more',
        'postsCount': opts ? `${String(opts.count ?? 0)} posts` : '0 posts',
        'publishedOn': opts ? String(opts.date ?? '') : '',
        'readingTime': opts ? `${String(opts.minutes ?? 0)} min read` : '0 min read',
        'by': opts ? `By ${String(opts.name ?? '')}` : 'By',
        'common:buttons.retry': 'Retry',
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
    borderSubtle: '#eeeeee',
    error: '#e53e3e',
    info: '#3b82f6',
  }),
}));

const mockUsePaginatedApi = jest.fn();
jest.mock('@/lib/hooks/usePaginatedApi', () => ({
  usePaginatedApi: (...args: unknown[]) => mockUsePaginatedApi(...args),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

// Mock react-native Image to avoid URI issues in tests
jest.mock('react-native/Libraries/Image/Image', () => 'View');

jest.mock('@/lib/api/blog', () => ({
  getBlogPosts: jest.fn(),
}));

// --- Tests ---

import BlogScreen from './blog';

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

const mockBlogPost = {
  id: 7,
  title: 'Getting Started with Timebanking',
  excerpt: 'Learn how to exchange time credits in your community.',
  featured_image: null,
  category: { id: 2, name: 'Guide', color: 'blue' },
  reading_time: 5,
  published_at: '2026-01-10T09:00:00Z',
};

describe('BlogScreen', () => {
  it('renders the blog list without crashing', () => {
    const { toJSON } = render(<BlogScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders empty state when no posts and not loading', () => {
    const { getByText } = render(<BlogScreen />);
    expect(getByText('No posts yet.')).toBeTruthy();
  });

  it('renders the shared input-backed search field', () => {
    const { getByPlaceholderText, getByLabelText } = render(<BlogScreen />);
    fireEvent.changeText(getByPlaceholderText('Search articles...'), 'repair');
    expect(getByLabelText('Clear search')).toBeTruthy();
  });

  it('does not render empty state while loading', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [],
      isLoading: true,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { queryByText } = render(<BlogScreen />);
    expect(queryByText('No posts yet.')).toBeNull();
  });

  it('renders blog post title when items are provided', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [mockBlogPost],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { getByText } = render(<BlogScreen />);
    expect(getByText('Getting Started with Timebanking')).toBeTruthy();
  });

  it('renders the API category name', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [mockBlogPost],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { getByText } = render(<BlogScreen />);
    expect(getByText('Guide')).toBeTruthy();
  });

  it('renders reading time when provided', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [mockBlogPost],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { getByText } = render(<BlogScreen />);
    expect(getByText('5 min read')).toBeTruthy();
  });
});
