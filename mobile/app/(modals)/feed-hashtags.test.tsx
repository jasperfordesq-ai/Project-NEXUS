// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetTrendingHashtags = jest.fn();
const mockSearchHashtags = jest.fn();
const mockPush = jest.fn();
const mockHasModule = jest.fn();
const mockT = (key: string, values?: Record<string, unknown>) => {
  const map: Record<string, string> = {
    'common:buttons.back': 'Back',
    'common:buttons.retry': 'Retry',
    'common:actions.clear': 'Clear search',
    'common:errors.notFound': 'Not found.',
    'feed.emptySubtitle': 'Start connecting with your community to see posts here.',
    'hashtags.title': 'Hashtags',
    'hashtags.eyebrow': 'Discovery',
    'hashtags.subtitle': 'Find active topics.',
    'hashtags.searchPlaceholder': 'Search hashtags',
    'hashtags.postCount': `${values?.count ?? 0} posts`,
    'hashtags.open': 'Open',
    'hashtags.openTag': `Open #${values?.tag ?? ''}`,
    'hashtags.loadFailed': 'Could not load hashtags.',
    'hashtags.unableToLoad': 'Could not load hashtags',
    'hashtags.emptyTitle': 'No hashtags found',
    'hashtags.emptySubtitle': 'Trending topics will appear here.',
    'hashtags.noMatch': `No hashtags match "${values?.query ?? ''}".`,
  };
  return map[key] ?? key;
};

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: jest.fn(),
    canGoBack: jest.fn(() => false),
    replace: jest.fn(),
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => ({ hasModule: mockHasModule }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#111827',
    textSecondary: '#4B5563',
    textMuted: '#6B7280',
  }),
}));

jest.mock('@/lib/api/feed', () => ({
  getTrendingHashtags: (...args: unknown[]) => mockGetTrendingHashtags(...args),
  searchHashtags: (...args: unknown[]) => mockSearchHashtags(...args),
}));

jest.mock('@/components/ui/AppTopBar', () => {
  const { Text } = require('react-native');
  return ({ title }: { title: string }) => <Text>{title}</Text>;
});

jest.mock('@/components/ui/LoadingSpinner', () => {
  const { Text } = require('react-native');
  return () => <Text>Loading</Text>;
});

jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);

import FeedHashtagsScreen from './feed-hashtags';

describe('FeedHashtagsScreen', () => {
  beforeEach(() => {
    jest.useRealTimers();
    mockGetTrendingHashtags.mockReset();
    mockSearchHashtags.mockReset();
    mockPush.mockReset();
    mockHasModule.mockReset().mockReturnValue(true);
  });

  it('renders trending hashtags and routes to hashtag detail', async () => {
    mockGetTrendingHashtags.mockResolvedValue({
      data: [{ tag: 'gardening', post_count: 3, trend_direction: 'up' }],
    });

    const { getByText } = render(<FeedHashtagsScreen />);

    await waitFor(() => expect(mockGetTrendingHashtags).toHaveBeenCalledWith(50));
    expect(getByText('#gardening')).toBeTruthy();
    expect(getByText('3 posts')).toBeTruthy();

    fireEvent.press(getByText('Open'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(modals)/feed-hashtag',
      params: { tag: 'gardening' },
    });
  });

  it('does not load hashtags when feed is disabled', async () => {
    mockHasModule.mockReturnValue(false);

    const { getByText } = render(<FeedHashtagsScreen />);

    await waitFor(() => expect(mockGetTrendingHashtags).not.toHaveBeenCalled());
    expect(getByText('Not found.')).toBeTruthy();
  });
});
