// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetFeedItem = jest.fn();
const mockUseLocalSearchParams = jest.fn();
const mockHasModule = jest.fn();
const mockT = (key: string) => {
  const map: Record<string, string> = {
    'feedTypes.post': 'Post',
    'feed.emptySubtitle': 'Start connecting with your community to see posts here.',
    'common:buttons.back': 'Back',
    'common:buttons.retry': 'Retry',
    'common:errors.generic': 'Something went wrong. Please try again.',
    'common:errors.notFound': 'Not found.',
  };
  return map[key] ?? key;
};

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { back: jest.fn(), canGoBack: jest.fn(() => false), push: jest.fn() },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => ({ hasModule: mockHasModule }),
}));

jest.mock('@/lib/api/feed', () => ({
  getFeedItem: (...args: unknown[]) => mockGetFeedItem(...args),
}));

jest.mock('@/components/FeedItem', () => {
  const { Pressable, Text, View } = require('react-native');
  return ({ item, disableDetailNavigation, onOpenReactors }: {
    item: { id: number; title: string };
    disableDetailNavigation?: boolean;
    onOpenReactors?: (target: { targetType: 'post'; targetId: number; reactions: null }) => void;
  }) => (
    <View>
      <Text>{disableDetailNavigation ? `Detail: ${item.title}` : item.title}</Text>
      <Pressable onPress={() => onOpenReactors?.({ targetType: 'post', targetId: item.id, reactions: null })}>
        <Text>Open reactors</Text>
      </Pressable>
    </View>
  );
});

jest.mock('@/components/reactions/ReactorsSheet', () => {
  const { Pressable, Text, View } = require('react-native');
  return ({ visible, targetId, onClose }: { visible: boolean; targetId: number; onClose: () => void }) => visible ? (
    <View>
      <Text>{`Reactors for ${targetId}`}</Text>
      <Pressable onPress={onClose}><Text>Close reactors</Text></Pressable>
    </View>
  ) : null;
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

import FeedItemDetailScreen from './feed-item-detail';

describe('FeedItemDetailScreen', () => {
  beforeEach(() => {
    mockGetFeedItem.mockReset();
    mockUseLocalSearchParams.mockReset();
    mockHasModule.mockReset().mockReturnValue(true);
    mockUseLocalSearchParams.mockReturnValue({ id: '42', type: 'post' });
  });

  it('loads and renders a native post detail card', async () => {
    mockGetFeedItem.mockResolvedValue({
      data: {
        id: 42,
        type: 'post',
        title: 'Garden update',
        content: 'Seeds are sprouting.',
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
    });

    const { getByText } = render(<FeedItemDetailScreen />);

    await waitFor(() => expect(mockGetFeedItem).toHaveBeenCalledWith('post', 42));
    expect(getByText('Garden update')).toBeTruthy();
    expect(getByText('Detail: Garden update')).toBeTruthy();
  });

  it('falls back when the feed module is unavailable', async () => {
    mockHasModule.mockReturnValue(false);

    const { getByText } = render(<FeedItemDetailScreen />);

    await waitFor(() => expect(mockGetFeedItem).not.toHaveBeenCalled());
    expect(getByText('Not found.')).toBeTruthy();
  });

  it.each(['poll', 'resource'] as const)('shows a recoverable not-found state for a stale %s notification target', async (type) => {
    mockUseLocalSearchParams.mockReturnValue({ id: '42', type });
    mockGetFeedItem.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));

    const { getByText } = render(<FeedItemDetailScreen />);

    await waitFor(() => expect(mockGetFeedItem).toHaveBeenCalledWith(type, 42));
    expect(getByText('Not found.')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
  });

  it('opens the reactors sheet from the detail card', async () => {
    mockGetFeedItem.mockResolvedValue({
      data: {
        id: 42,
        type: 'post',
        title: 'Garden update',
        content: 'Seeds are sprouting.',
        reactions: null,
      },
    });

    const { getByText, queryByText } = render(<FeedItemDetailScreen />);

    await waitFor(() => expect(getByText('Open reactors')).toBeTruthy());
    fireEvent.press(getByText('Open reactors'));
    expect(getByText('Reactors for 42')).toBeTruthy();

    fireEvent.press(getByText('Close reactors'));
    expect(queryByText('Reactors for 42')).toBeNull();
  });
});
