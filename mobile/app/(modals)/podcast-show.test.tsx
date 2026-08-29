// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockShow = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) }, useLocalSearchParams: () => ({ slug: 'time-stories' }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => ({ 'show.subscribe': 'Follow show', 'show.unsubscribe': 'Unfollow show', 'show.episodes': 'Episodes', 'show.no_episodes': 'No published episodes yet.', 'show.subscribe_failed': 'Could not update', 'show.subscribed': 'Show followed.', 'common:back': 'Back' } as Record<string, string>)[key] ?? key }) }));
jest.mock('@/lib/hooks/useTenant', () => ({ usePrimaryColor: () => '#06f' }));
jest.mock('@/lib/hooks/useTheme', () => ({ useTheme: () => ({ text: '#111', textSecondary: '#555', textMuted: '#777' }) }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: mockShow }) }));
jest.mock('@/lib/api/podcasts', () => ({ getPodcastShow: jest.fn(), togglePodcastSubscription: jest.fn() }));

import PodcastShowScreen from './podcast-show';
import { getPodcastShow, togglePodcastSubscription } from '@/lib/api/podcasts';

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
    await waitFor(() => expect(togglePodcastSubscription).toHaveBeenCalledWith(2));
    fireEvent.press(getByText('First hour'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/podcast-episode', params: { showSlug: 'time-stories', episodeSlug: 'first-hour' } });
  });
});
