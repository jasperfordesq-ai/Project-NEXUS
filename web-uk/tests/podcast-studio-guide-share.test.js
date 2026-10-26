// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Podcast studio guide, share links and the "Beta" module label — the React
 * changes 0d8e2b7d4 (21 Oct 2026) and 5837ea12e (2 Sep 2026), brought to the
 * accessible frontend on 26 Oct 2026.
 *
 * - The studio explains, step by step, how to publish and share, including the
 *   warning that links to web pages (Spotify, SoundCloud, Drive "share" links)
 *   will not play. Every step is open for a creator with no show yet.
 * - A published, approved show offers its share links as selectable text in a
 *   read-only field (no JavaScript, no clipboard needed): the members' show page
 *   and, for "Anyone" shows with RSS on, the podcast-app feed.
 * - Courses (list, course page) and Podcasts (list) carry a "Beta" label.
 */

const path = require('path');
const express = require('express');
const session = require('express-session');
const flash = require('express-flash');
const nunjucks = require('nunjucks');
const request = require('supertest');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  return {
    ApiError,
    callPodcastApi: jest.fn(),
    uploadPodcastArtwork: jest.fn(),
    uploadPodcastEpisode: jest.fn(),
    updatePodcastEpisode: jest.fn(),
    uploadPodcastEpisodeCover: jest.fn(),
    getProfile: jest.fn()
  };
});

const api = require('../src/lib/api');
const podcastRoutes = require('../src/routes/podcasts');

const PREFIX = '/acme/accessible';
const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');

function buildApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('nl2br', (value) => String(value || ''));
  env.addFilter('string', String);
  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'podcast-guide-share-test', resave: false, saveUninitialized: true }));
  app.use(flash());
  app.use(`${PREFIX}/podcasts`, (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'acme', tenant: { id: 2, slug: 'acme' }, prefix: PREFIX };
    res.locals.urlFor = (value) => {
      const target = String(value || '/');
      return target.startsWith(PREFIX) ? target : `${PREFIX}${target.startsWith('/') ? target : `/${target}`}`;
    };
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: 'Acme Timebank',
      isAuthenticated: true,
      csrfToken: 'test-csrf-token',
      alphaNavItems: [],
      feedbackUrl: `${PREFIX}/feedback`,
      currentPath: `${PREFIX}/podcasts`,
      alphaLocaleOptions: [],
      alphaLanguageQueryParams: [],
      htmlLang: 'en',
      htmlDirection: 'ltr',
      t,
      tc: createChoiceTranslator('en'),
      formatLocaleNumber: (value) => String(value ?? ''),
      formatLocaleDate: (value) => String(value ?? '')
    });
    next();
  }, podcastRoutes);
  return app;
}

function show(overrides = {}) {
  return {
    id: 5,
    slug: 'tests-show',
    title: 'Tests show',
    status: 'published',
    moderation_status: 'approved',
    visibility: 'public',
    episodes: [],
    ...overrides
  };
}

function mine(shows, meta = {}) {
  return {
    data: shows,
    meta: { can_create_show: true, enable_private_shows: true, enable_rss_feed: true, max_audio_size_mb: 120, ...meta }
  };
}

function routeApi(mineResult) {
  api.callPodcastApi.mockImplementation(async (_token, method, apiPath) => {
    if (method === 'GET' && apiPath === '/mine') return mineResult;
    if (method === 'GET' && apiPath === '') return { data: [], meta: {} };
    return { data: { enabled: false } };
  });
}

const app = buildApp();

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: 7, name: 'A Member' } });
});

