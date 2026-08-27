// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Gamification milestones are not feed content on the accessible frontend either.
 *
 * `badge_earned` / `level_up` activity rows were rendered here as ordinary feed
 * cards. They were removed from the feed on every client on the owner's
 * instruction (2026-08-27).
 *
 * The Laravel API no longer serves them (FeedService::EXCLUDED_SOURCE_TYPES), so
 * this pins THIS frontend's own guard: handed a milestone by an older or cached
 * API response, the feed page must not render it — and must still render the
 * real content in the same response.
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
    secret: 'feed-milestone-exclusion-test-secret',
    resave: false,
    saveUninitialized: false,
    name: 'feed-milestone-exclusion-test.sid'
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

describe('the accessible feed never renders a gamification milestone', () => {
  beforeEach(() => {
    api.getFeedPosts.mockReset();
    api.getFeedHashtags.mockReset();
    api.getFeedHashtagPosts.mockReset();
    api.getComments.mockReset();
    api.getProfile.mockReset();
    api.getTenantBootstrap.mockReset();

    api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Member' } });
    api.getTenantBootstrap.mockResolvedValue({
      data: { id: 2, slug: 'acme', modules: { feed: true }, features: {} }
    });
    api.getFeedHashtags.mockResolvedValue({ data: [] });
    api.getComments.mockResolvedValue({ data: { comments: [] } });
  });

  it('drops badge and level cards and keeps the real content in the same page', async () => {
    api.getFeedPosts.mockResolvedValue({
      data: [
        feedRow({ id: 101, type: 'post', content: 'Piano needs moving on Thursday' }),
        feedRow({ id: 102, type: 'badge_earned', title: 'Gift Giver', content: 'Earned the "Gift Giver" badge!' }),
        feedRow({ id: 103, type: 'level_up', title: 'Level 7', content: 'Reached Level 7!' })
      ],
      meta: { per_page: 20, has_more: false }
    });

    const page = await request(buildApp()).get(MOUNT);

    expect(page.status).toBe(200);
    expect(page.text).toContain('Piano needs moving on Thursday');
    // The article id is built from type + id, so this is an exact per-card check
    // rather than a loose text match that a label map could satisfy.
    expect(page.text).toContain('feed-item-post-101');
    expect(page.text).not.toContain('feed-item-badge_earned-102');
    expect(page.text).not.toContain('feed-item-level_up-103');
    expect(page.text).not.toContain('Gift Giver');
    expect(page.text).not.toContain('Reached Level 7');
  });

  it('shows the empty state when a page contains nothing but milestones', async () => {
    api.getFeedPosts.mockResolvedValue({
      data: [
        feedRow({ id: 201, type: 'badge_earned', title: 'Gift Giver' }),
        feedRow({ id: 202, type: 'level_up', title: 'Level 7' })
      ],
      meta: { per_page: 20, has_more: false }
    });

    const page = await request(buildApp()).get(MOUNT);

    expect(page.status).toBe(200);
    expect(page.text).not.toContain('feed-item-badge_earned-201');
    expect(page.text).not.toContain('feed-item-level_up-202');
  });

  it('drops milestones from a hashtag feed too', async () => {
    api.getFeedHashtagPosts.mockResolvedValue({
      data: [
        feedRow({ id: 301, type: 'post', content: 'Gardening help offered this weekend' }),
        feedRow({ id: 302, type: 'badge_earned', title: 'Gift Giver', content: 'Earned the "Gift Giver" badge!' })
      ],
      meta: { per_page: 20, has_more: false }
    });

    const page = await request(buildApp()).get(`${MOUNT}/hashtag/gardening`);

    expect(page.status).toBe(200);
    expect(page.text).toContain('Gardening help offered this weekend');
    /*
     * 🔴 Asserted on the CONTENT, not on an `id="feed-item-<type>-<id>"` marker.
     * hashtag.njk hardcodes `feed-item-post-{{ item.id }}` for every row, so a
     * `not.toContain('feed-item-badge_earned-302')` assertion passes whether the
     * filter works or not. Verified by running this file with the filter
     * disabled: the type-marker version was the one test of the three that
     * still passed, i.e. it proved nothing.
     */
    expect(page.text).not.toContain('Gift Giver');
    expect(page.text).not.toContain('feed-item-post-302');
  });
});
