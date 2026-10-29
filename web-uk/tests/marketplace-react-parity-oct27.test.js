// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Marketplace parity with React (27 Oct 2026), the small parts:
 *
 * - Featured listings on the marketplace home (MarketplacePage: GET listings/featured),
 *   shown only while nothing is being searched or filtered, as React does.
 * - Listing-type (`price_type`) filter on the home page and on advanced search.
 * - Listing detail: the category "Item details" block (`template_data`) and "More from
 *   this seller" (GET sellers/{id}/listings?per_page=5, minus the listing itself).
 * - My listings: the seller's figures from GET seller/dashboard — active, sold, total
 *   views and revenue by currency. Only figures the API returns are shown.
 * - Offers: a seller can make a counter-offer (amount + optional message) on a pending
 *   offer, as React's MyOffersPage does with PUT offers/{id}/counter.
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
    uploadMarketplaceListingImages: jest.fn(),
    uploadMerchantOnboardingImage: jest.fn()
  };
});

const api = require('../src/lib/api');
const marketplaceRoutes = require('../src/routes/marketplace');
const marketplaceActionRoutes = require('../src/routes/marketplace-actions');

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
  app.use(session({ secret: 'marketplace-parity-test-secret', resave: false, saveUninitialized: false }));
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
  return app;
}

function routeApi(handlers) {
  api.callMarketplaceApi.mockImplementation((token, method, apiPath, body) => {
    for (const [[m, re], handler] of handlers) {
      if (m === method && re.test(apiPath)) {
        const value = typeof handler === 'function' ? handler(apiPath, body) : handler;
        return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
      }
    }
    return Promise.resolve({ data: [] });
  });
}

const escaped = (text) => String(text).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: 101 } });
  api.callMerchantOnboardingApi.mockResolvedValue({ data: {} });
});

describe('featured listings on the marketplace home', () => {
  const featured = { data: [
    { id: 1, title: 'Featured bike', price: 40, price_type: 'fixed' },
    { id: 2, title: 'Featured lamp', price: 5, price_type: 'fixed' },
    { id: 3, title: 'Featured desk', price: 0, price_type: 'free' },
    { id: 4, title: 'Featured kettle', price: 8, price_type: 'fixed' },
    { id: 5, title: 'Featured fifth', price: 9, price_type: 'fixed' }
  ] };

  it('shows up to four featured listings while nothing is searched', async () => {
    routeApi([[['GET', /^\/listings\/featured/], featured]]);
    const res = await request(createApp()).get('/marketplace');
    expect(res.status).toBe(200);
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'GET', '/listings/featured');
    expect(res.text).toContain(t('govuk_alpha_commerce.featured.heading'));
    expect(res.text).toContain('Featured kettle');
    expect(res.text).not.toContain('Featured fifth');
  });

  it('hides them while a search or filter is applied, as React does', async () => {
    routeApi([[['GET', /^\/listings\/featured/], featured]]);
    const res = await request(createApp()).get('/marketplace?q=bike');
    expect(res.text).not.toContain(t('govuk_alpha_commerce.featured.heading'));
  });

  it('still shows the page when the featured list cannot be loaded', async () => {
    routeApi([[['GET', /^\/listings\/featured/], new api.ApiError('down', 500)]]);
    const res = await request(createApp()).get('/marketplace');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(t('govuk_alpha_commerce.featured.heading'));
  });
});

describe('listing-type filter', () => {
  it('sends price_type from the home page and keeps it selected', async () => {
    routeApi([]);
    const res = await request(createApp()).get('/marketplace?price_type=lend');
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'GET', '/listings?limit=30&price_type=lend');
    expect(res.text).toContain('name="price_type"');
    expect(res.text).toContain('<option value="lend" selected>');
    expect(res.text).toContain(t('govuk_alpha_commerce.filters.listing_type'));
  });

  it('ignores an unknown listing type', async () => {
    routeApi([]);
    await request(createApp()).get('/marketplace?price_type=contact');
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'GET', '/listings?limit=30');
  });

  it('sends price_type from advanced search', async () => {
    routeApi([]);
    const res = await request(createApp()).get('/marketplace/search?q=chair&price_type=free');
    const call = api.callMarketplaceApi.mock.calls.find(([, , p]) => p.startsWith('/listings?'));
    expect(call[2]).toContain('price_type=free');
    expect(res.text).toContain('<option value="free" selected>');
  });
});

