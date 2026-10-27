// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A community that has switched the feed off must not be sent there from the
 * dashboard (React 5ebc3093). The quick link and the recent-posts panel were
 * rendered unconditionally, and /feed bounces such members straight back.
 */

const express = require('express');
const nunjucks = require('nunjucks');
const path = require('path');
const request = require('supertest');
const session = require('express-session');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');

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
    ApiOfflineError: class ApiOfflineError extends Error {},
    getOnboardingStatus: jest.fn(),
    getOnboardingConfig: jest.fn(),
    getOnboardingCategories: jest.fn(),
    getOnboardingSafeguardingOptions: jest.fn(),
    completeOnboarding: jest.fn(),
    uploadProfileAvatar: jest.fn(),
    updateProfile: jest.fn(),
    saveOnboardingSafeguarding: jest.fn(),
    getProfile: jest.fn(),
    invalidateUserCache: jest.fn(),
    getBalance: jest.fn(),
    getListings: jest.fn(),
    getFeedPosts: jest.fn(),
    getMyEvents: jest.fn(),
    getGamificationProfile: jest.fn(),
    getMyBadges: jest.fn(),
    getExchangeAttentionCount: jest.fn(),
    getMemberEndorsements: jest.fn(),
    getFeedSidebar: jest.fn(),
    getTopEndorsedMembers: jest.fn(),
    getConnectionSuggestions: jest.fn()
  };
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() })
}));

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, res, next) => {
    req.token = 'token:test';
    next();
  },
  clearAuthCookies: jest.fn()
}));

const api = require('../src/lib/api');
const dashboardRoutes = require('../src/routes/dashboard');

const viewsDirectory = path.join(__dirname, '..', 'src', 'views');
const govukViews = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');

function makeEnvironment() {
  const env = nunjucks.configure([viewsDirectory, govukViews], { autoescape: true, noCache: true });
  require('../src/lib/template-filters').registerTemplateFilters(env);
  env.addFilter('nl2br', (value) => value);
  env.addFilter('string', String);
  env.addFilter('urlencode', encodeURIComponent);
  return env;
}
const environment = makeEnvironment();

function localsFor(locale) {
  return {
    alphaFooterColumns: [],
    alphaNavItems: [],
    csrfToken: 'test-csrf-token',
    feedbackUrl: '#',
    isAuthenticated: true,
    serviceName: 'Project NEXUS',
    t: createTranslator(locale),
    tc: createChoiceTranslator(locale),
    tenantName: 'Acme Timebank',
    urlFor: (value) => String(value || '/'),
    htmlLang: locale,
    htmlDirection: 'ltr'
  };
}

/** An app that renders the real templates, so the test sees real HTML. */
function buildApp(mountPath, router, locale = 'en') {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'location-prompt-test', resave: false, saveUninitialized: false }));
  app.engine('njk', (file, options, callback) => {
    try {
      callback(null, environment.render(path.relative(viewsDirectory, file), options));
    } catch (error) {
      callback(error);
    }
  });
  app.set('view engine', 'njk');
  app.set('views', viewsDirectory);
  app.use(mountPath, (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.accessibleRouting = {
      mode: 'shared', tenantSlug: 'acme', prefix: '/acme/accessible',
      tenant: { id: 2, slug: 'acme', name: 'Acme Timebank', ...(global.__tenantFlags || {}) }
    };
    Object.assign(res.locals, localsFor(locale));
    next();
  }, router);
  return app;
}

describe('dashboard and a switched-off feed', () => {
  const app = () => buildApp('/dashboard', dashboardRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
    global.__tenantFlags = {};
    api.getProfile.mockResolvedValue({ data: { id: 1, first_name: 'Ann' } });
    api.getBalance.mockResolvedValue({ balance: 0 });
    api.getOnboardingStatus.mockResolvedValue({ data: { onboarding_completed: true } });
    api.getGamificationProfile.mockResolvedValue({ data: null });
    api.getMyBadges.mockResolvedValue({ data: [] });
    api.getListings.mockResolvedValue({ data: [] });
    api.getFeedPosts.mockResolvedValue({ data: [] });
    api.getMyEvents.mockResolvedValue({ data: [] });
    api.getExchangeAttentionCount.mockResolvedValue({ data: { count: 0, items: [] } });
    api.getMemberEndorsements.mockResolvedValue({ data: { endorsements: [] } });
  });

  afterAll(() => { delete global.__tenantFlags; });

  it('links to the feed when the feed is on', async () => {
    const res = await request(app()).get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/feed"');
    expect(res.text).toContain(createTranslator('en')('dashboard.recent_feed_title'));
  });

  it('offers no feed link, panel or feed request when the feed is off', async () => {
    global.__tenantFlags = { modules: { feed: false } };
    const res = await request(app()).get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('href="/feed"');
    expect(res.text).not.toContain(createTranslator('en')('dashboard.recent_feed_title'));
    expect(api.getFeedPosts).not.toHaveBeenCalled();
  });
});
