// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PodcastPlayerProvider, usePodcastPlayer } from './PodcastPlayerContext';
import { readResumePosition, saveResumePosition, saveSpeedPreference } from '@/lib/podcasts/resumeStore';

const recordListen = vi.fn().mockResolvedValue({ success: true });

vi.mock('@/lib/api/podcasts', () => ({
  podcastsApi: {
    recordListen: (...args: unknown[]) => recordListen(...args),
  },
}));

vi.mock('@/lib/api', () => ({
  API_BASE: '/api',
  tokenManager: {
    getAccessToken: () => 'test-access-token',
    getTenantId: () => 2,
  },
}));

// 🔴 Both gates are required even when nothing in this file reads them: shared
// components (Breadcrumbs, headers, menus) ask the tenant context whether a
// destination is enabled, and a partial mock makes that call throw during render.
// Granting everything keeps these cases about their own subject.
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenant: { id: 2 }, hasFeature: () => true, tenantPath: (p: string) => p, hasModule: vi.fn((_key: string) => true) }),
}));

function track(overrides: Record<string, unknown> = {}) {
  return {
    episodeId: 7,
    showSlug: 'my-show',
    episodeSlug: 'ep-one',
    title: 'Episode One',
    showTitle: 'My Show',
    audioUrl: 'https://example.test/audio/one.mp3',
    durationSeconds: 600,
    ...overrides,
  };
}

function Probe() {
  const player = usePodcastPlayer();
  return (
    <div>
      <output data-testid="status">{player.status}</output>
      <output data-testid="title">{player.track?.title ?? 'none'}</output>
      <output data-testid="time">{Math.floor(player.currentTime)}</output>
      <output data-testid="rate">{player.playbackRate}</output>
      <button onClick={() => player.load(track(), { autoplay: false })}>load-one</button>
      <button onClick={() => player.load(track(), { autoplay: true })}>load-one-autoplay</button>
      <button onClick={() => player.load(track({ episodeId: 8, episodeSlug: 'ep-two', title: 'Episode Two', audioUrl: 'https://example.test/audio/two.mp3' }))}>
        load-two
      </button>
      <button onClick={() => player.close()}>close</button>
      <button onClick={() => player.setRate(1.5)}>rate-1.5</button>
    </div>
  );
}

function renderPlayer() {
  return render(
    <PodcastPlayerProvider>
      <Probe />
    </PodcastPlayerProvider>
  );
}

function playerAudio(): HTMLAudioElement {
  const audio = document.querySelector<HTMLAudioElement>('audio[data-podcast-player]');
  if (!audio) throw new Error('player audio element missing');
  return audio;
}