describe('listing detail', () => {
  const listing = {
    id: 9, title: 'Road bike', price: 120, price_type: 'fixed', description: 'Good bike',
    user: { id: 55, name: 'Rosa' },
    template_data: { frame_size: '56cm', gears: 21, electric: false }
  };

  it('shows the item details and more from this seller, without the listing itself', async () => {
    routeApi([
      [['GET', /^\/listings\/9$/], { data: listing }],
      [['GET', /^\/sellers\/55\/listings\?per_page=5$/], { data: [
        { id: 9, title: 'Road bike', price: 120, price_type: 'fixed' },
        { id: 10, title: 'Bike helmet', price: 15, price_type: 'fixed' }
      ] }]
    ]);
    const res = await request(createApp()).get('/marketplace/9');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_commerce.detail.item_details'));
    expect(res.text).toContain('Frame size');
    expect(res.text).toContain('56cm');
    expect(res.text).toContain(escaped(t('govuk_alpha_commerce.detail.more_from_seller', { name: 'Rosa' })));
    expect(res.text).toContain('href="/marketplace/10"');
    expect(res.text).not.toContain('href="/marketplace/9"');
    expect(res.text).toContain('href="/marketplace/seller/55"');
  });

  it('shows neither block when there is nothing to show', async () => {
    routeApi([
      [['GET', /^\/listings\/9$/], { data: { ...listing, template_data: null } }],
      [['GET', /^\/sellers\/55\/listings/], new api.ApiError('down', 500)]
    ]);
    const res = await request(createApp()).get('/marketplace/9');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(t('govuk_alpha_commerce.detail.item_details'));
    expect(res.text).not.toContain(escaped(t('govuk_alpha_commerce.detail.more_from_seller', { name: 'Rosa' })));
  });
});

describe('seller figures on My listings', () => {
  it('shows active, sold, total views and revenue by currency from the seller dashboard', async () => {
    routeApi([
      [['GET', /^\/seller\/dashboard$/], { data: {
        active_listings: 4, sold_listings: 2, total_views: 310,
        revenue_by_currency: [{ currency: 'EUR', total: 45.5 }, { currency: 'GBP', total: 10 }]
      } }],
      [['GET', /^\/listings\?/], { data: [], meta: {} }]
    ]);
    const res = await request(createApp()).get('/marketplace/mine');
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'GET', '/seller/dashboard');
    expect(res.text).toContain(t('govuk_alpha_commerce.seller_stats.heading'));
    expect(res.text).toContain(t('govuk_alpha_commerce.seller_stats.views'));
    expect(res.text).toContain('310');
    expect(res.text).toMatch(/45\.50/);
    expect(res.text).toMatch(/10\.00/);
  });

  it('leaves the figures out when the dashboard cannot be read', async () => {
    routeApi([
      [['GET', /^\/seller\/dashboard$/], new api.ApiError('down', 500)],
      [['GET', /^\/listings\?/], { data: [], meta: {} }]
    ]);
    const res = await request(createApp()).get('/marketplace/mine');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(t('govuk_alpha_commerce.seller_stats.heading'));
  });
});

describe('seller counter-offer', () => {
  it('offers a counter-offer form on a pending received offer only', async () => {
    routeApi([[['GET', /^\/my-offers\/received/], { data: [
      { id: 31, status: 'pending', amount: 20, currency: 'EUR', listing: { id: 9, title: 'Road bike' }, buyer: { name: 'Ada' } },
      { id: 32, status: 'countered', amount: 15, counter_amount: 18, counter_message: 'Meet halfway?', currency: 'EUR', listing: { id: 9, title: 'Road bike' }, buyer: { name: 'Bo' } }
    ] }]]);
    const res = await request(createApp()).get('/marketplace/offers?tab=received');
    expect(res.status).toBe(200);
    expect(res.text).toContain('action="/marketplace/offers/31/counter"');
    expect(res.text).not.toContain('action="/marketplace/offers/32/counter"');
    expect(res.text).toContain(t('govuk_alpha_commerce.offers.counter_summary'));
    expect(res.text).toContain('Meet halfway?');
  });

  it('sends the counter amount and message to the API', async () => {
    routeApi([[['PUT', /^\/offers\/31\/counter$/], { data: { id: 31, status: 'countered' } }]]);
    const res = await request(createApp())
      .post('/marketplace/offers/31/counter')
      .type('form')
      .send({ counter_amount: '17.50', counter_message: '  Can do this price  ' });
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'PUT', '/offers/31/counter', { amount: 17.5, message: 'Can do this price' });
    expect(res.headers.location).toBe('/marketplace/offers?tab=received&status=countered');
  });

  it('refuses a missing or invalid amount without calling the API', async () => {
    routeApi([]);
    for (const amount of ['', '0', '-3', 'abc', '1.234']) {
      const res = await request(createApp()).post('/marketplace/offers/31/counter').type('form').send({ counter_amount: amount });
      expect(res.headers.location).toBe('/marketplace/offers?tab=received&status=counter-amount-invalid');
    }
    expect(api.callMarketplaceApi).not.toHaveBeenCalled();
  });

  it('reports an API refusal honestly', async () => {
    routeApi([[['PUT', /^\/offers\/31\/counter$/], new api.ApiError('nope', 422)]]);
    const res = await request(createApp()).post('/marketplace/offers/31/counter').type('form').send({ counter_amount: '10' });
    expect(res.headers.location).toBe('/marketplace/offers?tab=received&status=counter-failed');
  });

  it('shows the success and failure messages', async () => {
    routeApi([]);
    const ok = await request(createApp()).get('/marketplace/offers?tab=received&status=countered');
    expect(ok.text).toContain(t('govuk_alpha_commerce.offers.status_countered_done'));
    const bad = await request(createApp()).get('/marketplace/offers?tab=received&status=counter-amount-invalid');
    expect(bad.text).toContain(t('govuk_alpha_commerce.offers.counter_amount_invalid'));
  });
});
