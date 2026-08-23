// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// --- Mocks ---

jest.mock('@/components/reactions/ReactorsSheet', () => 'View');
const mockRouterPush = jest.fn();
const mockHasModule = jest.fn(() => true);

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useSegments: () => ['(tabs)'],
  router: { push: (...args: unknown[]) => mockRouterPush(...args), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ setOptions: jest.fn() }),
  // The feed re-reads on focus only when a writer marked it stale, so the effect runs
  // its callback once here — the same as arriving on the screen.
  useFocusEffect: (callback: () => void) => callback(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'feed.greeting': opts ? `Hello, ${String(opts.name ?? '')}` : 'Hello, Friend',
        'feed.subtitle': "Here's what's happening in your timebank",
        'feed.emptyTitle': 'No activity yet. Say hello to your community!',
        'notifications.title': 'Notifications',
        'dashboard.balance': 'Balance',
        'dashboard.hours': `${String(opts?.count ?? 0)} hours`,
        'dashboard.upcomingEvents': 'Upcoming events',
        'dashboard.openRequests': 'Open requests',
        'dashboard.notifications': 'Notifications',
        'dashboard.unavailable': '-',
        'dashboard.openCard': `Open ${String(opts?.label ?? '')}`,
        'newPost.title': 'Create post',
        'newPost.placeholder': "What's on your mind?",
        'common:labels.friend': 'Friend',
        'common:buttons.retry': 'Retry',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 1, email: 'alice@example.com', name: 'Alice Smith' },
    displayName: 'Alice Smith',
    logout: jest.fn(),
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => ({ hasFeature: () => true, hasModule: () => mockHasModule() }),
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
  }),
}));

const mockUsePaginatedApi = jest.fn();
jest.mock('@/lib/hooks/usePaginatedApi', () => ({
  usePaginatedApi: (...args: unknown[]) => mockUsePaginatedApi(...args),
}));

const mockRealtimeContext = {
  unreadMessages: 0,
  unreadNotifications: 0,
  resetUnread: jest.fn(),
  refreshCounts: jest.fn(),
  subscribeToMessages: jest.fn(() => jest.fn()),
};
jest.mock('@/lib/context/RealtimeContext', () => ({
  useRealtimeContext: () => mockRealtimeContext,
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/lib/api/feed', () => ({
  getFeed: jest.fn(),
  getFeedAuthor: (item: { user_id?: number; author_name?: string | null; author_avatar?: string | null; author?: { id: number; name: string; avatar_url?: string | null }; user?: { id: number; name: string; avatar_url?: string | null; avatar?: string | null } }, fallbackName: string) => ({
    id: item.user_id ?? item.author?.id ?? item.user?.id ?? 0,
    name: item.author_name ?? item.author?.name ?? item.user?.name ?? fallbackName,
    avatar: item.author_avatar ?? item.author?.avatar_url ?? item.user?.avatar_url ?? item.user?.avatar ?? null,
  }),
}));

jest.mock('@/lib/api/wallet', () => ({
  getWalletBalance: jest.fn(() => Promise.resolve({ data: { balance: 12 } })),
}));

jest.mock('@/lib/api/events', () => ({
  getEvents: jest.fn(() => Promise.resolve({ data: [{ id: 1 }, { id: 2 }], meta: { per_page: 5, has_more: false, cursor: null } })),
}));

jest.mock('@/lib/api/exchanges', () => ({
  getExchanges: jest.fn(() => Promise.resolve({ data: [{ id: 1 }, { id: 2 }, { id: 3 }], meta: { per_page: 5, has_more: false, cursor: null } })),
}));

jest.mock('@/components/FeedItem', () => {
  const MockFeedItem = ({
    item,
    commentsCountOverride,
    onOpenComments,
  }: {
    item: { id: number; type?: string; content?: string; comments_count?: number };
    commentsCountOverride?: number;
    onOpenComments?: (target: { targetType: string; targetId: number; initialCount: number }) => void;
  }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <>
        <Text>{item.content ?? `feed-item-${item.id}`}</Text>
        {commentsCountOverride != null ? <Text>{`override-count-${commentsCountOverride}`}</Text> : null}
        <Pressable
          accessibilityLabel={`open-comments-${item.id}`}
          onPress={() => onOpenComments?.({
            targetType: item.type ?? 'post',
            targetId: item.id,
            initialCount: item.comments_count ?? 0,
          })}
        >
          <Text>{`comments-button-${item.id}`}</Text>
        </Pressable>
      </>
    );
  };
  MockFeedItem.displayName = 'MockFeedItem';
  return MockFeedItem;
});

jest.mock('@/components/comments/CommentSheet', () => {
  const MockCommentSheet = ({
    visible,
    targetType,
    targetId,
    onCountChange,
  }: {
    visible: boolean;
    targetType: string;
    targetId: number;
    onCountChange?: (count: number) => void;
  }) => {
    const { Pressable, Text } = require('react-native');
    if (!visible) return null;
    return (
      <>
        <Text>{`home-comments-${targetType}-${targetId}`}</Text>
        <Pressable accessibilityLabel="mock-comment-count-change" onPress={() => onCountChange?.(7)}>
          <Text>count-change</Text>
        </Pressable>
      </>
    );
  };
  MockCommentSheet.displayName = 'MockCommentSheet';
  return MockCommentSheet;
});

