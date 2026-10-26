// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Marketplace React-parity pass (26 Oct 2026), rendered through the real Nunjucks views:
 *
 * - Borrow & lend browse page lists only `price_type=lend` listings, with cursor paging;
 * - a member's own reports list, report page and appeal (reporter and seller);
 * - seller shipping options: add, validate, change, delete (with confirmation);
 * - listing photos: upload (multipart, no JavaScript), wrong type refused, remove,
 *   make main; photos chosen on the create form are uploaded after the listing exists;
 * - paging on offers, and an accepted offer on a SECOND page of sent offers can still
 *   be bought (it was "not found" beyond the first 50).
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
const { parseMultipartForm } = require('../src/middleware/multipart');
const marketplaceRoutes = require('../src/routes/marketplace');
const marketplaceActionRoutes = require('../src/routes/marketplace-actions');
const marketplaceMemberToolRoutes = require('../src/routes/marketplace-member-tools');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

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
  app.use(/^\/marketplace\/(create|\d+\/photos)$/, parseMultipartForm({ maxFileSize: 10 * 1024 * 1024, multiples: true }));
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
      if (m === method && re.test(apiPath)) return Promise.resolve(typeof handler === 'function' ? handler(apiPath, body) : handler);
    }
    return Promise.resolve({ data: [] });
  });
}

const OWN_LISTING = {
  id: 42,
  title: 'Garden chair',
  description: 'Sturdy.',
  price: 10,
  price_type: 'fixed',
  price_currency: 'EUR',
  status: 'active',
  is_own: true,
  images: [
    { id: 7, url: 'https://cdn.example/a.jpg', thumbnail_url: 'https://cdn.example/a-t.jpg', is_primary: true },
    { id: 8, url: 'https://cdn.example/b.jpg', thumbnail_url: null, is_primary: false }
  ]
};

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: 101 } });
  api.callMerchantOnboardingApi.mockResolvedValue({ data: {} });
  api.uploadMarketplaceListingImages.mockResolvedValue({ data: [{ id: 9 }] });
});

describe('borrow & lend browse page', () => {
  it('asks only for lend listings and offers the next page when there is one', async () => {
    routeApi([[['GET', /^\/listings\?/], {
      data: [{ id: 5, title: 'Ladder', price_type: 'lend', status: 'active' }],
      meta: { has_more: true, cursor: 'abc123' }
    }]]);
    const res = await request(createApp()).get('/marketplace/borrow');
    expect(res.status).toBe(200);
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'GET', '/listings?price_type=lend&limit=30');
    expect(res.text).toContain(t('govuk_alpha_commerce.borrow.title'));
    expect(res.text).toContain('Ladder');
    expect(res.text).toContain('href="/marketplace/borrow?cursor=abc123"');
    expect(res.text).not.toContain(t('govuk_alpha_commerce.pagination.first'));
  });

  it('passes the cursor through and offers the way back to the first page', async () => {
    routeApi([[['GET', /^\/listings\?/], { data: [], meta: { has_more: false } }]]);
    const res = await request(createApp()).get('/marketplace/borrow?cursor=abc123');
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'GET', '/listings?price_type=lend&limit=30&cursor=abc123');
    expect(res.text).toContain(t('govuk_alpha_commerce.borrow.empty'));
    expect(res.text).toContain(t('govuk_alpha_commerce.pagination.first'));
    expect(res.text).toContain('href="/marketplace/borrow"');
  });

  it('sends React-shaped become-partner links to the seller onboarding page', async () => {
    const res = await request(createApp()).get('/marketplace/become-partner');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/marketplace/onboarding');
  });
});

