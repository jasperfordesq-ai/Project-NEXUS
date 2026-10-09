// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '@/lib/api';
import { podcastsApi } from './podcasts';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    upload: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const SHOW: import('./podcasts').PodcastShow = {
  id: 1,
  owner_user_id: 42,
  title: 'Timebank Stories',
  slug: 'timebank-stories',
  language: 'en',
  visibility: 'public',
  status: 'published',
  moderation_status: 'approved',
  episode_count: 5,
  subscriber_count: 120,
};

const EPISODE: import('./podcasts').PodcastEpisode = {
  id: 10,
  show_id: 1,
  author_user_id: 42,
  title: 'Episode One',
  slug: 'episode-one',
  audio_url: 'https://cdn.example.com/ep1.mp3',
  explicit: false,
  episode_type: 'full',
  visibility: 'inherit',
  status: 'published',
  moderation_status: 'approved',
  listen_count: 88,
};

// ---------------------------------------------------------------------------
// podcastsApi.browse
// ---------------------------------------------------------------------------

describe('podcastsApi.browse', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it('calls the correct endpoint with no params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: [] });
    await podcastsApi.browse();
    expect(api.get).toHaveBeenCalledWith('/v2/podcasts');
  });

  it('builds query string from all provided params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: [] });
    await podcastsApi.browse({ q: 'hello', category: 'tech', sort: 'newest', page: 2, per_page: 6 });
    expect(api.get).toHaveBeenCalledWith('/v2/podcasts?q=hello&category=tech&sort=newest&page=2&per_page=6');
  });

  it('omits undefined params from query string', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: [] });
    await podcastsApi.browse({ page: 1, category: undefined });
    expect(api.get).toHaveBeenCalledWith('/v2/podcasts?page=1');
  });

  it('normalises an array response + meta into PodcastPage', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: [SHOW],
      meta: { total: 50, current_page: 3, per_page: 10, has_more: true },
    });
    const result = await podcastsApi.browse({ page: 3, per_page: 10 });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      items: [SHOW],
      total: 50,
      page: 3,
      per_page: 10,
      has_more: true,
    });
  });

  it('falls back to array length when meta.total is missing', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: [SHOW, SHOW],
      meta: {},
    });
    const result = await podcastsApi.browse();
    expect(result.data?.total).toBe(2);
  });

  it('falls back to params.page when meta.current_page is absent', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: [SHOW],
      meta: {},
    });
    const result = await podcastsApi.browse({ page: 4 });
    expect(result.data?.page).toBe(4);
  });

  it('defaults page to 1 when meta and params are both absent', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: [SHOW],
    });
    const result = await podcastsApi.browse();
    expect(result.data?.page).toBe(1);
  });

  it('defaults per_page to 12 when meta and params are both absent', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: [SHOW],
    });
    const result = await podcastsApi.browse();
    expect(result.data?.per_page).toBe(12);
  });

  it('has_more defaults to false when meta.has_more is falsy', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: [SHOW],
      meta: {},
    });
    const result = await podcastsApi.browse();
    expect(result.data?.has_more).toBe(false);
  });

  it('passes a pre-shaped PodcastPage response through unchanged', async () => {
    const page: import('./podcasts').PodcastPage<import('./podcasts').PodcastShow> = {
      items: [SHOW],
      total: 1,
      page: 1,
      per_page: 12,
      has_more: false,
    };
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: page });
    const result = await podcastsApi.browse();
    expect(result.data).toBe(page);
  });

  it('returns an error shape when success is false', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: false, error: 'Unauthorized', data: undefined });
    const result = await podcastsApi.browse();
    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
  });

  it('returns data: undefined when res.data is null/undefined', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: null });
    const result = await podcastsApi.browse();
    // success=true but no data — the normaliser returns { data: undefined }
    expect(result.data).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// podcastsApi.show
// ---------------------------------------------------------------------------

