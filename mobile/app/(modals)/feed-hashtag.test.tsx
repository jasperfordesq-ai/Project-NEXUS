// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const mockGetHashtagFeed = jest.fn();
const mockUseLocalSearchParams = jest.fn();
const mockHasModule = jest.fn();
const mockT = (key: string, values?: Record<string, unknown>) => {
  const map: Record<string, string> = {
    'common:buttons.back': 'Back',
    'common:buttons.retry': 'Retry',
    'common:buttons.loadMore': 'Load more',
    'common:errors.notFound': 'Not found.',
    'common:endOfList': "You've reached the end",
    'feed.emptySubtitle': 'Start connecting with your community to see posts here.',
    'hashtag.title': 'Hashtag',
    'hashtag.subtitle': 'Tagged feed posts',
    'hashtag.postCount': `${values?.count ?? 0} posts`,
    'hashtag.loadFailed': 'Could not load posts for this hashtag.',
    'hashtag.unableToLoad': 'Could not load this hashtag',
    'hashtag.emptyTitle': 'No posts yet',
    'hashtag.emptySubtitle': `No feed posts are tagged #${values?.tag ?? ''} yet.`,
  };
  return map[key] ?? key;
};

jest.mock('@/components/reactions/ReactorsSheet', () => 'View');
jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { back: jest.fn(), canGoBack: jest.fn(() => false), replace: jest.fn() },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
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
  }),
}));

jest.mock('@/lib/api/feed', () => ({
  getHashtagFeed: (...args: unknown[]) => mockGetHashtagFeed(...args),
  // Real behaviour, not a stub: the hashtag feed must actually drop gamification
  // milestones, and a pass-through mock would hide a regression.
  excludeGamificationMilestones: <T extends { type: string }>(items: T[]) =>
    items.filter((item) => item.type !== 'badge_earned' && item.type !== 'level_up'),
}));

jest.mock('@/components/FeedItem', () => {
  const { Text } = require('react-native');
  return ({ item }: { item: { title: string } }) => <Text>{item.title}</Text>;
});

jest.mock('@/components/ui/AppTopBar', () => {
  const { Text } = require('react-native');
  return ({ title }: { title: string }) => <Text>{title}</Text>;
});

jest.mock('@/components/ui/LoadingSpinner', () => {
  const { Text } = require('react-native');
  return () => <Text>Loading</Text>;
});

jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);

import FeedHashtagScreen from './feed-hashtag';

describe('FeedHashtagScreen', () => {
  beforeEach(() => {
    mockGetHashtagFeed.mockReset();
    mockUseLocalSearchParams.mockReset().mockReturnValue({ tag: 'gardening' });
    mockHasModule.mockReset().mockReturnValue(true);
  });

  it('loads and renders tagged feed posts', async () => {
    mockGetHashtagFeed.mockResolvedValue({
      data: [
        {
          id: 7,
          type: 'post',
          title: 'Seed swap',
          content: 'Bring spare seeds.',
          image_url: null,
          likes_count: 0,
          comments_count: 0,
          created_at: '2026-05-29T09:00:00Z',
          location: null,
          rating: null,
          start_date: null,
          job_type: null,
          commitment: null,
          submission_deadline: null,
          receiver: null,
        },
      ],
      meta: { has_more: false, cursor: null, total_items: 1 },
    });

    const { getAllByText, getByText } = render(<FeedHashtagScreen />);

    await waitFor(() => expect(mockGetHashtagFeed).toHaveBeenCalledWith('gardening', null));
    expect(getAllByText('#gardening').length).toBeGreaterThan(0);
    expect(getByText('1 posts')).toBeTruthy();
    expect(getByText('Seed swap')).toBeTruthy();
  });

  it('falls back when the feed module is unavailable', async () => {
    mockHasModule.mockReturnValue(false);

    const { getByText } = render(<FeedHashtagScreen />);

    await waitFor(() => expect(mockGetHashtagFeed).not.toHaveBeenCalled());
    expect(getByText('Not found.')).toBeTruthy();
  });
});