describe('offers paging and the accepted-offer purchase beyond the first page', () => {
  it('shows a next-page link on the sent tab that keeps the tab', async () => {
    routeApi([[['GET', /^\/my-offers\/sent/], { data: [], meta: { has_more: true, cursor: 'n2' } }]]);
    const res = await request(createApp()).get('/marketplace/offers?tab=sent');
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'GET', '/my-offers/sent?per_page=50');
    expect(res.text).toContain('href="/marketplace/offers?tab=sent&amp;cursor=n2"');
  });

  it('finds an accepted offer on the second page of sent offers', async () => {
    routeApi([
      [['GET', /^\/my-offers\/sent\?per_page=100$/], { data: [{ id: 1, status: 'pending' }], meta: { has_more: true, cursor: 'p2' } }],
      [['GET', /^\/my-offers\/sent\?per_page=100&cursor=p2$/], { data: [{ id: 77, status: 'accepted', amount: 8, currency: 'EUR', listing_id: 42 }], meta: { has_more: false } }],
      [['GET', /^\/orders\/purchases/], { data: [], meta: { has_more: false } }],
      [['GET', /^\/listings\/42\?offer_id=77$/], { data: { ...OWN_LISTING, is_own: false, user: { id: 9, name: 'Seller' } } }]
    ]);
    const res = await request(createApp()).get('/marketplace/offers/77/buy');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_commerce.buy.accepted_offer_title'));
  });
});

