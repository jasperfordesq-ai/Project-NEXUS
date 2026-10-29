// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Marketplace React-parity pass (27 Oct 2026), rendered through the real Nunjucks views:
 *
 * - wish lists (React "collections", MarketplaceCollectionsPage): list, create, view
 *   items, rename, delete with a confirmation page, remove an item, add a listing;
 * - saved searches: list, run, delete with a confirmation page, save from search;
 * - "near me" (React MarketplaceMapSearchPage): the same /listings/nearby parameters,
 *   centred on the location saved in the member's profile — never the device's;
 * - seller payouts (React StripeOnboardingPage): status, the redirect to the
 *   Stripe-hosted link the API returns, and the return / refresh landing.
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
const marketplaceActionRoutes = require('../src/routes/marketplace-actions');
const marketplaceMemberToolRoutes = require('../src/routes/marketplace-member-tools');

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
  app.use(session({ secret: 'marketplace-lists-test-secret', resave: false, saveUninitialized: false }));
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
  app.use('/marketplace', marketplaceActionRoutes);
  app.use('/marketplace', marketplaceMemberToolRoutes);
  return app;
}

function routeApi(handlers) {
  api.callMarketplaceApi.mockImplementation((token, method, apiPath, body) => {
    for (const [pattern, handler] of handlers) {
      const [m, re] = pattern;
      if (m === method && re.test(apiPath)) {
        if (handler instanceof Error) return Promise.reject(handler);
        return Promise.resolve(typeof handler === 'function' ? handler(apiPath, body) : handler);
      }
    }
    return Promise.resolve({ data: [] });
  });
}

const COLLECTIONS = {
  data: [
    { id: 3, name: 'Gift ideas', description: 'For birthdays', is_public: false, item_count: 2 },
    { id: 4, name: 'Garden', description: null, is_public: true, item_count: 0 }
  ]
};
const SEARCHES = {
  data: [
    { id: 11, name: 'Cheap bikes', search_query: 'bike', filters: { category_id: 5, price_max: 50 }, alert_frequency: 'weekly' }
  ]
};
const ITEMS = {
  data: [
    { collection_item_id: 90, listing: { id: 42, title: 'Garden chair', price: 10, price_currency: 'EUR', price_type: 'fixed', status: 'active' } }
  ],
  meta: { has_more: true, cursor: 'c2' }
};

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: 101 } });
});

