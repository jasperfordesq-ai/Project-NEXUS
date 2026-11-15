// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Warmth phase 6, E8: the dashboard shows the React dashboard's moments as
 * plain text (lib/dashboard-moments.js) — and asks for the community's own
 * stats with the community's slug, as the home page does.
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
      this.status = status;
      this.data = data;
    }
  }
  const names = ['updateProfile', 'getProfile', 'invalidateUserCache', 'getBalance', 'getListings', 'getMyListings',
    'getFeedPosts', 'getMyEvents', 'getOnboardingStatus', 'getGamificationProfile', 'getMyBadges',
    'getExchangeAttentionCount', 'getMemberEndorsements', 'getFeedSidebar', 'getTopEndorsedMembers',
    'getConnectionSuggestions', 'getMyGuardians', 'getSupportActions', 'getGroups', 'getCommunityThisMonth',
    'getPlatformStats'];
  return {
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    ...Object.fromEntries(names.map((name) => [name, jest.fn()]))
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
  app.use(session({ secret: 'moments-test', resave: false, saveUninitialized: false }));
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
    req.token = 'token:test';
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'acme', prefix: '', tenant: { id: 2, slug: 'acme', name: 'Acme Timebank' } };
    Object.assign(res.locals, {
      alphaFooterColumns: [], alphaNavItems: [], csrfToken: 't', feedbackUrl: '#', isAuthenticated: true,
      serviceName: 'Project NEXUS', t: createTranslator('en'), tc: createChoiceTranslator('en'),
      tenantName: 'Acme Timebank', urlFor: (value) => String(value || '/'), htmlLang: 'en', htmlDirection: 'ltr'
    });
    next();
  }, dashboardRoutes);
  return app;
}

describe('dashboard moments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Joined a year ago today, so the anniversary week is now.
    const joined = new Date();
    joined.setUTCFullYear(joined.getUTCFullYear() - 2);
    api.getProfile.mockResolvedValue({ data: { id: 1, first_name: 'Ann', created_at: joined.toISOString() } });
    api.getBalance.mockResolvedValue({ balance: 0 });
    api.getOnboardingStatus.mockResolvedValue({ data: { onboarding_completed: true } });
    api.getGamificationProfile.mockResolvedValue({ data: null });
    api.getMyBadges.mockResolvedValue({ data: [] });
    api.getMyListings.mockResolvedValue({ data: [] });
    api.getFeedPosts.mockResolvedValue({ data: [] });
    api.getMyEvents.mockResolvedValue({ data: [] });
    api.getExchangeAttentionCount.mockResolvedValue({ data: { count: 0, items: [] } });
    api.getMemberEndorsements.mockResolvedValue({ data: { endorsements: [] } });
    api.getFeedSidebar.mockResolvedValue({ data: {} });
    api.getTopEndorsedMembers.mockResolvedValue({ data: [] });
    api.getConnectionSuggestions.mockResolvedValue({ data: { suggestions: [] } });
    api.getMyGuardians.mockResolvedValue(null);
    api.getSupportActions.mockResolvedValue(null);
    api.getGroups.mockResolvedValue({ data: [] });
    api.getCommunityThisMonth.mockResolvedValue({ data: { month: '2026-11', anniversary_years: 3 } });
    api.getPlatformStats.mockResolvedValue({ data: { hours_exchanged: 612, scope: 'tenant' } });
  });

  it('shows all three as plain text and asks for the community\'s own stats by its slug', async () => {
    const res = await request(buildApp()).get('/dashboard');
    expect(res.status).toBe(200);
    expect(api.getPlatformStats).toHaveBeenCalledWith({ slug: 'acme' });
    expect(res.text).toContain('data-dashboard-moment="anniversary"');
    expect(res.text).toContain('Happy anniversary!');
    expect(res.text).toContain('Acme Timebank is 3 years old this month');
    expect(res.text).toContain('500 hours shared together');
  });

  it('shows none of them when nothing applies, and a failed stats read changes nothing else', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 1, first_name: 'Ann', created_at: new Date().toISOString() } });
    api.getCommunityThisMonth.mockResolvedValue({ data: { month: '2026-11', anniversary_years: null } });
    api.getPlatformStats.mockRejectedValue(new Error('down'));
    const res = await request(buildApp()).get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('data-dashboard-moment');
    expect(res.text).not.toContain('We could not load this. Please try again.');
  });
});