describe('podcastsApi.show', () => {
  beforeEach(() => { vi.mocked(api.get).mockReset(); });

  it('calls the correct endpoint', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: SHOW });
    await podcastsApi.show('timebank-stories');
    expect(api.get).toHaveBeenCalledWith('/v2/podcasts/timebank-stories');
  });

  it('URL-encodes the slug', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: SHOW });
    await podcastsApi.show('a slug/with spaces');
    expect(api.get).toHaveBeenCalledWith('/v2/podcasts/a%20slug%2Fwith%20spaces');
  });

  it('returns the api response directly', async () => {
    const response = { success: true, data: SHOW };
    vi.mocked(api.get).mockResolvedValueOnce(response);
    const result = await podcastsApi.show('timebank-stories');
    expect(result).toBe(response);
  });
});

// ---------------------------------------------------------------------------
// podcastsApi.episode
// ---------------------------------------------------------------------------

describe('podcastsApi.episode', () => {
  beforeEach(() => { vi.mocked(api.get).mockReset(); });

  it('calls the correct nested endpoint', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: EPISODE });
    await podcastsApi.episode('timebank-stories', 'episode-one');
    expect(api.get).toHaveBeenCalledWith('/v2/podcasts/timebank-stories/episode-one');
  });

  it('URL-encodes both slugs', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: EPISODE });
    await podcastsApi.episode('show slug', 'ep slug');
    expect(api.get).toHaveBeenCalledWith('/v2/podcasts/show%20slug/ep%20slug');
  });
});

// ---------------------------------------------------------------------------
// podcastsApi.authored
// ---------------------------------------------------------------------------

describe('podcastsApi.authored', () => {
  beforeEach(() => { vi.mocked(api.get).mockReset(); });

  it('calls /v2/podcasts/mine', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: [SHOW] });
    await podcastsApi.authored();
    expect(api.get).toHaveBeenCalledWith('/v2/podcasts/mine');
  });
});

// ---------------------------------------------------------------------------
// podcastsApi.createShow
// ---------------------------------------------------------------------------

describe('podcastsApi.createShow', () => {
  beforeEach(() => { vi.mocked(api.post).mockReset(); });

  it('POSTs to /v2/podcasts with the payload', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true, data: SHOW });
    const payload: import('./podcasts').CreatePodcastShowPayload = {
      title: 'My Show',
      language: 'en',
      visibility: 'members',
    };
    await podcastsApi.createShow(payload);
    expect(api.post).toHaveBeenCalledWith('/v2/podcasts', payload);
  });
});

// ---------------------------------------------------------------------------
// podcastsApi.updateShow
// ---------------------------------------------------------------------------

describe('podcastsApi.updateShow', () => {
  beforeEach(() => { vi.mocked(api.put).mockReset(); });

  it('PUTs to /v2/podcasts/:id with partial payload', async () => {
    vi.mocked(api.put).mockResolvedValueOnce({ success: true, data: SHOW });
    await podcastsApi.updateShow(1, { title: 'Updated Title' });
    expect(api.put).toHaveBeenCalledWith('/v2/podcasts/1', { title: 'Updated Title' });
  });
});

describe('podcastsApi artwork uploads', () => {
  it('uploads show artwork to the owner-bound endpoint', async () => {
    const image = new File(['image'], 'cover.png', { type: 'image/png' });
    vi.mocked(api.upload).mockResolvedValueOnce({ success: true, data: { url: '/uploads/podcasts/cover.png' } });

    await podcastsApi.uploadShowArtwork(4, image);

    expect(api.upload).toHaveBeenCalledWith('/v2/podcasts/4/artwork', image, 'image');
  });

  it('uploads an episode cover to the owner-bound endpoint', async () => {
    const image = new File(['image'], 'episode.png', { type: 'image/png' });
    vi.mocked(api.upload).mockResolvedValueOnce({ success: true, data: { url: '/uploads/podcasts/episode.png' } });

    await podcastsApi.uploadEpisodeCover(4, 9, image);

    expect(api.upload).toHaveBeenCalledWith('/v2/podcasts/4/episodes/9/cover', image, 'image');
  });
});

// ---------------------------------------------------------------------------
// podcastsApi.publishShow
// ---------------------------------------------------------------------------

