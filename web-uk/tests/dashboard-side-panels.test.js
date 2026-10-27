// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The React feed's side panel (FeedSidebar.tsx) shows community statistics,
 * suggested listings, top categories, the most endorsed members and "people you
 * may know". web-uk had none of them. They now sit on the dashboard, read from
 * the same endpoints with the same parameters React uses, behind the same gates,
 * and each one disappears on its own when its read fails or comes back empty.
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
    updateProfile: jest.fn(),
    getProfile: jest.fn(),
    invalidateUserCache: jest.fn(),
    getBalance: jest.fn(),
    getListings: jest.fn(),
    getFeedPosts: jest.fn(),
    getMyEvents: jest.fn(),
    getOnboardingStatus: jest.fn(),
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
const t = createTranslator('en');

const environment = (() => {
  const env = nunjucks.configure([viewsDirectory, govukViews], { autoescape: true, noCache: true });
  require('../src/lib/template-filters').registerTemplateFilters(env);
  env.addFilter('nl2br', (value) => value);
  env.addFilter('string', String);
  env.addFilter('urlencode', encodeURIComponent);
  return env;
})();

function buildApp() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'side-panels-test', resave: false, saveUninitialized: false }));
  app.engine('njk', (file, options, callback) => {
    try {
      callback(null, environment.render(path.relative(viewsDirectory, file), options));
    } catch (error) {
      callback(error);
    }
  });
  app.set('view engine', 'njk');
  app.set('views', viewsDirectory);
  app.use('/dashboard', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.accessibleRouting = {
      mode: 'shared', tenantSlug: 'acme', prefix: '/acme/accessible',
      tenant: { id: 2, slug: 'acme', name: 'Acme Timebank', ...(global.__tenantFlags || {}) }
    };
    Object.assign(res.locals, {
      alphaFooterColumns: [],
      alphaNavItems: [],
      csrfToken: 'test-csrf-token',
      feedbackUrl: '#',
      isAuthenticated: true,
      serviceName: 'Project NEXUS',
      t: createTranslator('en'),
      tc: createChoiceTranslator('en'),
      tenantName: 'Acme Timebank',
      urlFor: (value) => String(value || '/'),
      htmlLang: 'en',
      htmlDirection: 'ltr'
    });
    next();
  }, dashboardRoutes);
  return app;
}

const SIDEBAR = {
  data: {
    community_stats: { members: 1234, listings: 56, events: 7, groups: 8 },
    suggested_listings: [
      { id: 41, title: 'Dog walking', type: 'offer', owner_name: 'Bea Smith' },
      { id: 42, title: 'Help with a ladder', type: 'request', owner_name: 'Cal Jones' }
    ],
    top_categories: [
      { id: 9, name: 'Gardening', slug: 'gardening', count: 12 },
      { id: 10, name: 'Transport', slug: 'transport', count: 3 }
    ],
    upcoming_events: [],
    popular_groups: []
  }
};

const TOP_ENDORSED = {
  data: [
    { user_id: 71, name: 'Dana Endorsed', avatar_url: null, total_endorsements: 15, skills_endorsed: 3 },
    { user_id: 72, name: 'Eli Second', avatar_url: null, total_endorsements: 1, skills_endorsed: 1 }
  ]
};

const SUGGESTIONS = {
  data: {
    suggestions: [
      { id: 81, name: 'Fay Maybe', bio: null, mutual_connections_count: 2, shared_skills: ['Baking', 'Cycling'], connection_status: 'none' },
      { id: 82, name: 'Gus Stranger', bio: null, mutual_connections_count: 0, shared_skills: [], connection_status: 'none' }
    ]
  }
};

function htmlBetween(html, startMarker) {
  const start = html.indexOf(startMarker);
  if (start === -1) return '';
  const end = html.indexOf('</section>', start);
  return html.slice(start, end === -1 ? undefined : end);
}

