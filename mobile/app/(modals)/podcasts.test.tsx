// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(), router: { push: (...args: unknown[]) => mockPush(...args) } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => ({ title: 'Podcasts', subtitle: 'Community audio stories', 'browse.search_placeholder': 'Search shows', 'browse.empty': 'No podcast shows yet', 'browse.empty_hint': 'Check back soon', 'browse.retry': 'Try again', 'common:back': 'Back', 'common:actions.clear': 'Clear search', 'studio.title': 'Podcast Studio', 'studio.create_show': 'Create show' } as Record<string, string>)[key] ?? key }) }));
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#06f' }));
jest.mock('@/lib/hooks/useTheme', () => ({ useTheme: () => ({ text: '#111', textSecondary: '#555', textMuted: '#777' }) }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/lib/api/podcasts', () => ({ getPodcastShows: jest.fn() }));

import PodcastsScreen from './podcasts';
import { getPodcastShows } from '@/lib/api/podcasts';

describe('PodcastsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getPodcastShows).mockResolvedValue({ items: [{ id: 2, title: 'Time stories', slug: 'time-stories', summary: 'Local voices.', episode_count: 4, subscriber_count: 9 }], page: 1, total: 1, hasMore: false, categories: [] });
  });

  /**
   * 🔴 A community with more than twenty shows had the rest invisible: the screen asked
   * for page one and never asked again, and there was no button, no footer and no hint
   * that anything else existed.
   */
  it('fetches the next page when the member scrolls to the end, and adds to what is there', async () => {
    jest.mocked(getPodcastShows)
      .mockResolvedValueOnce({ items: [{ id: 2, title: 'Time stories', slug: 'time-stories', episode_count: 4, subscriber_count: 9 }], page: 1, total: 2, hasMore: true, categories: [] })
      .mockResolvedValueOnce({ items: [{ id: 3, title: 'Second season', slug: 'second-season', episode_count: 2, subscriber_count: 1 }], page: 2, total: 2, hasMore: false, categories: [] });

    const { getByText, UNSAFE_getByType } = render(<PodcastsScreen />);
    await waitFor(() => expect(getByText('Time stories')).toBeTruthy());

    const { FlatList } = require('react-native');
    fireEvent(UNSAFE_getByType(FlatList), 'endReached');

    await waitFor(() => expect(getPodcastShows).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));
    // Page one must still be there — a second page that REPLACES the first is a worse
    // bug than not paging at all.
    await waitFor(() => expect(getByText('Second season')).toBeTruthy());
    expect(getByText('Time stories')).toBeTruthy();
  });

  it('stops asking once the server says there is no more', async () => {
    const { getByText, UNSAFE_getByType } = render(<PodcastsScreen />);
    await waitFor(() => expect(getByText('Time stories')).toBeTruthy());
    expect(getPodcastShows).toHaveBeenCalledTimes(1);

    const { FlatList } = require('react-native');
    fireEvent(UNSAFE_getByType(FlatList), 'endReached');
    fireEvent(UNSAFE_getByType(FlatList), 'endReached');

    await waitFor(() => expect(getPodcastShows).toHaveBeenCalledTimes(1));
  });

  it('opens a podcast show from the native catalogue', async () => {
    const { getByText } = render(<PodcastsScreen />);
    await waitFor(() => expect(getByText('Time stories')).toBeTruthy());
    fireEvent.press(getByText('Time stories'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/podcast-show', params: { slug: 'time-stories' } });
  });

  /*
    🔴 The studio must have a door here. Reachable only from the "+" menu, a member
    who already has a show has no way back to it — which is how a member concludes
    the feature is not there.
  */
  it('offers the studio entry points and opens them natively', async () => {
    const { getByText } = render(<PodcastsScreen />);
    await waitFor(() => expect(getByText('Podcast Studio')).toBeTruthy());

    fireEvent.press(getByText('Podcast Studio'));
    expect(mockPush).toHaveBeenCalledWith('/(modals)/podcast-studio');

    fireEvent.press(getByText('Create show'));
    expect(mockPush).toHaveBeenCalledWith('/(modals)/podcast-studio');
  });
});