describe('podcastsApi.publishShow', () => {
  beforeEach(() => { vi.mocked(api.post).mockReset(); });

  it('POSTs to /v2/podcasts/:id/publish with empty body', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true, data: SHOW });
    await podcastsApi.publishShow(1);
    expect(api.post).toHaveBeenCalledWith('/v2/podcasts/1/publish', {});
  });
});

// ---------------------------------------------------------------------------
// podcastsApi.archiveShow
// ---------------------------------------------------------------------------

describe('podcastsApi.archiveShow', () => {
  beforeEach(() => { vi.mocked(api.post).mockReset(); });

  it('POSTs to /v2/podcasts/:id/archive with empty body', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true, data: SHOW });
    await podcastsApi.archiveShow(1);
    expect(api.post).toHaveBeenCalledWith('/v2/podcasts/1/archive', {});
  });
});

// ---------------------------------------------------------------------------
// podcastsApi.deleteShow
// ---------------------------------------------------------------------------

describe('podcastsApi.deleteShow', () => {
  beforeEach(() => { vi.mocked(api.delete).mockReset(); });

  it('DELETEs /v2/podcasts/:id', async () => {
    vi.mocked(api.delete).mockResolvedValueOnce({ success: true, data: { deleted: true } });
    await podcastsApi.deleteShow(1);
    expect(api.delete).toHaveBeenCalledWith('/v2/podcasts/1');
  });

  it('returns the deleted flag from the response', async () => {
    vi.mocked(api.delete).mockResolvedValueOnce({ success: true, data: { deleted: true } });
    const result = await podcastsApi.deleteShow(1);
    expect(result.data?.deleted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// podcastsApi.toggleSubscription
// ---------------------------------------------------------------------------

describe('podcastsApi.toggleSubscription', () => {
  beforeEach(() => { vi.mocked(api.post).mockReset(); });

  it('POSTs to /v2/podcasts/:id/subscribe with notify_new_episodes=true by default', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true, data: { subscribed: true } });
    await podcastsApi.toggleSubscription(1);
    expect(api.post).toHaveBeenCalledWith('/v2/podcasts/1/subscribe', { notify_new_episodes: true });
  });

  it('passes notify_new_episodes=false when explicitly set', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true, data: { subscribed: false } });
    await podcastsApi.toggleSubscription(1, false);
    expect(api.post).toHaveBeenCalledWith('/v2/podcasts/1/subscribe', { notify_new_episodes: false });
  });
});

// ---------------------------------------------------------------------------
// podcastsApi.createEpisode — JSON path
// ---------------------------------------------------------------------------

describe('podcastsApi.createEpisode (JSON path, no audio_file)', () => {
  beforeEach(() => { vi.mocked(api.post).mockReset(); });

  it('POSTs to /v2/podcasts/:showId/episodes with the payload', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true, data: EPISODE });
    const payload: import('./podcasts').CreatePodcastEpisodePayload = {
      title: 'Episode 1',
      audio_url: 'https://cdn.example.com/ep1.mp3',
    };
    await podcastsApi.createEpisode(1, payload);
    expect(api.post).toHaveBeenCalledWith('/v2/podcasts/1/episodes', payload);
  });

  it('returns the episode data', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true, data: EPISODE });
    const result = await podcastsApi.createEpisode(1, {
      title: 'Episode 1',
      audio_url: 'https://cdn.example.com/ep1.mp3',
    });
    expect(result.data).toEqual(EPISODE);
  });
});

// ---------------------------------------------------------------------------
// podcastsApi.createEpisode — FormData / upload path
// ---------------------------------------------------------------------------

