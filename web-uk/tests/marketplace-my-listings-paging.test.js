// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * My listings asked for one page of 100 listings and filtered it locally, so a seller's
 * 101st listing could never be seen and every tab count was a count of that page. It now
 * asks Laravel for one tab (status) at a time and follows the cursor, as React does.
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
    getProfile: jest.fn(),
    callMarketplaceApi: jest.fn(),
    callMerchantOnboardingApi: jest.fn(),
    uploadMarketplaceListingImages: jest.fn()
  };
});

const api = require('../src/lib/api');
const marketplaceRoutes = require('../src/routes/marketplace');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');

function createApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));
  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'marketplace-tools-test-secret', resave: false, saveUninitialized: false }));
  app.use((req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.accessibleRouting = { tenant: { id: 2, slug: 'acme', name: 'Acme', settings: { default_currency: 'EUR' } } };
    Object.assign(res.locals, {
      urlFor: (value) => value,
      serviceName: 'Project NEXUS',
      tenantName: 'Acme Timebank',
      isAuthenticated: true,
      csrfToken: 'test-csrf-token',
      alphaNavItems: [],
      feedbackUrl: '/feedback',
      currentPath: req.path,
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
  });
  app.use('/marketplace', marketplaceRoutes);
  return app;
}

function routeApi(handlers) {
  api.callMarketplaceApi.mockImplementation((token, method, apiPath, body) => {
    for (const [pattern, handler] of handlers) {
      const [m, re] = pattern;
      if (m === method && re.test(apiPath)) return Promise.resolve(typeof handler === 'function' ? handler(apiPath, body) : handler);
    }
    return Promise.resolve({ data: [] });
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: 101 } });
  api.callMerchantOnboardingApi.mockResolvedValue({ data: {} });
});

describe('My listings paging (27 Oct 2026)', () => {
  it('asks the API for the chosen tab only, one page at a time, and offers the next page', async () => {
    routeApi([[['GET', /^\/listings\?/], {
      data: [{ id: 5, title: 'Old lamp', status: 'draft', price: 3, price_type: 'fixed' }],
      meta: { has_more: true, cursor: 'next-1' }
    }]]);
    const res = await request(createApp()).get('/marketplace/mine?tab=draft');
    expect(res.status).toBe(200);
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'GET', '/listings?user_id=101&status=draft&limit=30');
    expect(res.text).toContain('Old lamp');
    expect(res.text).toContain('href="/marketplace/mine?tab=draft&amp;cursor=next-1"');
  });

  it('passes the cursor through and offers the way back to the first page', async () => {
    routeApi([[['GET', /^\/listings\?/], {
      data: [{ id: 6, title: 'Listing one hundred and one', status: 'active', price: 3, price_type: 'fixed' }],
      meta: { has_more: false }
    }]]);
    const res = await request(createApp()).get('/marketplace/mine?tab=active&cursor=next-1');
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'GET', '/listings?user_id=101&status=active&limit=30&cursor=next-1');
    expect(res.text).toContain('Listing one hundred and one');
    expect(res.text).toContain(t('govuk_alpha_commerce.pagination.first'));
    expect(res.text).toContain('href="/marketplace/mine?tab=active"');
  });

  it('does not show tab counts worked out from one page of results', async () => {
    routeApi([[['GET', /^\/listings\?/], {
      data: [{ id: 7, title: 'Chair', status: 'active', price: 3, price_type: 'fixed' }],
      meta: { has_more: true, cursor: 'x' }
    }]]);
    const res = await request(createApp()).get('/marketplace/mine');
    const activeLabel = t('govuk_alpha_commerce.my_listings.tab_active');
    expect(res.text).toContain(`>${activeLabel}</a>`);
    expect(res.text).not.toContain(`${activeLabel} (1)`);
  });
});
