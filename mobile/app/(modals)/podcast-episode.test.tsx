// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockShow = jest.fn();
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ showSlug: 'time-stories', episodeSlug: 'first-hour' }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => ({ 'episode.react': 'React', 'episode.reacted': 'Reacted', 'episode.reaction_failed': 'Could not react', 'episode.description': 'Description', 'episode.transcript': 'Transcript', 'episode.chapters': 'Chapters', 'episode.report': 'Report', 'episode.report_title': 'Report episode', 'common:back': 'Back' } as Record<string, string>)[key] ?? key }) }));
jest.mock('@/lib/hooks/useTenant', () => ({ usePrimaryColor: () => '#06f' }));
jest.mock('@/lib/hooks/useTheme', () => ({ useTheme: () => ({ text: '#111', textSecondary: '#555', textMuted: '#777' }) }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: mockShow }) }));
jest.mock('@/components/podcasts/PodcastAudioPlayer', () => () => 'View');
jest.mock('@/components/ui/ActionSheet', () => () => null);
jest.mock('@/lib/api/podcasts', () => ({ getPodcastEpisode: jest.fn(), togglePodcastReaction: jest.fn(), reportPodcastEpisode: jest.fn() }));

import PodcastEpisodeScreen from './podcast-episode';
import { getPodcastEpisode, togglePodcastReaction } from '@/lib/api/podcasts';

describe('PodcastEpisodeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getPodcastEpisode).mockResolvedValue({ id: 8, show_id: 2, title: 'First hour', slug: 'first-hour', summary: 'Local voices.', description: 'A conversation.', audio_url: 'https://audio.example/1.mp3', explicit: false, episode_type: 'full', listen_count: 3, viewer_has_reacted: false, transcript: 'Full accessible transcript.' });
    jest.mocked(togglePodcastReaction).mockResolvedValue({ active: true });
  });

  it('loads the episode and saves a reaction before updating its label', async () => {
    const { getByText } = render(<PodcastEpisodeScreen />);
    await waitFor(() => expect(getByText('Full accessible transcript.')).toBeTruthy());
    fireEvent.press(getByText('React'));
    await waitFor(() => expect(togglePodcastReaction).toHaveBeenCalledWith(8));
    expect(getByText('Reacted')).toBeTruthy();
  });
});
