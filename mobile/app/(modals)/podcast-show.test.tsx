// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockShow = jest.fn();
jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(), router: { push: (...args: unknown[]) => mockPush(...args) }, useLocalSearchParams: () => ({ slug: 'time-stories' }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => ({ 'show.subscribe': 'Follow show', 'show.unsubscribe': 'Unfollow show', 'show.episodes': 'Episodes', 'show.no_episodes': 'No published episodes yet.', 'show.subscribe_failed': 'Could not update', 'show.subscribed': 'Show followed.', 'common:back': 'Back' } as Record<string, string>)[key] ?? key }) }));
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { id: 2, slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#06f' }));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 10 } }) }));
jest.mock('@/lib/hooks/useTheme', () => ({ useTheme: () => ({ text: '#111', textSecondary: '#555', textMuted: '#777' }) }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: mockShow }) }));
jest.mock('@/lib/api/podcasts', () => ({ getPodcastShow: jest.fn(), togglePodcastSubscription: jest.fn() }));

import PodcastShowScreen from './podcast-show';
import { getPodcastShow, togglePodcastSubscription } from '@/lib/api/podcasts';
import { ApiResponseError } from '@/lib/api/client';

describe('PodcastShowScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getPodcastShow).mockResolvedValue({ id: 2, title: 'Time stories', slug: 'time-stories', summary: 'Local voices.', episode_count: 1, subscriber_count: 9, is_subscribed: false, episodes: [{ id: 8, show_id: 2, title: 'First hour', slug: 'first-hour', audio_url: 'https://audio.example/1.mp3', explicit: false, episode_type: 'full', listen_count: 3 }] });
    jest.mocked(togglePodcastSubscription).mockResolvedValue({ subscribed: true });
  });

  it('follows a show and opens its episode', async () => {
    const { getByText } = render(<PodcastShowScreen />);
    await waitFor(() => expect(getByText('Time stories')).toBeTruthy());
    fireEvent.press(getByText('Follow show'));
    await waitFor(() => expect(togglePodcastSubscription).toHaveBeenCalledWith(2, true));
    fireEvent.press(getByText('First hour'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/podcast-episode', params: { showSlug: 'time-stories', episodeSlug: 'first-hour' } });
  });

  it('keeps the intended follow state when the response is lost', async () => {
    jest.mocked(togglePodcastSubscription).mockRejectedValue(new ApiResponseError(0, 'Network request failed'));
    jest.mocked(getPodcastShow)
      .mockResolvedValueOnce({ id: 2, title: 'Time stories', slug: 'time-stories', summary: 'Local voices.', episode_count: 1, subscriber_count: 9, is_subscribed: false, episodes: [] })
      .mockResolvedValueOnce({ id: 2, title: 'Time stories', slug: 'time-stories', summary: 'Local voices.', episode_count: 1, subscriber_count: 10, is_subscribed: true, episodes: [] });

    const { getByText } = render(<PodcastShowScreen />);
    await waitFor(() => expect(getByText('Follow show')).toBeTruthy());
    fireEvent.press(getByText('Follow show'));

    await waitFor(() => expect(getByText('Unfollow show')).toBeTruthy());
    expect(mockShow).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }));
  });
});
