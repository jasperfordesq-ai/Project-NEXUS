// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockShow = jest.fn();
const mockSeekToSeconds = jest.fn();
jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(), useLocalSearchParams: () => ({ showSlug: 'time-stories', episodeSlug: 'first-hour' }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, vars?: Record<string, string>) => ({ 'episode.react': 'React', 'episode.reacted': 'Reacted', 'episode.reaction_failed': 'Could not react', 'episode.description': 'Description', 'episode.transcript': 'Transcript', 'episode.chapters': 'Chapters', 'episode.report': 'Report', 'episode.report_title': 'Report episode', 'common:back': 'Back', 'player.jump_to_chapter': `Jump to ${vars?.time ?? ''} — ${vars?.title ?? ''}` } as Record<string, string>)[key] ?? key }) }));
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#06f' }));
jest.mock('@/lib/hooks/useTheme', () => ({ useTheme: () => ({ text: '#111', textSecondary: '#555', textMuted: '#777' }) }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: mockShow }) }));
// The real player is a forwardRef component whose handle the chapter list drives. A
// plain string mock silently drops the ref, so the chapter test would pass against a
// screen that seeks nothing.
jest.mock('@/components/podcasts/PodcastAudioPlayer', () => {
  const { forwardRef, useImperativeHandle } = jest.requireActual('react');
  return {
    __esModule: true,
    default: forwardRef((_props: unknown, ref: unknown) => {
      useImperativeHandle(ref, () => ({ seekToSeconds: mockSeekToSeconds }));
      return null;
    }),
  };
});
jest.mock('@/components/ui/ActionSheet', () => () => null);
jest.mock('@/lib/api/podcasts', () => ({ getPodcastEpisode: jest.fn(), togglePodcastReaction: jest.fn(), reportPodcastEpisode: jest.fn() }));

import PodcastEpisodeScreen from './podcast-episode';
import { ApiResponseError } from '@/lib/api/client';
import { getPodcastEpisode, togglePodcastReaction } from '@/lib/api/podcasts';

describe('PodcastEpisodeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getPodcastEpisode).mockResolvedValue({ id: 8, show_id: 2, title: 'First hour', slug: 'first-hour', summary: 'Local voices.', description: 'A conversation.', audio_url: 'https://audio.example/1.mp3', explicit: false, episode_type: 'full', listen_count: 3, viewer_has_reacted: false, transcript: 'Full accessible transcript.' });
    jest.mocked(togglePodcastReaction).mockResolvedValue({ active: true });
  });

  /**
   * Chapters were a plain list of times. A member who wanted the second half of an
   * episode had no way to get there — the only controls were play and pause.
   */
  it('jumps the player to a chapter the member taps', async () => {
    jest.mocked(getPodcastEpisode).mockResolvedValue({ id: 8, show_id: 2, title: 'First hour', slug: 'first-hour', audio_url: 'https://audio.example/1.mp3', explicit: false, episode_type: 'full', listen_count: 3, chapters: [{ starts_at_seconds: 0, title: 'Welcome' }, { starts_at_seconds: 754, title: 'The exchange' }] });
    const { findByLabelText } = render(<PodcastEpisodeScreen />);
    fireEvent.press(await findByLabelText('Jump to 12:34 — The exchange'));
    expect(mockSeekToSeconds).toHaveBeenCalledWith(754);
  });

  it('loads the episode and saves a reaction before updating its label', async () => {
    const { getByText } = render(<PodcastEpisodeScreen />);
    await waitFor(() => expect(getByText('Full accessible transcript.')).toBeTruthy());
    fireEvent.press(getByText('React'));
    await waitFor(() => expect(togglePodcastReaction).toHaveBeenCalledWith(8));
    expect(getByText('Reacted')).toBeTruthy();
  });

  /**
   * 🔴 An episode in a private show, or one that was taken down, answers 403/404. That was
   * rendered as "could not load" with a Try again the member could press for ever — the
   * server had understood perfectly and said no.
   */
  it('says an episode that is gone or not shared is unavailable, with no dead Retry', async () => {
    jest.mocked(getPodcastEpisode).mockRejectedValue(new ApiResponseError(403, 'Forbidden'));
    const { findByText, queryByText } = render(<PodcastEpisodeScreen />);
    expect(await findByText('common:errors.notAvailableTitle')).toBeTruthy();
    expect(queryByText('episode.retry')).toBeNull();
  });

  it('still offers a retry for a server failure, which retrying can fix', async () => {
    jest.mocked(getPodcastEpisode).mockRejectedValue(new ApiResponseError(500, 'Server error'));
    // useApi retries a 5xx once after 2s before surfacing it.
    const { findByText, queryByText } = render(<PodcastEpisodeScreen />);
    expect(await findByText('episode.retry', {}, { timeout: 5000 })).toBeTruthy();
    expect(queryByText('common:errors.notAvailableTitle')).toBeNull();
  });
});