describe('podcastsApi.createEpisode (upload path, with audio_file)', () => {
  beforeEach(() => {
    vi.mocked(api.upload).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it('calls api.upload (not api.post) when audio_file is provided', async () => {
    vi.mocked(api.upload).mockResolvedValueOnce({ success: true, data: EPISODE });
    const fakeFile = new File(['audio'], 'ep.mp3', { type: 'audio/mpeg' });
    await podcastsApi.createEpisode(1, {
      title: 'Episode with file',
      audio_url: '',
      audio_file: fakeFile,
    });
    expect(api.post).not.toHaveBeenCalled();
    expect(api.upload).toHaveBeenCalled();
  });

  it('passes the show endpoint to api.upload', async () => {
    vi.mocked(api.upload).mockResolvedValueOnce({ success: true, data: EPISODE });
    const fakeFile = new File(['audio'], 'ep.mp3', { type: 'audio/mpeg' });
    await podcastsApi.createEpisode(99, {
      title: 'Episode with file',
      audio_url: '',
      audio_file: fakeFile,
    });
    const [uploadedEndpoint] = vi.mocked(api.upload).mock.calls[0]!;
    expect(uploadedEndpoint).toBe('/v2/podcasts/99/episodes');
  });

  it('passes the file field name "file" to api.upload', async () => {
    vi.mocked(api.upload).mockResolvedValueOnce({ success: true, data: EPISODE });
    const fakeFile = new File(['audio'], 'ep.mp3', { type: 'audio/mpeg' });
    await podcastsApi.createEpisode(1, {
      title: 'Episode with file',
      audio_url: '',
      audio_file: fakeFile,
    });
    const [, , fieldName] = vi.mocked(api.upload).mock.calls[0]!;
    expect(fieldName).toBe('file');
  });

  it('passes FormData as second argument to api.upload', async () => {
    vi.mocked(api.upload).mockResolvedValueOnce({ success: true, data: EPISODE });
    const fakeFile = new File(['audio'], 'ep.mp3', { type: 'audio/mpeg' });
    await podcastsApi.createEpisode(1, {
      title: 'Episode with file',
      audio_url: '',
      audio_file: fakeFile,
    });
    const [, formData] = vi.mocked(api.upload).mock.calls[0]!;
    expect(formData).toBeInstanceOf(FormData);
  });

  it('passes onProgress options when a callback is supplied', async () => {
    vi.mocked(api.upload).mockResolvedValueOnce({ success: true, data: EPISODE });
    const fakeFile = new File(['audio'], 'ep.mp3', { type: 'audio/mpeg' });
    const onProgress = vi.fn();
    await podcastsApi.createEpisode(1, {
      title: 'Episode with file',
      audio_url: '',
      audio_file: fakeFile,
    }, onProgress);
    const [, , , options] = vi.mocked(api.upload).mock.calls[0]!;
    expect(options).toBeDefined();
    expect(options).toHaveProperty('onUploadProgress', onProgress);
  });

  it('passes undefined options when no progress callback supplied', async () => {
    vi.mocked(api.upload).mockResolvedValueOnce({ success: true, data: EPISODE });
    const fakeFile = new File(['audio'], 'ep.mp3', { type: 'audio/mpeg' });
    await podcastsApi.createEpisode(1, {
      title: 'Episode with file',
      audio_url: '',
      audio_file: fakeFile,
    });
    const [, , , options] = vi.mocked(api.upload).mock.calls[0]!;
    expect(options).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// podcastsApi.updateEpisode
// ---------------------------------------------------------------------------

describe('podcastsApi.updateEpisode', () => {
  beforeEach(() => { vi.mocked(api.put).mockReset(); });

  it('PUTs to /v2/podcasts/:showId/episodes/:episodeId', async () => {
    vi.mocked(api.put).mockResolvedValueOnce({ success: true, data: EPISODE });
    await podcastsApi.updateEpisode(1, 10, { title: 'Updated Episode' });
    expect(api.put).toHaveBeenCalledWith('/v2/podcasts/1/episodes/10', { title: 'Updated Episode' });
  });
});

// ---------------------------------------------------------------------------
// podcastsApi.publishEpisode
// ---------------------------------------------------------------------------

describe('podcastsApi.publishEpisode', () => {
  beforeEach(() => { vi.mocked(api.post).mockReset(); });

  it('POSTs to /v2/podcasts/:showId/episodes/:episodeId/publish', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true, data: EPISODE });
    await podcastsApi.publishEpisode(1, 10);
    expect(api.post).toHaveBeenCalledWith('/v2/podcasts/1/episodes/10/publish', {});
  });
});

// ---------------------------------------------------------------------------
// podcastsApi.archiveEpisode
// ---------------------------------------------------------------------------

describe('podcastsApi.archiveEpisode', () => {
  beforeEach(() => { vi.mocked(api.post).mockReset(); });

  it('POSTs to /v2/podcasts/:showId/episodes/:episodeId/archive', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true, data: EPISODE });
    await podcastsApi.archiveEpisode(1, 10);
    expect(api.post).toHaveBeenCalledWith('/v2/podcasts/1/episodes/10/archive', {});
  });
});

