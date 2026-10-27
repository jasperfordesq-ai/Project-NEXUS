// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Podcasts in search (27 Oct 2026).
 *
 * React's SearchPage has a Podcasts tab and section when the community has podcasts on:
 * the unified search API returns `podcast_show` and `podcast_episode` rows
 * (SearchService::searchPodcasts) and accepts `type=podcasts`. The accessible search
 * dropped those rows on the floor. A search result carries slugs, while this frontend
 * routes podcasts by number, so an episode result goes through a small resolver that
 * looks the episode up and redirects to its page.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');
const request = require('supertest');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  return {
    ApiError,
    searchV2: jest.fn(),
    getSavedSearches: jest.fn(),
    getListingCategories: jest.fn(),
    getPopularListingTags: jest.fn(),
    saveSavedSearch: jest.fn(),
    deleteSavedSearch: jest.fn(),
    runSavedSearch: jest.fn(),
    callPodcastApi: jest.fn()
  };
});

jest.mock('../src/middleware/auth', () => ({ requireAuth: (req, res, next) => next() }));

const api = require('../src/lib/api');
const { createTranslator, createChoiceTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');
const searchRouter = require('../src/routes/search');

const t = createTranslator('en');
const viewsDir = path.join(__dirname, '..', 'src', 'views');
const env = nunjucks.configure(
  [viewsDir, path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
  { autoescape: true, noCache: true }
);
registerTemplateFilters(env);

function createApp(features = { podcasts: true }) {
  const app = express();
  app.use((req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.accessibleRouting = { tenant: { id: 2, slug: 'acme', features } };
    res.locals.t = t;
    res.locals.tc = createChoiceTranslator('en');
    res.locals.urlFor = (value) => value;
    res.locals.formatLocaleDate = (value) => String(value);
    res.render = (view, locals = {}) => res.json({ view, locals });
    next();
  });
  app.use('/search', searchRouter);
  return app;
}

function renderAdvanced(locals) {
  const source = fs.readFileSync(path.join(viewsDir, 'search/advanced.njk'), 'utf8');
  const imports = source.split('\n').filter((line) => line.startsWith('{% from')).join('\n');
  const start = source.indexOf('{% block content %}') + '{% block content %}'.length;
  const end = source.lastIndexOf('{% endblock %}');
  return env.renderString(`${imports}\n${source.slice(start, end)}`, {
    t,
    tc: createChoiceTranslator('en'),
    urlFor: (value) => value,
    csrfToken: 'test-csrf',
    ...locals,
    truncate: (value) => value,
    membersCountLabel: (count) => String(count),
    formatEventDate: (value) => String(value)
  });
}

const ROWS = [
  { type: 'listing', id: 1, title: 'Garden help' },
  { type: 'podcast_show', podcast_kind: 'show', id: 41, show_slug: 'community-voices', title: 'Community Voices', summary: 'Local stories' },
  { type: 'podcast_episode', podcast_kind: 'episode', id: 77, show_slug: 'community-voices', episode_slug: 'first-light', show_title: 'Community Voices', title: 'First light', summary: 'The opening episode' }
];

beforeEach(() => {
  jest.clearAllMocks();
  api.searchV2.mockResolvedValue({ data: ROWS, meta: { search: { total: 3 } } });
  api.getSavedSearches.mockResolvedValue({ data: [] });
  api.getListingCategories.mockResolvedValue({ data: [] });
  api.getPopularListingTags.mockResolvedValue({ data: [] });
});

describe('podcasts in the accessible search', () => {
  it('groups podcast shows and episodes into their own section with a tab, when podcasts are on', async () => {
    const response = await request(createApp()).get('/search/advanced?q=voices');
    const { locals } = response.body;

    expect(locals.podcastsEnabled).toBe(true);
    expect(locals.counts.podcasts).toBe(2);
    expect(locals.counts.all).toBe(3);
    expect(locals.tabHrefs.podcasts).toBe('/search/advanced?q=voices&tab=podcasts');
    expect(locals.grouped.podcasts.map((row) => row.href)).toEqual([
      '/podcasts/41',
      '/search/podcast-episode?show=community-voices&episode=first-light'
    ]);

    const html = renderAdvanced(locals);
    expect(html).toContain(t('govuk_alpha_search.results.tab_podcasts', { count: 2 }));
    expect(html).toContain(t('govuk_alpha_search.results.section_podcasts'));
    expect(html).toContain('href="/podcasts/41"');
    expect(html).toContain(t('govuk_alpha_search.results.episode_from', { show: 'Community Voices' }));
    expect(html).toContain('<option value="podcasts"');
  });

  it('shows only podcasts on the podcasts tab', async () => {
    const response = await request(createApp()).get('/search/advanced?q=voices&tab=podcasts');
    expect(response.body.locals.activeTab).toBe('podcasts');
    const html = renderAdvanced(response.body.locals);
    expect(html).toContain('First light');
    expect(html).not.toContain('Garden help');
  });

  it('asks the API for podcasts only when the type filter says so', async () => {
    await request(createApp()).get('/search/advanced?q=voices&type=podcasts');
    expect(api.searchV2).toHaveBeenCalledWith('test-token', expect.objectContaining({ type: 'podcasts' }));
  });

  it('offers nothing about podcasts when the community has them off', async () => {
    const response = await request(createApp({ podcasts: false })).get('/search/advanced?q=voices&tab=podcasts&type=podcasts');
    const { locals } = response.body;
    expect(locals.podcastsEnabled).toBe(false);
    expect(locals.activeTab).toBe('all');
    expect(api.searchV2).toHaveBeenCalledWith('test-token', expect.objectContaining({ type: 'all' }));
    expect(locals.grouped.podcasts).toEqual([]);
    const html = renderAdvanced(locals);
    expect(html).not.toContain('<option value="podcasts"');
    expect(html).not.toContain('tab=podcasts');
  });

  it('resolves an episode result to the numbered episode page', async () => {
    api.callPodcastApi.mockResolvedValue({ data: { id: 77, show_id: 41, slug: 'first-light' } });
    const response = await request(createApp()).get('/search/podcast-episode?show=community-voices&episode=first-light');
    expect(api.callPodcastApi).toHaveBeenCalledWith('test-token', 'GET', '/community-voices/first-light');
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/podcasts/41/episodes/77');
  });

  it('sends a missing or malformed episode to the podcast directory instead of failing', async () => {
    api.callPodcastApi.mockRejectedValue(new api.ApiError('Not found', 404));
    const missing = await request(createApp()).get('/search/podcast-episode?show=gone&episode=gone');
    expect(missing.headers.location).toBe('/podcasts');

    const malformed = await request(createApp()).get('/search/podcast-episode?show=../admin&episode=x');
    expect(api.callPodcastApi).toHaveBeenCalledTimes(1);
    expect(malformed.headers.location).toBe('/podcasts');
  });
});