describe('wish lists and saved searches (React collections page)', () => {
  it('shows the member’s lists and saved searches, with a way to run each search', async () => {
    routeApi([
      [['GET', /^\/collections$/], COLLECTIONS],
      [['GET', /^\/saved-searches$/], SEARCHES]
    ]);
    const res = await request(createApp()).get('/marketplace/lists');
    expect(res.status).toBe(200);
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'GET', '/collections');
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'GET', '/saved-searches');
    expect(res.text).toContain('Gift ideas');
    expect(res.text).toContain('href="/marketplace/lists/3"');
    expect(res.text).toContain('Cheap bikes');
    expect(res.text).toContain('href="/marketplace/search?q=bike&amp;category_id=5&amp;price_max=50"');
    expect(res.text).toContain('href="/marketplace/saved-searches/11/delete"');
    expect(res.text).toContain('action="/marketplace/lists"');
  });

  it('sends the React address to the wish lists page', async () => {
    const res = await request(createApp()).get('/marketplace/collections');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/marketplace/lists');
  });

  it('refuses a list with no name at the field and creates a proper one', async () => {
    const agent = request.agent(createApp());
    routeApi([
      [['GET', /^\/collections$/], COLLECTIONS],
      [['POST', /^\/collections$/], { data: { id: 5, name: 'Books' } }]
    ]);
    const empty = await agent.post('/marketplace/lists').type('form').send({ name: '  ' });
    expect(empty.headers.location).toBe('/marketplace/lists#name');
    const page = await agent.get('/marketplace/lists');
    expect(page.text).toContain('href="#name"');
    expect(api.callMarketplaceApi).not.toHaveBeenCalledWith('test-token', 'POST', '/collections', expect.anything());

    const created = await agent.post('/marketplace/lists').type('form').send({ name: 'Books', description: 'To read', is_public: '1' });
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'POST', '/collections', { name: 'Books', description: 'To read', is_public: true });
    expect(created.headers.location).toBe('/marketplace/lists?status=created');
  });

  it('shows a list’s items with remove buttons and paging', async () => {
    routeApi([
      [['GET', /^\/collections$/], COLLECTIONS],
      [['GET', /^\/collections\/3\/items/], ITEMS]
    ]);
    const res = await request(createApp()).get('/marketplace/lists/3');
    expect(res.status).toBe(200);
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'GET', '/collections/3/items?limit=50');
    expect(res.text).toContain('Garden chair');
    expect(res.text).toContain('action="/marketplace/lists/3/items/42/remove"');
    expect(res.text).toContain('href="/marketplace/lists/3?cursor=c2"');
    expect(res.text).toContain('action="/marketplace/lists/3/update"');
    expect(res.text).toContain('href="/marketplace/lists/3/delete"');
  });

  it('answers not found for a list that is not the member’s', async () => {
    routeApi([[['GET', /^\/collections$/], COLLECTIONS]]);
    const res = await request(createApp()).get('/marketplace/lists/99');
    expect(res.status).toBe(404);
  });

  it('removes an item and renames a list', async () => {
    routeApi([
      [['DELETE', /^\/collections\/3\/items\/42$/], { data: { removed: true } }],
      [['PUT', /^\/collections\/3$/], { data: { id: 3 } }]
    ]);
    const removed = await request(createApp()).post('/marketplace/lists/3/items/42/remove').type('form').send({ confirmed: '1' });
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'DELETE', '/collections/3/items/42');
    expect(removed.headers.location).toBe('/marketplace/lists/3?status=removed');

    const renamed = await request(createApp()).post('/marketplace/lists/3/update').type('form').send({ name: 'Presents', description: '' });
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'PUT', '/collections/3', { name: 'Presents', description: null, is_public: false });
    expect(renamed.headers.location).toBe('/marketplace/lists/3?status=saved');
  });

  it('asks before deleting a list, then deletes it', async () => {
    routeApi([
      [['GET', /^\/collections$/], COLLECTIONS],
      [['DELETE', /^\/collections\/3$/], { data: { deleted: true } }]
    ]);
    const confirm = await request(createApp()).get('/marketplace/lists/3/delete');
    expect(confirm.status).toBe(200);
    expect(confirm.text).toContain('action="/marketplace/lists/3/delete"');
    expect(api.callMarketplaceApi).not.toHaveBeenCalledWith('test-token', 'DELETE', '/collections/3');

    const done = await request(createApp()).post('/marketplace/lists/3/delete').type('form').send({});
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'DELETE', '/collections/3');
    expect(done.headers.location).toBe('/marketplace/lists?status=deleted');
  });

  it('adds a listing to an existing list, or to a new one', async () => {
    routeApi([
      [['GET', /^\/listings\/42$/], { data: { id: 42, title: 'Garden chair', price_type: 'fixed', status: 'active' } }],
      [['GET', /^\/collections$/], COLLECTIONS],
      [['POST', /^\/collections$/], { data: { id: 7, name: 'New list' } }],
      [['POST', /^\/collections\/\d+\/items$/], { data: { added: true } }]
    ]);
    const page = await request(createApp()).get('/marketplace/42/add-to-list');
    expect(page.status).toBe(200);
    expect(page.text).toContain('Garden chair');
    expect(page.text).toContain('value="3"');
    expect(page.text).toContain('value="new"');

    const existing = await request(createApp()).post('/marketplace/42/add-to-list').type('form').send({ collection_id: '3' });
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'POST', '/collections/3/items', { listing_id: 42 });
    expect(existing.headers.location).toBe('/marketplace/42?status=added-to-list');

    await request(createApp()).post('/marketplace/42/add-to-list').type('form').send({ collection_id: 'new', new_name: 'New list' });
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'POST', '/collections', { name: 'New list', description: null, is_public: false });
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'POST', '/collections/7/items', { listing_id: 42 });
  });

  it('asks the member to choose a list before adding', async () => {
    const agent = request.agent(createApp());
    routeApi([
      [['GET', /^\/listings\/42$/], { data: { id: 42, title: 'Garden chair', price_type: 'fixed', status: 'active' } }],
      [['GET', /^\/collections$/], COLLECTIONS]
    ]);
    const res = await agent.post('/marketplace/42/add-to-list').type('form').send({});
    expect(res.headers.location).toBe('/marketplace/42/add-to-list#collection_id');
    const page = await agent.get('/marketplace/42/add-to-list');
    expect(page.text).toContain('href="#collection_id"');
  });

  it('offers "Add to a wish list" on someone else’s listing', async () => {
    routeApi([[['GET', /^\/listings\/42$/], { data: { id: 42, title: 'Garden chair', price_type: 'fixed', status: 'active', is_own: false, user: { id: 9, name: 'Sam' } } }]]);
    const res = await request(createApp()).get('/marketplace/42');
    expect(res.text).toContain('href="/marketplace/42/add-to-list"');
  });

  it('saves the current search with its filters, and asks before deleting one', async () => {
    routeApi([
      [['POST', /^\/saved-searches$/], { data: { id: 12 } }],
      [['GET', /^\/saved-searches$/], SEARCHES],
      [['DELETE', /^\/saved-searches\/11$/], { data: { deleted: true } }]
    ]);
    const saved = await request(createApp()).post('/marketplace/saved-searches').type('form').send({
      name: 'Bikes', alert_frequency: 'weekly', q: 'bike', category_id: '5', price_min: '', price_max: '50', condition: 'good'
    });
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'POST', '/saved-searches', {
      name: 'Bikes', search_query: 'bike', alert_frequency: 'weekly', filters: { category_id: 5, price_max: 50, condition: 'good' }
    });
    expect(saved.headers.location).toBe('/marketplace/lists?status=search-saved');

    const confirm = await request(createApp()).get('/marketplace/saved-searches/11/delete');
    expect(confirm.status).toBe(200);
    expect(confirm.text).toContain('action="/marketplace/saved-searches/11/delete"');
    const done = await request(createApp()).post('/marketplace/saved-searches/11/delete').type('form').send({});
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'DELETE', '/saved-searches/11');
    expect(done.headers.location).toBe('/marketplace/lists?status=search-deleted');
  });

  it('shows the save-this-search form on search results', async () => {
    routeApi([[['GET', /^\/listings\?/], { data: [] }]]);
    const res = await request(createApp()).get('/marketplace/search?q=bike');
    expect(res.text).toContain('action="/marketplace/saved-searches"');
    expect(res.text).toContain('name="q" value="bike"');
  });
});