// ---------------------------------------------------------------------------
// podcastsApi.deleteEpisode
// ---------------------------------------------------------------------------

describe('podcastsApi.deleteEpisode', () => {
  beforeEach(() => { vi.mocked(api.delete).mockReset(); });

  it('DELETEs /v2/podcasts/:showId/episodes/:episodeId', async () => {
    vi.mocked(api.delete).mockResolvedValueOnce({ success: true, data: { deleted: true } });
    await podcastsApi.deleteEpisode(1, 10);
    expect(api.delete).toHaveBeenCalledWith('/v2/podcasts/1/episodes/10');
  });

  it('returns the deleted flag', async () => {
    vi.mocked(api.delete).mockResolvedValueOnce({ success: true, data: { deleted: true } });
    const result = await podcastsApi.deleteEpisode(1, 10);
    expect(result.data?.deleted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// podcastsApi.recordListen
// ---------------------------------------------------------------------------

describe('podcastsApi.recordListen', () => {
  beforeEach(() => { vi.mocked(api.post).mockReset(); });

  it('POSTs to /v2/podcasts/episodes/:episodeId/listen', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true, data: { recorded: true } });
    await podcastsApi.recordListen(10, { listened_seconds: 90, completed: false });
    expect(api.post).toHaveBeenCalledWith('/v2/podcasts/episodes/10/listen', {
      listened_seconds: 90,
      completed: false,
    });
  });

  it('forwards all listen fields', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true, data: { recorded: true } });
    await podcastsApi.recordListen(10, { listened_seconds: 300, completed: true, session_id: 'abc123' });
    expect(api.post).toHaveBeenCalledWith('/v2/podcasts/episodes/10/listen', {
      listened_seconds: 300,
      completed: true,
      session_id: 'abc123',
    });
  });
});

// ---------------------------------------------------------------------------
// podcastsApi.toggleReaction
// ---------------------------------------------------------------------------

describe('podcastsApi.toggleReaction', () => {
  beforeEach(() => { vi.mocked(api.post).mockReset(); });

  it('POSTs to /v2/podcasts/episodes/:episodeId/reaction with default reaction "like"', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true, data: { active: true } });
    await podcastsApi.toggleReaction(10);
    expect(api.post).toHaveBeenCalledWith('/v2/podcasts/episodes/10/reaction', { reaction: 'like' });
  });

  it('passes a custom reaction type', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true, data: { active: false } });
    await podcastsApi.toggleReaction(10, 'love');
    expect(api.post).toHaveBeenCalledWith('/v2/podcasts/episodes/10/reaction', { reaction: 'love' });
  });
});

// ---------------------------------------------------------------------------
// podcastsApi.reportEpisode
// ---------------------------------------------------------------------------

describe('podcastsApi.reportEpisode', () => {
  beforeEach(() => { vi.mocked(api.post).mockReset(); });

  it('POSTs to /v2/podcasts/episodes/:episodeId/report', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });
    await podcastsApi.reportEpisode(10, { reason: 'spam', details: 'Repetitive content' });
    expect(api.post).toHaveBeenCalledWith('/v2/podcasts/episodes/10/report', {
      reason: 'spam',
      details: 'Repetitive content',
    });
  });

  it('sends a report with only a reason', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });
    await podcastsApi.reportEpisode(10, { reason: 'misinformation' });
    expect(api.post).toHaveBeenCalledWith('/v2/podcasts/episodes/10/report', { reason: 'misinformation' });
  });
});

// ---------------------------------------------------------------------------
// podcastsApi.resolveReport
// ---------------------------------------------------------------------------

