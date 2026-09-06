// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { uploadWithProgress } from '@/lib/api/uploadWithProgress';
import {
  archivePodcastEpisode,
  archivePodcastShow,
  createPodcastEpisode,
  createPodcastEpisodeWithAudio,
  createPodcastShow,
  deletePodcastEpisode,
  deletePodcastShow,
  getAuthoredPodcasts,
  getPodcastEpisode,
  getPodcastShow,
  getPodcastShowStats,
  getPodcastShows,
  publishPodcastEpisode,
  publishPodcastShow,
  recordPodcastListen,
  reportPodcastEpisode,
  togglePodcastReaction,
  togglePodcastSubscription,
  updatePodcastEpisode,
  updatePodcastShow,
  uploadPodcastEpisodeCover,
  uploadPodcastShowArtwork,
  validatePodcastFeed,
} from './podcasts';

jest.mock('@/lib/api/client', () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), upload: jest.fn() } }));
jest.mock('@/lib/api/uploadWithProgress', () => ({ uploadWithProgress: jest.fn() }));

describe('podcasts API', () => {
  beforeEach(() => jest.clearAllMocks());

  it('normalises the paginated Laravel collection and preserves filters', async () => {
    jest.mocked(api.get).mockResolvedValue({ data: [{ id: 2, title: 'Time stories', slug: 'time-stories' }], meta: { current_page: 2, total: 9, has_more: false, categories: ['Community'] } });
    await expect(getPodcastShows({ query: 'time', category: 'Community', sort: 'newest', page: 2 })).resolves.toMatchObject({ page: 2, total: 9, hasMore: false, categories: ['Community'] });
    expect(api.get).toHaveBeenCalledWith('/api/v2/podcasts', { q: 'time', category: 'Community', sort: 'newest', page: '2', per_page: '20' });
  });

  it('encodes show and episode slugs and unwraps data envelopes', async () => {
    jest.mocked(api.get)
      .mockResolvedValueOnce({ data: { id: 2, title: 'Time stories' } })
      .mockResolvedValueOnce({ data: { id: 8, title: 'First hour' } });
    await expect(getPodcastShow('time stories')).resolves.toMatchObject({ id: 2 });
    await expect(getPodcastEpisode('time stories', 'first/hour')).resolves.toMatchObject({ id: 8 });
    expect(api.get).toHaveBeenNthCalledWith(1, '/api/v2/podcasts/time%20stories');
    expect(api.get).toHaveBeenNthCalledWith(2, '/api/v2/podcasts/time%20stories/first%2Fhour');
  });

  it('records playback progress through the authenticated listen contract', async () => {
    jest.mocked(api.post).mockResolvedValue({ data: { recorded: true } });
    await expect(recordPodcastListen(8, { position_seconds: 30, completed: false })).resolves.toEqual({ recorded: true });
    expect(api.post).toHaveBeenCalledWith('/api/v2/podcasts/episodes/8/listen', { position_seconds: 30, completed: false });
  });

  it('uses the authenticated follow, reaction and reporting contracts', async () => {
    jest.mocked(api.post)
      .mockResolvedValueOnce({ data: { subscribed: true } })
      .mockResolvedValueOnce({ data: { active: true } })
      .mockResolvedValueOnce({ data: { id: 91 } });
    await expect(togglePodcastSubscription(2)).resolves.toEqual({ subscribed: true });
    await expect(togglePodcastReaction(8)).resolves.toEqual({ active: true });
    await reportPodcastEpisode(8, 'safety');
    expect(api.post).toHaveBeenNthCalledWith(1, '/api/v2/podcasts/2/subscribe', { notify_new_episodes: true });
    expect(api.post).toHaveBeenNthCalledWith(2, '/api/v2/podcasts/episodes/8/reaction', { reaction: 'like' });
    expect(api.post).toHaveBeenNthCalledWith(3, '/api/v2/podcasts/episodes/8/report', { reason: 'safety' });
  });
});