describe('near me (React map search, without the map)', () => {
  it('searches around the location saved in the profile with React’s parameters', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 101, latitude: 51.5, longitude: -0.12 } });
    routeApi([
      [['GET', /^\/categories$/], { data: [] }],
      [['GET', /^\/listings\/nearby\?/], { data: [{ id: 42, title: 'Garden chair', price_type: 'free', status: 'active', distance_km: 2.345 }] }]
    ]);
    const res = await request(createApp()).get('/marketplace/nearby?radius=10&q=chair&category_id=5');
    expect(res.status).toBe(200);
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'GET', '/listings/nearby?latitude=51.5&longitude=-0.12&radius=10&q=chair&category_id=5&limit=100');
    expect(res.text).toContain('Garden chair');
    expect(res.text).toContain('2.3');
  });

  it('never invents a location: no saved location means no search and a profile link', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 101, latitude: null, longitude: null } });
    routeApi([[['GET', /^\/categories$/], { data: [] }]]);
    const res = await request(createApp()).get('/marketplace/nearby');
    expect(res.status).toBe(200);
    expect(api.callMarketplaceApi).not.toHaveBeenCalledWith('test-token', 'GET', expect.stringMatching(/^\/listings\/nearby/));
    expect(res.text).toContain('href="/profile/settings"');
  });

  it('keeps the distance to the offered choices', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 101, latitude: 10, longitude: 20 } });
    routeApi([[['GET', /^\/listings\/nearby\?/], { data: [] }]]);
    await request(createApp()).get('/marketplace/nearby?radius=9999');
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'GET', '/listings/nearby?latitude=10&longitude=20&radius=25&limit=100');
  });
});