describe('PodcastPlayerContext', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    recordListen.mockClear();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a single hidden audio element and loads tracks into it', () => {
    renderPlayer();
    expect(document.querySelectorAll('audio[data-podcast-player]').length).toBe(1);

    fireEvent.click(screen.getByText('load-one'));
    expect(playerAudio().getAttribute('src')).toBe('https://example.test/audio/one.mp3');
    expect(screen.getByTestId('title').textContent).toBe('Episode One');
    expect(screen.getByTestId('status').textContent).toBe('loading');
  });

  it('never reloads the already-active track (back-navigation must not restart)', () => {
    renderPlayer();
    fireEvent.click(screen.getByText('load-one'));

    const audio = playerAudio();
    audio.currentTime = 200;
    fireEvent.timeUpdate(audio);
    expect(screen.getByTestId('time').textContent).toBe('200');

    const loadSpy = HTMLMediaElement.prototype.load as ReturnType<typeof vi.fn>;
    const callsBefore = loadSpy.mock.calls.length;

    fireEvent.click(screen.getByText('load-one-autoplay'));
    expect(loadSpy.mock.calls.length).toBe(callsBefore);
    expect(audio.currentTime).toBe(200);
  });

  it('records a completed listen exactly once on ended, with a stable session id', () => {
    renderPlayer();
    fireEvent.click(screen.getByText('load-one'));

    const audio = playerAudio();
    fireEvent.ended(audio);
    fireEvent.ended(audio);

    expect(recordListen).toHaveBeenCalledTimes(1);
    const [episodeId, payload] = recordListen.mock.calls[0] as [number, { listened_seconds: number; completed: boolean; session_id: string }];
    expect(episodeId).toBe(7);
    expect(payload.completed).toBe(true);
    expect(payload.listened_seconds).toBe(600);
    expect(payload.session_id).toContain('7:');
  });

  it('records a partial listen when playback pauses', () => {
    renderPlayer();
    fireEvent.click(screen.getByText('load-one'));

    const audio = playerAudio();
    audio.currentTime = 87;
    fireEvent.pause(audio);

    expect(recordListen).toHaveBeenCalledWith(7, expect.objectContaining({
      listened_seconds: 87,
      completed: false,
      session_id: expect.stringContaining('7:'),
    }));
  });

  it('starts a stable analytics session when playback begins', () => {
    renderPlayer();
    fireEvent.click(screen.getByText('load-one'));
    fireEvent.play(playerAudio());

    expect(recordListen).toHaveBeenCalledWith(7, expect.objectContaining({
      listened_seconds: 0,
      completed: false,
      session_id: expect.stringContaining('7:'),
    }));
  });

  it('reports a periodic partial listen after the analytics interval', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    renderPlayer();
    fireEvent.click(screen.getByText('load-one'));
    const audio = playerAudio();
    fireEvent.play(audio);

    now.mockReturnValue(16_001);
    audio.currentTime = 43;
    fireEvent.timeUpdate(audio);

    expect(recordListen).toHaveBeenCalledTimes(2);
    expect(recordListen).toHaveBeenLastCalledWith(7, expect.objectContaining({
      listened_seconds: 43,
      completed: false,
      session_id: expect.stringContaining('7:'),
    }));
  });

  it('flushes an authenticated keepalive listen on pagehide', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    renderPlayer();
    fireEvent.click(screen.getByText('load-one'));
    const audio = playerAudio();
    audio.currentTime = 72;

    window.dispatchEvent(new Event('pagehide'));

    expect(fetchMock).toHaveBeenCalledWith('/api/v2/podcasts/episodes/7/listen', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      keepalive: true,
    }));
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = options.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer test-access-token');
    expect(headers.get('X-Tenant-ID')).toBe('2');
    expect(JSON.parse(String(options.body))).toEqual(expect.objectContaining({
      listened_seconds: 72,
      completed: false,
      session_id: expect.stringContaining('7:'),
    }));
    vi.unstubAllGlobals();
  });

  it('applies the saved resume position after metadata arrives and clears it on completion', () => {
    saveResumePosition(2, 7, 120);
    renderPlayer();
    fireEvent.click(screen.getByText('load-one'));

    const audio = playerAudio();
    // Seek is queued until loadedmetadata (iOS ignores earlier writes).
    fireEvent.loadedMetadata(audio);
    expect(audio.currentTime).toBe(120);

    fireEvent.ended(audio);
    expect(readResumePosition(2, 7)).toBeNull();
  });

  it('persists position on pause and restores rate preference on load', () => {
    saveSpeedPreference(2, 1.5);
    renderPlayer();
    fireEvent.click(screen.getByText('load-one'));

    const audio = playerAudio();
    expect(audio.playbackRate).toBe(1.5);
    expect(screen.getByTestId('rate').textContent).toBe('1.5');

    audio.currentTime = 333;
    fireEvent.pause(audio);
    expect(readResumePosition(2, 7)).toBe(333);
    expect(screen.getByTestId('status').textContent).toBe('paused');
  });

  it('switching tracks persists the outgoing position and resets completion tracking', () => {
    renderPlayer();
    fireEvent.click(screen.getByText('load-one'));

    const audio = playerAudio();
    audio.currentTime = 250;
    fireEvent.timeUpdate(audio);

    fireEvent.click(screen.getByText('load-two'));
    expect(readResumePosition(2, 7)).toBe(250);
    expect(audio.getAttribute('src')).toBe('https://example.test/audio/two.mp3');
    expect(screen.getByTestId('title').textContent).toBe('Episode Two');

    // The outgoing partial listen is flushed, then completion fires for the new track.
    fireEvent.ended(audio);
    expect(recordListen).toHaveBeenCalledTimes(2);
    expect(recordListen.mock.calls[0][0]).toBe(7);
    expect(recordListen.mock.calls[1][0]).toBe(8);
  });

  it('close() clears the track and ignores the spurious src-clear error', () => {
    renderPlayer();
    fireEvent.click(screen.getByText('load-one'));

    fireEvent.click(screen.getByText('close'));
    expect(screen.getByTestId('title').textContent).toBe('none');
    expect(screen.getByTestId('status').textContent).toBe('idle');

    // The error event fired by clearing src must not flip status to error.
    fireEvent.error(playerAudio());
    expect(screen.getByTestId('status').textContent).toBe('idle');
  });

  it('setRate persists the preference for future loads', () => {
    renderPlayer();
    fireEvent.click(screen.getByText('load-one'));
    fireEvent.click(screen.getByText('rate-1.5'));

    expect(playerAudio().playbackRate).toBe(1.5);
    // A fresh load of a different track keeps the preferred rate.
    fireEvent.click(screen.getByText('load-two'));
    expect(playerAudio().playbackRate).toBe(1.5);
  });
});
