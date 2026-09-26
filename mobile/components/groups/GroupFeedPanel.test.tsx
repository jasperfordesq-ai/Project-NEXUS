// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockGetFeed = jest.fn();
const mockRefresh = jest.fn();
const mockLoadMore = jest.fn();
const mockUsePaginatedApi = jest.fn();

jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/lib/hooks/useTenant', () => ({ usePrimaryColor: () => '#006fee' }));
jest.mock('@/lib/hooks/useTheme', () => ({ useTheme: () => ({ text: '#111', textSecondary: '#555' }) }));
jest.mock('@/lib/api/feed', () => ({
  getFeed: (...args: unknown[]) => mockGetFeed(...args),
  excludeGamificationMilestones: (items: unknown[]) => items,
}));
jest.mock('@/lib/hooks/usePaginatedApi', () => ({
  usePaginatedApi: (...args: unknown[]) => mockUsePaginatedApi(...args),
}));
jest.mock('@/components/FeedItem', () => {
  const { Text } = require('react-native');
  return ({ item }: { item: { id: number; type: string } }) => <Text>{`${item.type}:${item.id}`}</Text>;
});
jest.mock('@/components/ui/ErrorState', () => {
  const { Pressable, Text } = require('react-native');
  return ({ subtitle, onRetry }: { subtitle: string; onRetry: () => void }) => <Pressable onPress={onRetry}><Text>{subtitle}</Text></Pressable>;
});

import GroupFeedPanel from './GroupFeedPanel';

const feedState = {
  items: [{ id: 7, type: 'post' }],
  isLoading: false,
  isLoadingMore: false,
  error: null,
  hasMore: true,
  refresh: mockRefresh,
  loadMore: mockLoadMore,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUsePaginatedApi.mockReturnValue(feedState);
});

it('reads only the requested group and uses compound feed identity', async () => {
  mockGetFeed.mockResolvedValue({ data: [], meta: { cursor: null, has_more: false } });
  render(<GroupFeedPanel groupId={23} canView refreshToken={0} />);
  const [fetchFeed, , deps, options] = mockUsePaginatedApi.mock.calls[0];

  await fetchFeed('next-page');
  expect(mockGetFeed).toHaveBeenCalledWith(1, 'next-page', { groupId: 23, mode: 'recent', perPage: 20 });
  expect(deps).toEqual([23, true]);
  expect(options).toEqual(expect.objectContaining({ enabled: true, clearOnRefusal: true }));
  expect(options.getKey({ type: 'poll', id: 7 })).toBe('poll:7');
});

it('opens group-bound post and poll composers', () => {
  const screen = render(<GroupFeedPanel groupId={23} canView refreshToken={0} />);
  fireEvent.press(screen.getByTestId('group-feed-create-post'));
  fireEvent.press(screen.getByTestId('group-feed-create-poll'));

  expect(mockPush).toHaveBeenNthCalledWith(1, { pathname: '/(modals)/new-post', params: { group_id: '23' } });
  expect(mockPush).toHaveBeenNthCalledWith(2, { pathname: '/(modals)/polls', params: { create: '1', group_id: '23' } });
});

it('does not enable the group feed read for an outsider', () => {
  mockUsePaginatedApi.mockReturnValue({ ...feedState, items: [] });
  const screen = render(<GroupFeedPanel groupId={23} canView={false} refreshToken={0} />);
  const options = mockUsePaginatedApi.mock.calls[0][3];

  expect(options).toEqual(expect.objectContaining({ enabled: false, clearOnRefusal: true }));
  expect(screen.getByText('detail.feed.joinTitle')).toBeTruthy();
  expect(screen.queryByTestId('group-feed-create-post')).toBeNull();
});

it('honours the parent pull-to-refresh signal', () => {
  const screen = render(<GroupFeedPanel groupId={23} canView refreshToken={0} />);
  screen.rerender(<GroupFeedPanel groupId={23} canView refreshToken={1} />);
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});
