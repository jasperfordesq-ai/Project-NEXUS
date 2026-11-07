// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AWID accessibility report, Oct 2026, point 6: every photo a member uploads should be
 * describable for blind members. Marketplace photos and the photo a supporter adds to a
 * listing for someone could not be.
 *
 * - the listing's photos page offers a description box per photo, saved through the
 *   listing update (`image_alt_texts`, by photo id);
 * - a single photo can be described as it is added (create form or photos page) —
 *   `alt_texts[0]`; with several at once the member is asked to describe them after;
 * - the listing page and the photos page read the description out, else "Photo N for …";
 * - the supporter's photo step sends `image_alt` with the photo.
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
  app.use(session({ secret: 'marketplace-photo-alt-test-secret', resave: false, saveUninitialized: false }));
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
      if (m === method && re.test(apiPath)) {
        return typeof handler === 'function' ? Promise.resolve().then(() => handler(apiPath, body)) : Promise.resolve(handler);
      }
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
    { id: 7, url: 'https://cdn.example/a.jpg', thumbnail_url: 'https://cdn.example/a-t.jpg', alt_text: 'A green folding chair on grass', is_primary: true },
    { id: 8, url: 'https://cdn.example/b.jpg', thumbnail_url: null, alt_text: null, is_primary: false }
  ]
};

beforeEach(() => {
  jest.clearAllMocks();
  api.uploadMarketplaceListingImages.mockResolvedValue({ data: [] });
});

describe('describing marketplace photos', () => {
  it('offers a description box per photo and reads the description out', async () => {
    routeApi([[['GET', /^\/listings\/42$/], { data: OWN_LISTING }]]);
    const res = await request(createApp()).get('/marketplace/42/photos');

    expect(res.status).toBe(200);
    expect(res.text).toContain('alt="A green folding chair on grass"');
    // No description yet: the numbered fallback, never the file name.
    expect(res.text).toContain(`alt="${t('listings.gallery_image_alt', { number: 2, title: 'Garden chair' })}"`);
    expect(res.text).toContain('action="/marketplace/42/photos/7/description"');
    expect(res.text).toContain('action="/marketplace/42/photos/8/description"');
    expect(res.text).toContain('value="A green folding chair on grass"');
    expect(res.text).toContain(t('govuk_alpha_commerce.photos.photo_alt_label', { number: 2 }));
    expect(res.text).toContain('maxlength="255"');
  });

  it('saves a description through the listing update, and an empty one clears it', async () => {
    routeApi([[['PUT', /^\/listings\/42$/], { data: OWN_LISTING }]]);
    const app = createApp();

    const saved = await request(app).post('/marketplace/42/photos/8/description').type('form')
      .send({ alt_text: '  The back of the chair  ' });
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'PUT', '/listings/42', {
      image_alt_texts: { 8: 'The back of the chair' }
    });
    expect(saved.headers.location).toBe('/marketplace/42/photos?status=alt-saved');

    await request(app).post('/marketplace/42/photos/7/description').type('form').send({ alt_text: '' });
    expect(api.callMarketplaceApi).toHaveBeenLastCalledWith('test-token', 'PUT', '/listings/42', {
      image_alt_texts: { 7: null }
    });
  });

  it('says so when the description could not be saved', async () => {
    routeApi([
      [['PUT', /^\/listings\/42$/], () => { throw new api.ApiError('nope', 422); }],
      [['GET', /^\/listings\/42$/], { data: OWN_LISTING }]
    ]);
    const agent = request.agent(createApp());
    const res = await agent.post('/marketplace/42/photos/8/description').type('form').send({ alt_text: 'Chair' });
    expect(res.headers.location).toBe('/marketplace/42/photos?status=alt-failed');

    const page = await agent.get('/marketplace/42/photos?status=alt-failed');
    expect(page.text).toContain(t('govuk_alpha_commerce.photos.status_alt_failed'));
  });

  it('describes a single photo as it is added on the photos page', async () => {
    routeApi([[['GET', /^\/listings\/42$/], { data: OWN_LISTING }]]);
    const res = await request(createApp()).post('/marketplace/42/photos')
      .field('photo_alt', 'The seat, close up')
      .attach('images', PNG, { filename: 'IMG_2034.png', contentType: 'image/png' });

    expect(res.headers.location).toBe('/marketplace/42/photos?status=uploaded');
    const [, listingId, payload] = api.uploadMarketplaceListingImages.mock.calls[0];
    expect(listingId).toBe(42);
    expect(payload.altTexts).toEqual(['The seat, close up']);
  });

  it('asks for one photo at a time when a description is given for several', async () => {
    routeApi([[['GET', /^\/listings\/42$/], { data: OWN_LISTING }]]);
    const agent = request.agent(createApp());
    const res = await agent.post('/marketplace/42/photos')
      .field('photo_alt', 'Which one is this?')
      .attach('images', PNG, { filename: 'one.png', contentType: 'image/png' })
      .attach('images', PNG, { filename: 'two.png', contentType: 'image/png' });

    expect(res.headers.location).toBe('/marketplace/42/photos');
    expect(api.uploadMarketplaceListingImages).not.toHaveBeenCalled();
    const page = await agent.get('/marketplace/42/photos');
    expect(page.text).toContain(t('govuk_alpha_commerce.photos.error_alt_several'));
    expect(page.text).toContain('href="#photo_alt"');
    // What they typed is kept.
    expect(page.text).toContain('value="Which one is this?"');
  });

  it('sends a photo chosen on the create form with its description', async () => {
    routeApi([[['POST', /^\/listings$/], { data: { id: 55 } }]]);
    const res = await request(createApp()).post('/marketplace/create')
      .field('title', 'Lamp').field('description', 'Bright lamp').field('price_type', 'free').field('delivery_method', 'pickup')
      .field('photo_alt', 'A brass desk lamp, switched on')
      .attach('images', PNG, { filename: 'lamp.png', contentType: 'image/png' });

    expect(res.headers.location).toBe('/marketplace/55?status=listing-created');
    expect(api.uploadMarketplaceListingImages).toHaveBeenCalledWith('test-token', 55, expect.objectContaining({
      altTexts: ['A brass desk lamp, switched on']
    }));
  });

  it('offers the description box on the create form', async () => {
    routeApi([]);
    const res = await request(createApp()).get('/marketplace/create');
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="photo_alt"');
    expect(res.text).toContain(t('govuk_alpha_commerce.photos.alt_hint'));
  });

  it('reads the seller’s description out on the listing page', async () => {
    routeApi([[['GET', /^\/listings\/42$/], { data: { ...OWN_LISTING, is_own: false, user: { id: 9, name: 'Sam' } } }]]);
    const res = await request(createApp()).get('/marketplace/42');

    expect(res.text).toContain('alt="A green folding chair on grass"');
    expect(res.text).toContain(`alt="${t('listings.gallery_image_alt', { number: 2, title: 'Garden chair' })}"`);
  });

  it('reads the description out when the listing has a single photo', async () => {
    routeApi([[['GET', /^\/listings\/42$/], {
      data: { ...OWN_LISTING, is_own: false, user: { id: 9, name: 'Sam' }, images: [OWN_LISTING.images[0]] }
    }]]);
    const res = await request(createApp()).get('/marketplace/42');
    expect(res.text).toContain('alt="A green folding chair on grass"');
  });
});

