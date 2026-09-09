// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PodcastEpisodePage from './PodcastEpisodePage';

const mockEpisode = vi.fn();
const mockRecordListen = vi.fn();

vi.mock('@/contexts', () => ({
  useAuth: () => ({
    isAuthenticated: false,
    user: null,
  }),
  useTenant: () => ({
    hasFeature: vi.fn((_key: string) => true),
    hasModule: vi.fn((_key: string) => true),
    tenantPath: (path: string) => path,
  }),
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/lib/api/podcasts', () => ({
  podcastsApi: {
    episode: (...args: unknown[]) => mockEpisode(...args),
    recordListen: (...args: unknown[]) => mockRecordListen(...args),
    toggleReaction: vi.fn(),
    reportEpisode: vi.fn(),
  },
}));

vi.mock('@/components/podcasts/PodcastAudioPlayer', () => ({
  PodcastAudioPlayer: ({ episode, showSlug }: { episode: { id: number }; showSlug?: string }) => (
    <div data-testid="audio-player" data-episode-id={episode.id} data-show-slug={showSlug} />
  ),
  trackFromEpisode: (episode: { id: number }) => ({ episodeId: episode.id }),
}));

const mockPlayer = {
  track: null as { episodeId: number } | null,
  status: 'idle',
  currentTime: 0,
  duration: 0,
  playbackRate: 1,
  volume: 1,
  hasError: false,
  load: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  toggle: vi.fn(),
  seekTo: vi.fn(),
  skip: vi.fn(),
  setRate: vi.fn(),
  setVolume: vi.fn(),
  retry: vi.fn(),
  startOver: vi.fn(),
  close: vi.fn(),
  getResumePosition: vi.fn(() => null),
};

vi.mock('@/contexts/PodcastPlayerContext', () => ({
  usePodcastPlayer: () => mockPlayer,
}));

function renderEpisodePage(): void {
  render(
    <MemoryRouter initialEntries={['/podcasts/community-show/public-episode']}>
      <Routes>
        <Route path="/podcasts/:showSlug/:episodeSlug" element={<PodcastEpisodePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PodcastEpisodePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mockEpisode.mockResolvedValue({
      success: true,
      data: {
        id: 42,
        show_id: 7,
        author_user_id: 3,
        title: 'Public episode',
        slug: 'public-episode',
        audio_url: 'https://cdn.example.test/public.mp3',
        explicit: false,
        episode_type: 'full',
        visibility: 'public',
        status: 'published',
        moderation_status: 'approved',
        listen_count: 0,
        reaction_count: 0,
        viewer_has_reacted: false,
        show: {
          id: 7,
          owner_user_id: 3,
          title: 'Community show',
          slug: 'community-show',
          language: 'en',
          visibility: 'public',
          status: 'published',
          moderation_status: 'approved',
          episode_count: 1,
          subscriber_count: 0,
        },
      },
    });
  });

  // Listen-completion analytics are owned by PodcastPlayerContext now (they
  // must survive this page unmounting) — see PodcastPlayerContext.test.tsx.
  it('renders the player bound to the loaded episode and route show slug', async () => {
    renderEpisodePage();

    expect(await screen.findByRole('heading', { name: 'Public episode' })).toBeInTheDocument();
    const player = screen.getByTestId('audio-player');
    expect(player.getAttribute('data-episode-id')).toBe('42');
    expect(player.getAttribute('data-show-slug')).toBe('community-show');
    expect(mockRecordListen).not.toHaveBeenCalled();
  });

  it('space starts playback of the loaded episode via a keyboard gesture', async () => {
    renderEpisodePage();
    expect(await screen.findByRole('heading', { name: 'Public episode' })).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: ' ' });
    expect(mockPlayer.load).toHaveBeenCalledWith({ episodeId: 42 }, { autoplay: true });
  });

  it('keyboard shortcuts never hijack typing in form fields', async () => {
    renderEpisodePage();
    expect(await screen.findByRole('heading', { name: 'Public episode' })).toBeInTheDocument();

    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: ' ' });
    expect(mockPlayer.load).not.toHaveBeenCalled();
    expect(mockPlayer.toggle).not.toHaveBeenCalled();
    input.remove();
  });

  it('arrow keys control the active track', async () => {
    mockPlayer.track = { episodeId: 42 };
    renderEpisodePage();
    expect(await screen.findByRole('heading', { name: 'Public episode' })).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(mockPlayer.skip).toHaveBeenCalledWith(-15);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(mockPlayer.skip).toHaveBeenCalledWith(30);
    fireEvent.keyDown(document.body, { key: 'ArrowUp' });
    expect(mockPlayer.setVolume).toHaveBeenCalledWith(1.1);
    mockPlayer.track = null;
  });
});