describe('podcast studio API', () => {
  let appendSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    appendSpy = jest.spyOn(FormData.prototype, 'append');
  });

  afterEach(() => appendSpy.mockRestore());

  it('returns BOTH the authored shows and the studio capabilities that ride in meta', async () => {
    jest.mocked(api.get).mockResolvedValue({
      data: [{ id: 2, title: 'Time stories', slug: 'time-stories' }],
      meta: { can_create_show: false, max_audio_size_mb: 120, enable_chapters: true, allowed_audio_mimes: ['audio/mpeg'] },
    });

    // 🔴 Dropping `meta` here would silently offer members creation, chapters
    // and transcripts their community has switched off.
    await expect(getAuthoredPodcasts()).resolves.toEqual({
      shows: [{ id: 2, title: 'Time stories', slug: 'time-stories' }],
      capabilities: { can_create_show: false, max_audio_size_mb: 120, enable_chapters: true, allowed_audio_mimes: ['audio/mpeg'] },
    });
    expect(api.get).toHaveBeenCalledWith('/api/v2/podcasts/mine');
  });

  it('survives a bare array body, and a body with no meta, without throwing', async () => {
    jest.mocked(api.get)
      .mockResolvedValueOnce([{ id: 2, title: 'Time stories', slug: 'time-stories' }])
      .mockResolvedValueOnce({ data: [] });

    await expect(getAuthoredPodcasts()).resolves.toEqual({ shows: [{ id: 2, title: 'Time stories', slug: 'time-stories' }], capabilities: {} });
    await expect(getAuthoredPodcasts()).resolves.toEqual({ shows: [], capabilities: {} });
  });

  it('uses the creator-facing feed and stats endpoints, not the admin ones', async () => {
    jest.mocked(api.get)
      .mockResolvedValueOnce({ data: { valid: false, errors: ['missing_artwork'], warnings: [], skipped_episode_count: 1 } })
      .mockResolvedValueOnce({ data: { enabled: true, days: 7 } });

    await expect(validatePodcastFeed(2)).resolves.toMatchObject({ valid: false, skipped_episode_count: 1 });
    await expect(getPodcastShowStats(2, 7)).resolves.toMatchObject({ enabled: true, days: 7 });
    expect(api.get).toHaveBeenNthCalledWith(1, '/api/v2/podcasts/2/validate-feed');
    expect(api.get).toHaveBeenNthCalledWith(2, '/api/v2/podcasts/2/stats', { days: '7' });
  });

  it('creates and updates a show on the shared /v2/podcasts contract', async () => {
    jest.mocked(api.post).mockResolvedValue({ data: { id: 5, title: 'Neighbourhood radio' } });
    jest.mocked(api.put).mockResolvedValue({ data: { id: 5, title: 'Renamed' } });

    await expect(createPodcastShow({ title: 'Neighbourhood radio', visibility: 'members' })).resolves.toMatchObject({ id: 5 });
    await expect(updatePodcastShow(5, { title: 'Renamed' })).resolves.toMatchObject({ title: 'Renamed' });
    expect(api.post).toHaveBeenCalledWith('/api/v2/podcasts', { title: 'Neighbourhood radio', visibility: 'members' });
    expect(api.put).toHaveBeenCalledWith('/api/v2/podcasts/5', { title: 'Renamed' });
  });

  it('creates and updates an episode under its own show', async () => {
    jest.mocked(api.post).mockResolvedValue({ data: { id: 9, title: 'Episode one' } });
    jest.mocked(api.put).mockResolvedValue({ data: { id: 9, title: 'Episode one, revised' } });

    await expect(createPodcastEpisode(5, {
      title: 'Episode one',
      audio_url: 'https://example.org/one.mp3',
      chapters: [{ title: 'Welcome', starts_at_seconds: 30, position: 0 }],
    })).resolves.toMatchObject({ id: 9 });
    await expect(updatePodcastEpisode(5, 9, { title: 'Episode one, revised' })).resolves.toMatchObject({ id: 9 });

    expect(api.post).toHaveBeenCalledWith('/api/v2/podcasts/5/episodes', {
      title: 'Episode one',
      audio_url: 'https://example.org/one.mp3',
      chapters: [{ title: 'Welcome', starts_at_seconds: 30, position: 0 }],
    });
    expect(api.put).toHaveBeenCalledWith('/api/v2/podcasts/5/episodes/9', { title: 'Episode one, revised' });
  });

  it('publishes, archives and deletes shows and episodes on their own endpoints', async () => {
    jest.mocked(api.post).mockResolvedValue({ data: { id: 5 } });
    jest.mocked(api.delete).mockResolvedValue({ data: { deleted: true } });

    await publishPodcastShow(5);
    await archivePodcastShow(5);
    await publishPodcastEpisode(5, 9);
    await archivePodcastEpisode(5, 9);
    await expect(deletePodcastEpisode(5, 9)).resolves.toEqual({ deleted: true });
    await expect(deletePodcastShow(5)).resolves.toEqual({ deleted: true });

    expect(api.post).toHaveBeenNthCalledWith(1, '/api/v2/podcasts/5/publish', {});
    expect(api.post).toHaveBeenNthCalledWith(2, '/api/v2/podcasts/5/archive', {});
    expect(api.post).toHaveBeenNthCalledWith(3, '/api/v2/podcasts/5/episodes/9/publish', {});
    expect(api.post).toHaveBeenNthCalledWith(4, '/api/v2/podcasts/5/episodes/9/archive', {});
    expect(api.delete).toHaveBeenNthCalledWith(1, '/api/v2/podcasts/5/episodes/9');
    expect(api.delete).toHaveBeenNthCalledWith(2, '/api/v2/podcasts/5');
  });

  it('uploads artwork and cover images as multipart on the field name the API reads', async () => {
    jest.mocked(api.upload).mockResolvedValue({ data: { url: '/uploads/podcasts/a.png' } });

    await expect(uploadPodcastShowArtwork(5, 'file:///tmp/cover.png')).resolves.toEqual({ url: '/uploads/podcasts/a.png' });
    await uploadPodcastEpisodeCover(5, 9, 'file:///tmp/shot.jpg');

    expect(api.upload).toHaveBeenNthCalledWith(1, '/api/v2/podcasts/5/artwork', expect.any(FormData));
    expect(api.upload).toHaveBeenNthCalledWith(2, '/api/v2/podcasts/5/episodes/9/cover', expect.any(FormData));

    // PodcastController::storePodcastImage reads request()->file('image'), so
    // the part name is not negotiable — and the file needs a real name and MIME
    // or the server-side content check rejects it. The whatwg FormData used in
    // tests stringifies the React Native file object, so the appended value is
    // captured at the call instead of read back off the form.
    expect(appendSpy.mock.calls[0][0]).toBe('image');
    expect(appendSpy.mock.calls[0][1]).toMatchObject({ uri: 'file:///tmp/cover.png', name: 'cover.png', type: 'image/png' });
    expect(appendSpy.mock.calls[1][0]).toBe('image');
    expect(appendSpy.mock.calls[1][1]).toMatchObject({ name: 'shot.jpg', type: 'image/jpeg' });
  });

  it('falls back to a usable filename when the picked URI has no extension', async () => {
    jest.mocked(api.upload).mockResolvedValue({ data: { url: '/uploads/podcasts/a.jpg' } });

    await uploadPodcastShowArtwork(5, 'content://media/external/images/9182');

    expect(appendSpy.mock.calls[0][1]).toMatchObject({ name: 'podcast.jpg', type: 'image/jpeg' });
  });

  describe('createPodcastEpisodeWithAudio', () => {
    /*
      🔴 A recording stand-in for FormData, and it is not laziness. On a device,
      React Native's FormData keeps a file part as the `{ uri, name, type }` object
      it was handed. jsdom's FormData — what Jest gives us — coerces that object to
      the string "[object Object]", so asserting against it would prove nothing
      about the shape the API actually receives. This records values untouched.
    */
    class RecordingFormData {
      parts: [string, unknown][] = [];
      append(key: string, value: unknown): void { this.parts.push([key, value]); }
    }
    const realFormData = globalThis.FormData;

    function partsOf(form: FormData): Record<string, unknown> {
      const out: Record<string, unknown> = {};
      (form as unknown as RecordingFormData).parts.forEach(([key, value]) => { out[key] = value; });
      return out;
    }

    beforeEach(() => {
      (globalThis as { FormData: unknown }).FormData = RecordingFormData;
      jest.mocked(uploadWithProgress).mockResolvedValue({ data: { id: 41, title: 'Episode one' } } as never);
    });

    afterEach(() => { (globalThis as { FormData: unknown }).FormData = realFormData; });

    /**
     * 🔴 The part MUST be named `audio`. `PodcastController::storeEpisode` reads
     * `request()->file('audio')`; a differently-named part is not an error — the
     * controller sees no file and refuses with "audio URL required" instead.
     */
    it('sends the file as the `audio` part and never alongside an audio_url', async () => {
      await createPodcastEpisodeWithAudio(
        3,
        { title: 'Episode one', summary: 'A summary', explicit: false },
        { uri: 'file:///cache/ep.m4a', name: 'ep.m4a', mimeType: 'audio/x-m4a' },
      );

      expect(uploadWithProgress).toHaveBeenCalledWith('/api/v2/podcasts/3/episodes', expect.anything(), {});
      const parts = partsOf(jest.mocked(uploadWithProgress).mock.calls[0]![1] as FormData);
      expect(parts.audio).toMatchObject({ uri: 'file:///cache/ep.m4a', name: 'ep.m4a', type: 'audio/x-m4a' });
      expect(parts.audio_url).toBeUndefined();
      expect(parts.title).toBe('Episode one');
      expect(parts.summary).toBe('A summary');
    });

    it('JSON-encodes chapters and drops empty fields, as PHP expects', async () => {
      await createPodcastEpisodeWithAudio(
        3,
        { title: 'Episode one', summary: '', description: undefined, chapters: [{ title: 'Intro', starts_at_seconds: 0, position: 0 }] },
        { uri: 'file:///cache/ep.m4a', name: 'ep.m4a', mimeType: 'audio/x-m4a' },
      );

      const parts = partsOf(jest.mocked(uploadWithProgress).mock.calls[0]![1] as FormData);
      expect(parts.chapters).toBe('[{"title":"Intro","starts_at_seconds":0,"position":0}]');
      expect(parts.summary).toBeUndefined();
      expect(parts.description).toBeUndefined();
    });

    it('declares a type the server can sniff when the device reported none', async () => {
      await createPodcastEpisodeWithAudio(
        3,
        { title: 'Episode one' },
        { uri: 'file:///cache/ep', name: 'ep', mimeType: '' },
      );

      const parts = partsOf(jest.mocked(uploadWithProgress).mock.calls[0]![1] as FormData);
      expect(parts.audio).toMatchObject({ type: 'application/octet-stream' });
    });

    it('passes progress and cancellation through, and unwraps the created episode', async () => {
      const onProgress = jest.fn();
      const controller = new AbortController();

      await expect(createPodcastEpisodeWithAudio(
        3,
        { title: 'Episode one' },
        { uri: 'file:///cache/ep.m4a', name: 'ep.m4a', mimeType: 'audio/x-m4a' },
        { onProgress, signal: controller.signal },
      )).resolves.toMatchObject({ id: 41 });

      expect(uploadWithProgress).toHaveBeenCalledWith(
        '/api/v2/podcasts/3/episodes',
        expect.anything(),
        { onProgress, signal: controller.signal },
      );
    });
  });
});