describe('studio publishing guide', () => {
  it('opens every step for a creator with no show, with the web-page warning and real limits', async () => {
    routeApi(mine([]));
    const response = await request(app).get(`${PREFIX}/podcasts/studio`).set('Host', 'acme.example.test');

    expect(response.status).toBe(200);
    expect(response.text).toContain(t('govuk_alpha_commerce.podcast_studio.guide_title'));
    expect(response.text.match(/<details class="govuk-details" id="podcast-guide-[a-z]+" open>/g)).toHaveLength(5);
    expect(response.text).toContain('Links to web pages will not play here.');
    expect(response.text).toContain('govuk-warning-text');
    expect(response.text).toContain('up to 120 MB');
    // Quoted labels are this site's own.
    expect(response.text).toContain(`Choose &quot;${t('govuk_alpha_commerce.podcast_studio.visibility_public')}&quot;`);
    expect(response.text).toContain('Podcast app link (RSS)');
  });

  it('closes the steps once the creator has a show, and drops the RSS line when RSS is off', async () => {
    routeApi(mine([show()], { enable_rss_feed: false }));
    const response = await request(app).get(`${PREFIX}/podcasts/studio`).set('Host', 'acme.example.test');

    expect(response.text).not.toMatch(/<details class="govuk-details" id="podcast-guide-[a-z]+" open>/);
    expect(response.text).not.toContain('Podcast app link (RSS):');
  });
});

describe('share links', () => {
  it('shows the members show page and the public feed as read-only fields for a live public show', async () => {
    routeApi(mine([show()]));
    const response = await request(app).get(`${PREFIX}/podcasts/studio`).set('Host', 'acme.example.test');

    expect(response.text).toContain(t('govuk_alpha_commerce.podcast_studio.share_title'));
    expect(response.text).toMatch(/<input class="govuk-input" id="share-5-show" type="text" value="http:\/\/acme\.example\.test\/acme\/accessible\/podcasts\/5" readonly/);
    expect(response.text).toMatch(/id="share-5-feed" type="text" value="[^"]*\/api\/v2\/podcasts\/feed\/2\/tests-show\.xml" readonly/);
    expect(response.text).toContain(t('govuk_alpha_commerce.podcast_studio.share_feed_link_hint'));
  });

  it('offers no feed for a members-only show and says how to get one', async () => {
    routeApi(mine([show({ visibility: 'members' })]));
    const response = await request(app).get(`${PREFIX}/podcasts/studio/5`).set('Host', 'acme.example.test');

    expect(response.status).toBe(200);
    expect(response.text).toContain('id="share-5-show"');
    expect(response.text).not.toContain('id="share-5-feed"');
    expect(response.text).toContain('Set it to &quot;Anyone&quot; to get a podcast app link anyone can use.');
  });

  it('says links appear later for a draft or unapproved show', async () => {
    routeApi(mine([show({ status: 'draft' }), show({ id: 6, slug: 'other', moderation_status: 'pending' })]));
    const response = await request(app).get(`${PREFIX}/podcasts/studio`).set('Host', 'acme.example.test');

    expect(response.text).not.toContain('id="share-5-show"');
    expect(response.text).not.toContain('id="share-6-show"');
    expect(response.text.split(t('govuk_alpha_commerce.podcast_studio.share_not_ready')).length - 1).toBe(2);
  });

  it('keeps the audio link warning on the episode form', async () => {
    routeApi(mine([show()]));
    const response = await request(app).get(`${PREFIX}/podcasts/studio/5`).set('Host', 'acme.example.test');
    expect(response.text).toContain('not a link to a web page');
  });
});

describe('"Beta" module label', () => {
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, watch: false });
  registerTemplateFilters(env);

  it('renders the translated phase word as a tag', () => {
    const html = env.render('_module-stage-beta.njk', { t });
    expect(html).toMatch(/<strong class="govuk-tag govuk-tag--blue">\s*Beta\s*<\/strong>/);
    expect(env.render('_module-stage-beta.njk', { t: createTranslator('ga') })).toContain('Béite');
  });

  it.each(['courses/index.njk', 'courses/detail.njk', 'podcasts/index.njk'])('is included on %s', (view) => {
    const source = require('fs').readFileSync(path.join(VIEWS, view), 'utf8');
    expect(source).toContain('{% include "_module-stage-beta.njk" %}');
  });

  it('appears on the podcasts list page', async () => {
    api.callPodcastApi.mockResolvedValue({ data: [], meta: {} });
    const response = await request(app).get(`${PREFIX}/podcasts`);
    expect(response.status).toBe(200);
    expect(response.text).toMatch(/<strong class="govuk-tag govuk-tag--blue">\s*Beta\s*<\/strong>/);
  });
});