describe('my reports and appeals', () => {
  const REPORTER_ROW = {
    id: 31, marketplace_listing_id: 42, reason: 'unsafe', description: 'Sharp edges', status: 'no_action',
    resolution_reason: 'Within the rules', action_taken: 'none', can_appeal: true, viewer_role: 'reporter',
    listing: { id: 42, title: 'Garden chair', status: 'active' }
  };

  it('lists the member’s reports with translated reason and status', async () => {
    routeApi([[['GET', /^\/reports$/], { data: [REPORTER_ROW, { ...REPORTER_ROW, id: 32, status: 'action_taken', viewer_role: 'seller', can_appeal: true }] }]]);
    const res = await request(createApp()).get('/marketplace/reports');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/marketplace/reports/31"');
    expect(res.text).toContain(t('govuk_alpha_commerce.report.reason_unsafe'));
    expect(res.text).toContain(t('govuk_alpha_commerce.my_reports.status_no_action'));
    expect(res.text).toContain(t('govuk_alpha_commerce.my_reports.role_seller'));
  });

  it('shows the decision and an appeal form when the API allows an appeal', async () => {
    routeApi([[['GET', /^\/reports\/31$/], { data: REPORTER_ROW }]]);
    const res = await request(createApp()).get('/marketplace/reports/31');
    expect(res.text).toContain('Within the rules');
    expect(res.text).toContain(t('govuk_alpha_commerce.my_reports.appeal_reporter_intro').replace(/'/g, '&#39;'));
    expect(res.text).toContain('action="/marketplace/reports/31/appeal"');
  });

  it('refuses a too-short appeal at the field, then sends a proper one', async () => {
    const agent = request.agent(createApp());
    routeApi([
      [['GET', /^\/reports\/31$/], { data: REPORTER_ROW }],
      [['POST', /^\/reports\/31\/appeal$/], { data: { id: 31, status: 'appealed' } }]
    ]);
    const short = await agent.post('/marketplace/reports/31/appeal').type('form').send({ appeal_text: 'too short' });
    expect(short.headers.location).toBe('/marketplace/reports/31#appeal_text');
    const page = await agent.get('/marketplace/reports/31');
    expect(page.text).toContain(t('govuk_alpha_commerce.my_reports.error_appeal_short'));
    expect(page.text).toContain('>too short</textarea>');
    expect(api.callMarketplaceApi).not.toHaveBeenCalledWith('test-token', 'POST', '/reports/31/appeal', expect.anything());

    const text = 'The listing is still dangerous and should be removed.';
    const sent = await agent.post('/marketplace/reports/31/appeal').type('form').send({ appeal_text: text });
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'POST', '/reports/31/appeal', { appeal_text: text });
    expect(sent.headers.location).toBe('/marketplace/reports/31?status=appealed');
  });

  it('shows no appeal form once the appeal is with the team', async () => {
    routeApi([[['GET', /^\/reports\/31$/], { data: { ...REPORTER_ROW, status: 'appealed', can_appeal: false, appeal_text: 'Please look again at this one.' } }]]);
    const res = await request(createApp()).get('/marketplace/reports/31');
    expect(res.text).toContain(t('govuk_alpha_commerce.my_reports.appeal_pending'));
    expect(res.text).not.toContain('/appeal"');
  });
});

describe('seller shipping options', () => {
  it('says what an empty list means and shows the add form', async () => {
    routeApi([[['GET', /^\/seller\/shipping-options$/], { data: [] }]]);
    const res = await request(createApp()).get('/marketplace/shipping');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_commerce.shipping.empty'));
    expect(res.text).toContain('name="courier_name"');
    expect(res.text).toContain('value="EUR"');
  });

  it('validates at the field and sends a correct payload', async () => {
    const agent = request.agent(createApp());
    routeApi([[['GET', /^\/seller\/shipping-options$/], { data: [] }]]);
    await agent.post('/marketplace/shipping').type('form').send({ courier_name: '', price: '-1', estimated_days: '900' });
    const page = await agent.get('/marketplace/shipping');
    expect(page.text).toContain('href="#courier_name"');
    expect(page.text).toContain('href="#price"');
    expect(page.text).toContain('href="#estimated_days"');

    const ok = await agent.post('/marketplace/shipping').type('form')
      .send({ courier_name: 'An Post', price: '4.50', currency: 'eur', estimated_days: '3', is_default: '1' });
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'POST', '/seller/shipping-options', {
      courier_name: 'An Post', price: 4.5, currency: 'EUR', estimated_days: 3, is_default: true
    });
    expect(ok.headers.location).toBe('/marketplace/shipping?status=added');
  });

  it('explains when the community does not allow posting', async () => {
    api.callMarketplaceApi.mockRejectedValueOnce(new api.ApiError('Shipping disabled', 403, { errors: [{ code: 'FEATURE_DISABLED' }] }));
    const res = await request(createApp()).post('/marketplace/shipping').type('form').send({ courier_name: 'Post', price: '0' });
    expect(res.headers.location).toBe('/marketplace/shipping?status=disabled');
  });

  it('lists options, edits one and deletes one after confirming', async () => {
    routeApi([
      [['GET', /^\/seller\/shipping-options$/], { data: [{ id: 4, courier_name: 'Courier X', price: 0, currency: 'EUR', estimated_days: 2, is_default: true }] }],
      [['PUT', /^\/seller\/shipping-options\/4$/], { data: { id: 4 } }],
      [['DELETE', /^\/seller\/shipping-options\/4$/], {}]
    ]);
    const app = createApp();
    const list = await request(app).get('/marketplace/shipping');
    expect(list.text).toContain('Courier X');
    expect(list.text).toContain(t('govuk_alpha_commerce.shipping.free_postage'));
    expect(list.text).toContain('2 days');

    const edit = await request(app).get('/marketplace/shipping/4/edit');
    expect(edit.text).toContain('value="Courier X"');
    const saved = await request(app).post('/marketplace/shipping/4/update').type('form').send({ courier_name: 'Courier Y', price: '1', currency: 'EUR', estimated_days: '' });
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'PUT', '/seller/shipping-options/4', {
      courier_name: 'Courier Y', price: 1, currency: 'EUR', estimated_days: null, is_default: false
    });
    expect(saved.headers.location).toBe('/marketplace/shipping?status=saved');

    const confirm = await request(app).get('/marketplace/shipping/4/delete');
    expect(confirm.text).toContain(t('govuk_alpha_commerce.shipping.delete_heading'));
    const deleted = await request(app).post('/marketplace/shipping/4/delete');
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'DELETE', '/seller/shipping-options/4');
    expect(deleted.headers.location).toBe('/marketplace/shipping?status=deleted');
  });
});

