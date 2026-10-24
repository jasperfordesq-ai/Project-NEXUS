// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Podcast cards on the accessible feed link to the podcast, as the React feed's
 * "View podcast show" / "Listen to episode" button does.
 *
 * Until 2026-10-24 this feed had no link for podcast_show / podcast_episode rows,
 * so a published podcast appeared as an unlinked "Activity" card. Pins the
 * label, the destination (numeric-id routes this frontend serves), and the
 * fallback when an older API response carries no show_id.
 */

const path = require('path');
const express = require('express');
const session = require('express-session');
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
    ApiOfflineError: class ApiOfflineError extends Error {
      constructor(message = 'Unable to connect') {
        super(message);
        this.name = 'ApiOfflineError';
        this.status = 503;
      }
    },
    getFeedPosts: jest.fn(),
    getFeedPostV2: jest.fn(),
    getFeedItemV2: jest.fn(),
    getFeedHashtags: jest.fn(),
    getFeedHashtagPosts: jest.fn(),
    getComments: jest.fn(),
    getProfile: jest.fn(),
    getTenantBootstrap: jest.fn(),
    invalidateUserCache: jest.fn()
  };
});

const api = require('../src/lib/api');
const feedRoutes = require('../src/routes/feed');

const PREFIX = '/acme/accessible';
const MOUNT = `${PREFIX}/feed`;
const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');

function buildApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  // Deliberately dumb filters: a formatting change must not be able to make an
  // exclusion assertion pass or fail.
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));
  env.addFilter('string', String);
  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: 'feed-podcast-link-test-secret',
    resave: false,
    saveUninitialized: false,
    name: 'feed-podcast-link-test.sid'
  }));

  app.use(MOUNT, (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.accessibleRouting = {
      mode: 'shared',
      tenantSlug: 'acme',
      tenant: { id: 2, slug: 'acme', name: 'Acme Timebank' },
      prefix: PREFIX
    };
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
      currentPath: MOUNT,
      alphaLocaleOptions: [],
      alphaLanguageQueryParams: [],
      htmlLang: 'en',
      htmlDirection: 'ltr',
      t: createTranslator('en'),
      tc: createChoiceTranslator('en'),
      formatLocaleNumber: (value) => String(value ?? ''),
      formatLocaleDate: (value) => String(value ?? '')
    });
    next();
  }, feedRoutes);

  return app;
}

function feedRow(overrides) {
  return {
    id: 1,
    type: 'post',
    title: null,
    content: 'A real post from a real member',
    created_at: '2026-08-12T10:00:00Z',
    likes_count: 0,
    comments_count: 0,
    author: { id: 7, name: 'Test Member' },
    ...overrides
  };
}

describe('podcast cards on the accessible feed link to the podcast', () => {
  beforeEach(() => {
    api.getFeedPosts.mockReset();
    api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Member' } });
    api.getTenantBootstrap.mockResolvedValue({
      data: { id: 2, slug: 'acme', modules: { feed: true }, features: {} }
    });
    api.getFeedHashtags.mockResolvedValue({ data: [] });
    api.getComments.mockResolvedValue({ data: { comments: [] } });
  });

  it('shows "View podcast show" linking to the show page', async () => {
    api.getFeedPosts.mockResolvedValue({
      data: [feedRow({ id: 41, type: 'podcast_show', title: 'Community Voices', slug: 'community-voices' })],
      meta: { per_page: 20, has_more: false }
    });

    const page = await request(buildApp()).get(MOUNT);

    expect(page.status).toBe(200);
    expect(page.text).toContain('View podcast show');
    expect(page.text).toContain(`href="${PREFIX}/podcasts/41"`);
    expect(page.text).toContain('Podcast show');
  });

  it('shows "Listen to episode" linking to the episode inside its show', async () => {
    api.getFeedPosts.mockResolvedValue({
      data: [feedRow({ id: 88, type: 'podcast_episode', title: 'Episode one', show_id: 41, show_slug: 'community-voices', slug: 'episode-one' })],
      meta: { per_page: 20, has_more: false }
    });

    const page = await request(buildApp()).get(MOUNT);

    expect(page.status).toBe(200);
    expect(page.text).toContain('Listen to episode');
    expect(page.text).toContain(`href="${PREFIX}/podcasts/41/episodes/88"`);
  });

  it('falls back to the podcast directory when an episode has no show id', async () => {
    api.getFeedPosts.mockResolvedValue({
      data: [feedRow({ id: 89, type: 'podcast_episode', title: 'Episode two' })],
      meta: { per_page: 20, has_more: false }
    });

    const page = await request(buildApp()).get(MOUNT);

    expect(page.status).toBe(200);
    expect(page.text).toContain('Listen to episode');
    expect(page.text).toContain(`href="${PREFIX}/podcasts"`);
    expect(page.text).not.toContain('/podcasts/0/');
  });
});