jest.mock('@/components/OfflineBanner', () => () => null);
jest.mock('@/components/TenantBanner', () => () => null);
jest.mock('@/components/ui/Skeleton', () => ({
  FeedItemSkeleton: () => null,
  ExchangeCardSkeleton: () => null,
  ProfileSkeleton: () => null,
}));

// --- Tests ---

import HomeScreen from './home';
import { markFeedStale } from '@/lib/feedRefreshSignal';
import { getEvents } from '@/lib/api/events';
import { getExchanges } from '@/lib/api/exchanges';
import { getWalletBalance } from '@/lib/api/wallet';

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
  mockUsePaginatedApi.mockReturnValue(defaultPaginatedState);
  mockRealtimeContext.unreadNotifications = 0;
  mockRealtimeContext.unreadMessages = 0;
});

const mockFeedItem = {
  id: 1,
  type: 'post' as const,
  content: 'Hello, timebank!',
  created_at: '2026-01-01T10:00:00Z',
  user: { id: 1, name: 'Alice Smith', avatar_url: null },
  likes_count: 0,
  comments_count: 0,
  has_liked: false,
};

describe('HomeScreen', () => {
  it('renders the greeting with the user first name', () => {
    const { getByText } = render(<HomeScreen />);
    expect(getByText('Hello, Alice', { exact: false })).toBeTruthy();
  });

  it('renders the feed subtitle', () => {
    const { getByText } = render(<HomeScreen />);
    expect(getByText("Here's what's happening in your timebank")).toBeTruthy();
  });

  it('keeps dashboard summary cards off the feed-first landing page', () => {
    const { queryByText } = render(<HomeScreen />);

    expect(queryByText('Balance')).toBeNull();
    expect(queryByText('Upcoming events')).toBeNull();
    expect(queryByText('Open requests')).toBeNull();
    expect(getWalletBalance).not.toHaveBeenCalled();
    expect(getEvents).not.toHaveBeenCalled();
    expect(getExchanges).not.toHaveBeenCalled();
  });

  it('renders empty state when feed has no items and is not loading', () => {
    const { getByText } = render(<HomeScreen />);
    expect(getByText('No activity yet. Say hello to your community!')).toBeTruthy();
  });

  it('does not show empty text while loading', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [],
      isLoading: true,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { queryByText } = render(<HomeScreen />);
    expect(queryByText('No activity yet. Say hello to your community!')).toBeNull();
  });

  it('renders feed items when data is loaded', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [mockFeedItem],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { getByText } = render(<HomeScreen />);
    expect(getByText('Hello, timebank!')).toBeTruthy();
  });

  it('opens feed comments from a screen-level sheet outside clipped list rows', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [{ ...mockFeedItem, comments_count: 2 }],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { getByLabelText, getByText } = render(<HomeScreen />);

    fireEvent.press(getByLabelText('open-comments-1'));

    expect(getByText('home-comments-post-1')).toBeTruthy();
  });

  it('keeps updated comment counts in the home feed target map', () => {
    mockUsePaginatedApi.mockReturnValue({
      items: [{ ...mockFeedItem, comments_count: 2 }],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { getByLabelText, getByText } = render(<HomeScreen />);

    fireEvent.press(getByLabelText('open-comments-1'));
    fireEvent.press(getByLabelText('mock-comment-count-change'));

    expect(getByText('home-comments-post-1')).toBeTruthy();
    expect(getByText('override-count-7')).toBeTruthy();
  });

  it('shows error message with Retry button when feed fails to load', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [],
      isLoading: false,
      isLoadingMore: false,
      error: 'Network error',
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { getByText } = render(<HomeScreen />);
    expect(getByText('Network error')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
  });

  it('shows unread notification badge when there are unread notifications', () => {
    mockRealtimeContext.unreadNotifications = 3;

    const { getAllByText } = render(<HomeScreen />);
    expect(getAllByText('3').length).toBeGreaterThan(0);
  });

  it('shows the unread count when notification count is two digits', () => {
    mockRealtimeContext.unreadNotifications = 14;

    const { getAllByText } = render(<HomeScreen />);
    expect(getAllByText('14').length).toBeGreaterThan(0);
  });

  it('caps the unread notification badge at 99+', () => {
    mockRealtimeContext.unreadNotifications = 124;

    const { getAllByText } = render(<HomeScreen />);
    expect(getAllByText('99+').length).toBeGreaterThan(0);
  });

  /*
    🔴 Journey 2.9. This app could read a community's feed and never write to it — there
    was no composer, no client call and no way in. The row below is the way in, so its
    absence is a regression worth a test of its own.
  */
  it('offers a way to write a post, and opens the composer', () => {
    const { getByTestId } = render(<HomeScreen />);

    fireEvent.press(getByTestId('feed-composer-trigger'));

    expect(mockRouterPush).toHaveBeenCalledWith('/(modals)/new-post');
  });

  it('hides the composer when the community has its feed switched off', () => {
    mockHasModule.mockReturnValue(false);

    const { queryByTestId } = render(<HomeScreen />);

    expect(queryByTestId('feed-composer-trigger')).toBeNull();
  });

  it('re-reads the feed on focus only after something was written', () => {
    // Arriving on the screen must not cost a second request…
    const refresh = jest.fn();
    mockUsePaginatedApi.mockReturnValue({ ...defaultPaginatedState, refresh });

    const view = render(<HomeScreen />);
    expect(refresh).not.toHaveBeenCalled();

    // …but a post written elsewhere must not leave the member looking at a list
    // without their own post in it.
    markFeedStale();
    view.rerender(<HomeScreen />);

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