describe('listing photos', () => {
  it('shows the seller their photos with remove and make-main actions', async () => {
    routeApi([[['GET', /^\/listings\/42$/], { data: OWN_LISTING }]]);
    const res = await request(createApp()).get('/marketplace/42/photos');
    expect(res.status).toBe(200);
    expect(res.text).toContain('src="https://cdn.example/a-t.jpg"');
    expect(res.text).toContain(t('govuk_alpha_commerce.photos.main_tag'));
    expect(res.text).toContain('action="/marketplace/42/photos/8/main"');
    expect(res.text).not.toContain('action="/marketplace/42/photos/7/main"');
    expect(res.text).toContain('href="/marketplace/42/photos/7/remove"');
    expect(res.text).toContain('enctype="multipart/form-data"');
  });

  it('is forbidden to anyone but the seller', async () => {
    routeApi([[['GET', /^\/listings\/42$/], { data: { ...OWN_LISTING, is_own: false } }]]);
    const res = await request(createApp()).get('/marketplace/42/photos');
    expect(res.status).toBe(403);
  });

  it('uploads chosen photos without JavaScript and refuses a non-image', async () => {
    const agent = request.agent(createApp());
    routeApi([[['GET', /^\/listings\/42$/], { data: OWN_LISTING }]]);
    const ok = await agent.post('/marketplace/42/photos')
      .attach('images', PNG, { filename: 'chair.png', contentType: 'image/png' })
      .attach('images', PNG, { filename: 'chair-2.png', contentType: 'image/png' });
    expect(ok.headers.location).toBe('/marketplace/42/photos?status=uploaded');
    const [, listingId, payload] = api.uploadMarketplaceListingImages.mock.calls[0];
    expect(listingId).toBe(42);
    expect(payload.files.map((file) => file.filename)).toEqual(['chair.png', 'chair-2.png']);

    api.uploadMarketplaceListingImages.mockClear();
    const bad = await agent.post('/marketplace/42/photos')
      .attach('images', Buffer.from('%PDF-1.4'), { filename: 'notes.pdf', contentType: 'application/pdf' });
    expect(bad.headers.location).toBe('/marketplace/42/photos');
    expect(api.uploadMarketplaceListingImages).not.toHaveBeenCalled();
    const page = await agent.get('/marketplace/42/photos');
    expect(page.text).toContain(t('govuk_alpha_commerce.photos.error_type'));
    expect(page.text).toContain('href="#images"');
  });

  it('removes a photo after confirming and makes another the main photo', async () => {
    routeApi([[['GET', /^\/listings\/42$/], { data: OWN_LISTING }]]);
    const app = createApp();
    const confirm = await request(app).get('/marketplace/42/photos/8/remove');
    expect(confirm.text).toContain(t('govuk_alpha_commerce.photos.remove_heading'));
    const removed = await request(app).post('/marketplace/42/photos/8/remove');
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'DELETE', '/listings/42/images/8');
    expect(removed.headers.location).toBe('/marketplace/42/photos?status=removed');

    const main = await request(app).post('/marketplace/42/photos/8/main');
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'PUT', '/listings/42/images/reorder', { image_ids: [8, 7] });
    expect(main.headers.location).toBe('/marketplace/42/photos?status=main-changed');
  });

  it('uploads photos chosen on the create form once the listing exists', async () => {
    routeApi([[['POST', /^\/listings$/], { data: { id: 55 } }]]);
    const res = await request(createApp()).post('/marketplace/create')
      .field('title', 'Lamp').field('description', 'Bright lamp').field('price_type', 'free').field('delivery_method', 'pickup')
      .attach('images', PNG, { filename: 'lamp.png', contentType: 'image/png' });
    expect(res.headers.location).toBe('/marketplace/55?status=listing-created');
    expect(api.uploadMarketplaceListingImages).toHaveBeenCalledWith('test-token', 55, expect.objectContaining({
      files: [expect.objectContaining({ filename: 'lamp.png', contentType: 'image/png' })]
    }));
  });

  it('sends the seller to the photos page when the listing was made but its photos failed', async () => {
    routeApi([[['POST', /^\/listings$/], { data: { id: 55 } }]]);
    api.uploadMarketplaceListingImages.mockRejectedValueOnce(new api.ApiError('fail', 500));
    const res = await request(createApp()).post('/marketplace/create')
      .field('title', 'Lamp').field('description', 'Bright lamp').field('price_type', 'free').field('delivery_method', 'pickup')
      .attach('images', PNG, { filename: 'lamp.png', contentType: 'image/png' });
    expect(res.headers.location).toBe('/marketplace/55/photos?status=created-photos-failed');
  });
});
