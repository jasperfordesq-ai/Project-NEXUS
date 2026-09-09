// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PodcastAudioPlayer } from './PodcastAudioPlayer';
import { PodcastPlayerProvider } from '@/contexts/PodcastPlayerContext';
import { saveResumePosition } from '@/lib/podcasts/resumeStore';
import type { PodcastEpisode } from '@/lib/api/podcasts';

vi.mock('@/lib/api/podcasts', () => ({
  podcastsApi: {
    recordListen: vi.fn().mockResolvedValue({ success: true }),
  },
}));

// 🔴 Both gates are required even when nothing in this file reads them: shared
// components (Breadcrumbs, headers, menus) ask the tenant context whether a
// destination is enabled, and a partial mock makes that call throw during render.
// Granting everything keeps these cases about their own subject.
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenant: { id: 2 }, hasFeature: () => true, tenantPath: (p: string) => p, hasModule: vi.fn((_key: string) => true) }),
}));

function episode(overrides: Partial<PodcastEpisode> = {}): PodcastEpisode {
  return {
    id: 1,
    show_id: 1,
    author_user_id: 1,
    title: 'First episode',
    slug: 'first-episode',
    audio_url: 'https://example.test/audio/first.mp3',
    duration_seconds: 90,
    explicit: false,
    episode_type: 'full',
    visibility: 'public',
    status: 'published',
    moderation_status: 'approved',
    listen_count: 0,
    ...overrides,
  };
}

function renderPlayer(ep: PodcastEpisode) {
  return render(
    <PodcastPlayerProvider>
      <PodcastAudioPlayer episode={ep} showSlug="my-show" />
    </PodcastPlayerProvider>,
  );
}

function playerAudio(): HTMLAudioElement {
  const audio = document.querySelector<HTMLAudioElement>('audio[data-podcast-player]');
  if (!audio) throw new Error('player audio element missing');
  return audio;
}

describe('PodcastAudioPlayer', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the episode into the shared player only when Play is pressed', () => {
    renderPlayer(episode());

    // Browsing to the page must NOT touch the shared audio element.
    expect(playerAudio().getAttribute('src')).toBeNull();
    expect(screen.getByText('1:30')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(playerAudio().getAttribute('src')).toBe('https://example.test/audio/first.mp3');
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('rebinding to the active episode keeps playback state (no restart)', () => {
    const first = episode();
    const { rerender } = renderPlayer(first);

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    const audio = playerAudio();
    audio.currentTime = 42;
    fireEvent.timeUpdate(audio);
    expect(screen.getByText('0:42')).toBeInTheDocument();

    // Navigate away to another episode's page and back — the active episode's
    // view binds to live state without reloading the source.
    const second = episode({ id: 2, title: 'Second', slug: 'second', audio_url: 'https://example.test/audio/second.mp3' });
    rerender(
      <PodcastPlayerProvider>
        <PodcastAudioPlayer episode={second} showSlug="my-show" />
      </PodcastPlayerProvider>,
    );
    // Second episode page shows static metadata; the audio src is untouched.
    expect(playerAudio().getAttribute('src')).toBe('https://example.test/audio/first.mp3');

    rerender(
      <PodcastPlayerProvider>
        <PodcastAudioPlayer episode={first} showSlug="my-show" />
      </PodcastPlayerProvider>,
    );
    expect(playerAudio().getAttribute('src')).toBe('https://example.test/audio/first.mp3');
    expect(playerAudio().currentTime).toBe(42);
    expect(screen.getByText('0:42')).toBeInTheDocument();
  });

  it('offers resume for an episode with a saved position and honours Start over', () => {
    saveResumePosition(2, 1, 60);
    renderPlayer(episode());

    expect(screen.getByText('Resume from 1:00')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    const audio = playerAudio();
    expect(audio.getAttribute('src')).toBe('https://example.test/audio/first.mp3');
    // Explicit start-over queues a seek to 0 (metadata not loaded yet in jsdom).
    fireEvent.loadedMetadata(audio);
    expect(audio.currentTime).toBe(0);
  });

  it('shows the error state with a Retry action when the active track fails', () => {
    renderPlayer(episode());
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));

    fireEvent.error(playerAudio());
    expect(screen.getByRole('alert')).toBeInTheDocument();

    const loadSpy = HTMLMediaElement.prototype.load as ReturnType<typeof vi.fn>;
    const callsBefore = loadSpy.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(loadSpy.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('seeks to a chapter through the shared player', () => {
    renderPlayer(episode({
      chapters: [
        { title: 'Intro', starts_at_seconds: 0 },
        { title: 'Main topic', starts_at_seconds: 45 },
      ],
    }));

    fireEvent.click(screen.getByRole('button', { name: /Main topic/ }));
    const audio = playerAudio();
    expect(audio.getAttribute('src')).toBe('https://example.test/audio/first.mp3');
    // Chapter seek is queued until metadata, then applied — and it wins over
    // any saved resume position.
    fireEvent.loadedMetadata(audio);
    expect(audio.currentTime).toBe(45);
  });

  it('exposes accessible progress and visible volume controls while active', () => {
    renderPlayer(episode());
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));

    const progress = screen.getByRole('slider', { name: 'Playback progress' });
    const volume = screen.getByRole('slider', { name: 'Volume' });
    expect(progress).toHaveAttribute('aria-valuetext');
    expect(volume).toHaveAttribute('aria-valuetext');
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