describe('the API helpers carry the descriptions', () => {
  const mockFetch = jest.fn();
  let realApi;

  beforeAll(() => {
    global.fetch = mockFetch;
    process.env.API_BASE_URL = 'http://localhost:5000';
    realApi = jest.requireActual('../src/lib/api');
  });

  function jsonOk(body = { data: {} }) {
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body };
  }

  it('sends alt_texts[i] beside each marketplace photo', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({ data: [] }));
    await realApi.uploadMarketplaceListingImages('test-token', 42, {
      files: [
        { buffer: Buffer.from('a'), filename: 'a.png', contentType: 'image/png' },
        { buffer: Buffer.from('b'), filename: 'b.png', contentType: 'image/png' }
      ],
      altTexts: ['A red chair']
    });
    const [, options] = mockFetch.mock.calls[0];
    expect(options.body.get('alt_texts[0]')).toBe('A red chair');
    expect(options.body.get('alt_texts[1]')).toBe('');
  });

  it('sends no alt_texts when none were given', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({ data: [] }));
    await realApi.uploadMarketplaceListingImages('test-token', 42, {
      files: [{ buffer: Buffer.from('a'), filename: 'a.png', contentType: 'image/png' }]
    });
    const [, options] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    expect(options.body.has('alt_texts[0]')).toBe(false);
  });

  it('sends image_alt with the supporter’s photo', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({ data: { image_url: '/uploads/x.jpg' } }));
    await realApi.uploadSupportedMemberListingImage('test-token', 77, 31, {
      buffer: Buffer.from('img'), filename: 'dog.jpg', contentType: 'image/jpeg', altText: 'A dog on a lead'
    });
    const [url, options] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    expect(url).toBe('http://localhost:5000/api/v2/users/me/sub-accounts/77/listings/31/image');
    expect(options.body.get('image_alt')).toBe('A dog on a lead');
  });
});

describe('the supporter’s photo step', () => {
  it('offers a description box for the photo', () => {
    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader([VIEWS, GOVUK]), { autoescape: true });
    registerTemplateFilters(env);
    const html = env.render('settings/support-prepare-photo.njk', {
      t,
      urlFor: (value) => value,
      supportedUserId: 77,
      supportedName: 'Mary Casey',
      listingId: 31,
      csrfToken: 'x',
      alphaNavItems: [],
      alphaLocaleOptions: [],
      alphaLanguageQueryParams: []
    });
    expect(html).toContain('name="image_alt"');
    expect(html).toContain(t('govuk_alpha_listings.create.image_alt_label'));
    expect(html).toContain('maxlength="255"');
  });
});