describe('seller payouts (Stripe Connect onboarding)', () => {
  it('shows a not-started status with a start button', async () => {
    routeApi([[['GET', /^\/seller\/onboard\/status$/], { data: { stripe_account_id: null, stripe_onboarding_complete: false } }]]);
    const res = await request(createApp()).get('/marketplace/payouts');
    expect(res.status).toBe(200);
    expect(res.text).toContain('action="/marketplace/payouts/start"');
    expect(res.text).toContain(t('govuk_alpha_commerce.payouts.start_button'));
  });

  it('offers to continue an unfinished setup and shows a finished one', async () => {
    routeApi([[['GET', /^\/seller\/onboard\/status$/], { data: { stripe_account_id: 'acct_1', stripe_onboarding_complete: false } }]]);
    const unfinished = await request(createApp()).get('/marketplace/payouts');
    expect(unfinished.text).toContain(t('govuk_alpha_commerce.payouts.continue_button'));

    routeApi([[['GET', /^\/seller\/onboard\/status$/], { data: { stripe_account_id: 'acct_1', stripe_onboarding_complete: true, charges_enabled: true, payouts_enabled: true } }]]);
    const done = await request(createApp()).get('/marketplace/payouts');
    expect(done.text).toContain(t('govuk_alpha_commerce.payouts.complete_title'));
    expect(done.text).not.toContain('action="/marketplace/payouts/start"');
  });

  it('redirects to the Stripe-hosted link the API returns', async () => {
    routeApi([[['POST', /^\/seller\/onboard$/], { data: { account_id: 'acct_1', onboarding_url: 'https://connect.stripe.com/setup/e/acct_1/abc' } }]]);
    const res = await request(createApp()).post('/marketplace/payouts/start').type('form').send({});
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'POST', '/seller/onboard');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('https://connect.stripe.com/setup/e/acct_1/abc');
  });

  it('never redirects anywhere but Stripe', async () => {
    routeApi([[['POST', /^\/seller\/onboard$/], { data: { onboarding_url: 'https://evil.example/stripe.com' } }]]);
    const res = await request(createApp()).post('/marketplace/payouts/start').type('form').send({});
    expect(res.headers.location).toBe('/marketplace/payouts?status=start-failed');
  });

  it('explains when card payments are off for the community', async () => {
    routeApi([[['POST', /^\/seller\/onboard$/], new api.ApiError('Off', 403, { errors: [{ code: 'FEATURE_DISABLED' }] })]]);
    const res = await request(createApp()).post('/marketplace/payouts/start').type('form').send({});
    expect(res.headers.location).toBe('/marketplace/payouts?status=disabled');
  });

  it('lands Stripe’s return and refresh addresses on the payouts page', async () => {
    const back = await request(createApp()).get('/marketplace/seller/onboard?complete=1');
    expect(back.headers.location).toBe('/marketplace/payouts?status=returned');
    const refresh = await request(createApp()).get('/marketplace/seller/onboard?refresh=1');
    expect(refresh.headers.location).toBe('/marketplace/payouts?status=refresh');
    const plain = await request(createApp()).get('/marketplace/seller/onboard');
    expect(plain.headers.location).toBe('/marketplace/payouts');
  });
});
