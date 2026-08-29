// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { getPodcastEpisode, getPodcastShow, getPodcastShows, recordPodcastListen, reportPodcastEpisode, togglePodcastReaction, togglePodcastSubscription } from './podcasts';

jest.mock('@/lib/api/client', () => ({ api: { get: jest.fn(), post: jest.fn() } }));

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