describe('podcastsApi.resolveReport', () => {
  beforeEach(() => { vi.mocked(api.post).mockReset(); });

  it('POSTs to /v2/admin/podcasts/reports/:episodeId/resolve with default status "resolved"', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      success: true,
      data: { episode_id: 10, open_reports: 0 },
    });
    await podcastsApi.resolveReport(10);
    expect(api.post).toHaveBeenCalledWith('/v2/admin/podcasts/reports/10/resolve', { status: 'resolved' });
  });

  it('passes custom resolution status', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      success: true,
      data: { episode_id: 10, open_reports: 2 },
    });
    await podcastsApi.resolveReport(10, 'escalated');
    expect(api.post).toHaveBeenCalledWith('/v2/admin/podcasts/reports/10/resolve', { status: 'escalated' });
  });

  it('returns open_reports from the response', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      success: true,
      data: { episode_id: 10, open_reports: 3 },
    });
    const result = await podcastsApi.resolveReport(10, 'dismissed');
    expect(result.data?.open_reports).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// podcastsApi.validateFeed
// ---------------------------------------------------------------------------

describe('podcastsApi.validateFeed', () => {
  beforeEach(() => { vi.mocked(api.get).mockReset(); });

  it('GETs /v2/admin/podcasts/shows/:showId/validate-feed', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: { valid: true, errors: [], warnings: [] },
    });
    await podcastsApi.validateFeed(1);
    expect(api.get).toHaveBeenCalledWith('/v2/admin/podcasts/shows/1/validate-feed');
  });

  it('returns validation data with errors and warnings', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: { valid: false, errors: ['Missing artwork'], warnings: ['No description'] },
    });
    const result = await podcastsApi.validateFeed(1);
    expect(result.data?.valid).toBe(false);
    expect(result.data?.errors).toEqual(['Missing artwork']);
    expect(result.data?.warnings).toEqual(['No description']);
  });
});

// ---------------------------------------------------------------------------
// podcastsApi creator endpoints — validateShowFeed / showStats / abort signal
// ---------------------------------------------------------------------------

describe('podcastsApi creator endpoints', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.upload).mockReset();
  });

  it('GETs the creator feed-validation endpoint', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: { valid: true, errors: [], warnings: [], skipped_episode_count: 0 },
    });
    await podcastsApi.validateShowFeed(7);
    expect(api.get).toHaveBeenCalledWith('/v2/podcasts/7/validate-feed');
  });

  it('GETs show stats with a clamped days parameter', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: { enabled: true } });
    await podcastsApi.showStats(7, 14);
    expect(api.get).toHaveBeenCalledWith('/v2/podcasts/7/stats?days=14');
  });

  it('defaults show stats to 30 days', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: { enabled: true } });
    await podcastsApi.showStats(7);
    expect(api.get).toHaveBeenCalledWith('/v2/podcasts/7/stats?days=30');
  });

  it('forwards an AbortSignal to api.upload so uploads can be cancelled', async () => {
    vi.mocked(api.upload).mockResolvedValueOnce({ success: true, data: EPISODE });
    const fakeFile = new File(['audio'], 'ep.mp3', { type: 'audio/mpeg' });
    const controller = new AbortController();

    await podcastsApi.createEpisode(1, {
      title: 'Cancellable upload',
      audio_url: '',
      audio_file: fakeFile,
    }, undefined, controller.signal);

    const options = vi.mocked(api.upload).mock.calls[0][3] as { signal?: AbortSignal } | undefined;
    expect(options?.signal).toBe(controller.signal);
  });

  it('forwards progress callback and signal together', async () => {
    vi.mocked(api.upload).mockResolvedValueOnce({ success: true, data: EPISODE });
    const fakeFile = new File(['audio'], 'ep.mp3', { type: 'audio/mpeg' });
    const controller = new AbortController();
    const onProgress = vi.fn();

    await podcastsApi.createEpisode(1, {
      title: 'Progress + cancel',
      audio_url: '',
      audio_file: fakeFile,
    }, onProgress, controller.signal);

    const options = vi.mocked(api.upload).mock.calls[0][3] as { signal?: AbortSignal; onUploadProgress?: (p: number) => void };
    expect(options.signal).toBe(controller.signal);
    expect(options.onUploadProgress).toBe(onProgress);
  });
});