describe('dashboard panels from the React feed side panel', () => {
  const app = () => buildApp();

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
    api.getFeedSidebar.mockResolvedValue(SIDEBAR);
    api.getTopEndorsedMembers.mockResolvedValue(TOP_ENDORSED);
    api.getConnectionSuggestions.mockResolvedValue(SUGGESTIONS);
  });

  afterAll(() => { delete global.__tenantFlags; });

  it('reads the same endpoints with the same parameters React uses', async () => {
    const res = await request(app()).get('/dashboard');
    expect(res.status).toBe(200);
    expect(api.getFeedSidebar).toHaveBeenCalledWith('token:test');
    expect(api.getTopEndorsedMembers).toHaveBeenCalledWith('token:test', 5);
    expect(api.getConnectionSuggestions).toHaveBeenCalledWith('token:test', 8);
  });

  it('shows community statistics with links to each section', async () => {
    const res = await request(app()).get('/dashboard');
    const panel = htmlBetween(res.text, 'id="dashboard-community-stats"');
    expect(panel).toContain(t('dashboard_panels.community_title'));
    expect(panel).toContain('1,234');
    expect(panel).toContain(t('dashboard_panels.members'));
    expect(panel).toContain('href="/members"');
    expect(panel).toContain('href="/listings"');
    expect(panel).toContain('href="/events"');
    expect(panel).toContain('href="/groups"');
  });

  it('shows suggested listings with their type and owner', async () => {
    const res = await request(app()).get('/dashboard');
    const panel = htmlBetween(res.text, 'id="dashboard-suggested-listings"');
    expect(panel).toContain(t('dashboard_panels.suggested_title'));
    expect(panel).toContain('href="/listings/41"');
    expect(panel).toContain('Dog walking');
    expect(panel).toContain(t('dashboard_panels.by_owner', { name: 'Bea Smith' }));
    expect(panel).toContain(t('listings.request'));
  });

  it('shows the top categories, each linking to the filtered listings', async () => {
    const res = await request(app()).get('/dashboard');
    const panel = htmlBetween(res.text, 'id="dashboard-top-categories"');
    expect(panel).toContain(t('dashboard_panels.categories_title'));
    expect(panel).toContain('href="/listings?category_id=9"');
    expect(panel).toContain('Gardening');
    expect(panel).toContain('(12)');
  });

  it('ranks the most endorsed members and links to their profiles by user_id', async () => {
    const res = await request(app()).get('/dashboard');
    const panel = htmlBetween(res.text, 'id="dashboard-top-endorsed"');
    expect(panel).toContain(t('dashboard_panels.endorsed_title'));
    expect(panel).toContain('govuk-list--number');
    expect(panel).toContain('href="/members/71"');
    expect(panel).toContain('Dana Endorsed');
    expect(panel).toContain(createChoiceTranslator('en')('dashboard.endorsement_count', 15));
    expect(panel).not.toContain('/members/undefined');
  });

  it('suggests people with a working, no-JavaScript connect form', async () => {
    const res = await request(app()).get('/dashboard');
    const panel = htmlBetween(res.text, 'id="dashboard-people"');
    expect(panel).toContain(t('dashboard_panels.people_title'));
    expect(panel).toContain('href="/members/81"');
    expect(panel).toContain(createChoiceTranslator('en')('dashboard_panels.mutual', 2));
    expect(panel).toContain('Baking');
    expect(panel).toContain('action="/members/81/connection"');
    expect(panel).toContain('name="action" value="connect"');
    expect(panel).toContain('name="_csrf" value="test-csrf-token"');
    expect(panel).toContain(t('dashboard_panels.connect_with', { name: 'Fay Maybe' }));
    // No mutual-connections line when there are none.
    expect(panel).not.toContain(createChoiceTranslator('en')('dashboard_panels.mutual', 0));
  });

  it('hides statistics and people, and asks for no suggestions, when connections are off', async () => {
    global.__tenantFlags = { features: { connections: false } };
    const res = await request(app()).get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('id="dashboard-community-stats"');
    expect(res.text).not.toContain('id="dashboard-people"');
    expect(api.getConnectionSuggestions).not.toHaveBeenCalled();
    expect(res.text).toContain('id="dashboard-suggested-listings"');
  });

  it('hides suggested listings and categories when listings are off', async () => {
    global.__tenantFlags = { modules: { listings: false } };
    const res = await request(app()).get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('id="dashboard-suggested-listings"');
    expect(res.text).not.toContain('id="dashboard-top-categories"');
    expect(res.text).toContain('id="dashboard-community-stats"');
  });

  it('shows none of the feed side panel, and reads nothing for it, when the feed is off', async () => {
    global.__tenantFlags = { modules: { feed: false } };
    const res = await request(app()).get('/dashboard');
    expect(res.status).toBe(200);
    expect(api.getFeedSidebar).not.toHaveBeenCalled();
    expect(api.getTopEndorsedMembers).not.toHaveBeenCalled();
    expect(api.getConnectionSuggestions).not.toHaveBeenCalled();
    expect(res.text).not.toContain('id="dashboard-top-endorsed"');
    expect(res.text).not.toContain('id="dashboard-community-stats"');
  });

  it('drops only the panel whose read failed, and keeps the rest of the dashboard', async () => {
    api.getFeedSidebar.mockRejectedValue(new api.ApiError('boom', 500));
    api.getTopEndorsedMembers.mockRejectedValue(new Error('network'));
    const res = await request(app()).get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('dashboard.timebank_title'));
    expect(res.text).not.toContain('id="dashboard-community-stats"');
    expect(res.text).not.toContain('id="dashboard-suggested-listings"');
    expect(res.text).not.toContain('id="dashboard-top-categories"');
    expect(res.text).not.toContain('id="dashboard-top-endorsed"');
    expect(res.text).toContain('id="dashboard-people"');
  });

  it('still sends an expired session to sign in when a panel read is refused with 401', async () => {
    api.getConnectionSuggestions.mockRejectedValue(new api.ApiError('expired', 401));
    const res = await request(app()).get('/dashboard');
    expect(res.status).not.toBe(200);
  });

  it('hides each panel when it has nothing to show', async () => {
    api.getFeedSidebar.mockResolvedValue({ data: { suggested_listings: [], top_categories: [] } });
    api.getTopEndorsedMembers.mockResolvedValue({ data: [] });
    api.getConnectionSuggestions.mockResolvedValue({ data: { suggestions: [] } });
    const res = await request(app()).get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('id="dashboard-community-stats"');
    expect(res.text).not.toContain('id="dashboard-suggested-listings"');
    expect(res.text).not.toContain('id="dashboard-top-categories"');
    expect(res.text).not.toContain('id="dashboard-top-endorsed"');
    expect(res.text).not.toContain('id="dashboard-people"');
  });
});
