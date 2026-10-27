// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Marketplace parity with React (27 Oct 2026), stage 3:
 *
 * - Category-specific fields on the listing form (React CreateMarketplaceListingPage /
 *   EditMarketplaceListingPage: GET categories/{id}/template, sent as `template_data`).
 *   Without JavaScript the form cannot redraw itself when the category changes, so a
 *   "Show details for this category" button re-displays the form with that category's
 *   fields, keeping everything else the member typed.
 * - A listing video (React: POST listings/{id}/video after create; DELETE to remove),
 *   MP4, WebM or MOV up to 50MB, shown on the listing page with a plain <video controls>.
 * - Seller coupon form: valid from, uses per member, and which listings or categories
 *   it applies to (React SellerCouponEditPage).
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
    uploadMarketplaceListingVideo: jest.fn(),
    uploadMerchantOnboardingImage: jest.fn()
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
const MP4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex');

function createApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));
  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'marketplace-stage3-test-secret', resave: false, saveUninitialized: false }));
  app.use(/^\/marketplace\/create$/, parseMultipartForm({ maxFileSize: 50 * 1024 * 1024, multiples: true }));
  app.use(/^\/marketplace\/\d+\/video$/, parseMultipartForm({ maxFileSize: 50 * 1024 * 1024, maxFiles: 1 }));
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
    for (const [[m, re], handler] of handlers) {
      if (m === method && re.test(apiPath)) {
        const value = typeof handler === 'function' ? handler(apiPath, body) : handler;
        return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
      }
    }
    return Promise.resolve({ data: [] });
  });
}

const CATEGORIES = { data: [
  { id: 5, name: 'Bikes', slug: 'bikes' },
  { id: 6, name: 'Books', slug: 'books' }
] };
const BIKE_TEMPLATE = { data: {
  id: 1,
  category_id: 5,
  name: 'Bikes',
  fields: [
    { key: 'brand', label: 'Brand', type: 'text', required: true },
    { key: 'frame_size', label: 'Frame size', type: 'select', options: ['S', 'M', 'L'] },
    { key: 'gears', label: 'Gears', type: 'number' }
  ]
} };
const NO_TEMPLATE = { data: { category_id: 6, name: null, fields: [] } };

const baseHandlers = () => [
  [['GET', /^\/categories$/], CATEGORIES],
  [['GET', /^\/categories\/5\/template$/], BIKE_TEMPLATE],
  [['GET', /^\/categories\/6\/template$/], NO_TEMPLATE]
];

const validListing = {
  title: 'Road bike',
  description: 'Fast and light.',
  price_type: 'free',
  delivery_method: 'pickup',
  category_id: '5'
};

const escaped = (text) => String(text).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');

function postedListing(method) {
  const call = api.callMarketplaceApi.mock.calls.find((c) => c[1] === method && /^\/listings(\/\d+)?$/.test(c[2]));
  return call ? call[3] : undefined;
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: 101 } });
  api.callMerchantOnboardingApi.mockResolvedValue({ data: {} });
  api.uploadMarketplaceListingVideo.mockResolvedValue({ data: { video_url: '/storage/v.mp4' } });
  api.uploadMarketplaceListingImages.mockResolvedValue({ data: [] });
});

// ---------------------------------------------------------------------------
// 1. Category-specific fields
// ---------------------------------------------------------------------------

describe('category-specific fields on the listing form', () => {
  it('offers a no-JavaScript way to show a category\'s fields', async () => {
    routeApi(baseHandlers());
    const res = await request(createApp()).get('/marketplace/create');
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="form_action" value="show_category_fields"');
    expect(res.text).toContain(t('govuk_alpha_commerce.listing_template.show_fields_button'));
    // No category chosen yet: no template is fetched and no fields are drawn.
    expect(api.callMarketplaceApi).not.toHaveBeenCalledWith('test-token', 'GET', expect.stringMatching(/template/));
    expect(res.text).not.toContain('name="template_brand"');
  });

  it('redraws the form with the chosen category\'s fields, keeping what was typed, without creating anything', async () => {
    routeApi(baseHandlers());
    const agent = request.agent(createApp());
    const refresh = await agent.post('/marketplace/create').type('form')
      .send({ ...validListing, title: 'Keep this title', form_action: 'show_category_fields' });
    expect(refresh.status).toBe(302);
    expect(refresh.headers.location).toBe('/marketplace/create#template-fields');
    expect(postedListing('POST')).toBeUndefined();

    const page = await agent.get('/marketplace/create');
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'GET', '/categories/5/template');
    expect(page.text).toContain('value="Keep this title"');
    expect(page.text).toContain('id="template-fields"');
    expect(page.text).toContain(t('govuk_alpha_commerce.listing_template.heading'));
    expect(page.text).toContain('name="template_brand"');
    expect(page.text).toContain('>Brand</label>');
    expect(page.text).toContain('name="template_frame_size"');
    expect(page.text).toContain('<option value="M"');
    expect(page.text).toMatch(/name="template_gears" type="text" inputmode="numeric"/);
    // Nothing is reported as an error on a redraw.
    expect(page.text).not.toContain('govuk-error-summary');
  });

  it('sends only the filled-in fields as template_data', async () => {
    routeApi([...baseHandlers(), [['POST', /^\/listings$/], { data: { id: 77 } }]]);
    const res = await request(createApp()).post('/marketplace/create').type('form')
      .send({ ...validListing, template_brand: ' Raleigh ', template_frame_size: 'M', template_gears: '' });
    expect(res.headers.location).toBe('/marketplace/77?status=listing-created');
    expect(postedListing('POST').template_data).toEqual({ brand: 'Raleigh', frame_size: 'M' });
  });

  it('refuses a missing required field, a non-number and an unknown option, and replays the answers', async () => {
    routeApi(baseHandlers());
    const agent = request.agent(createApp());
    const res = await agent.post('/marketplace/create').type('form')
      .send({ ...validListing, template_brand: '', template_frame_size: 'XXL', template_gears: 'lots' });
    expect(res.headers.location).toBe('/marketplace/create?status=listing-validation');
    expect(postedListing('POST')).toBeUndefined();

    const page = await agent.get('/marketplace/create');
    expect(page.text).toContain(`<a href="#template-brand">${t('govuk_alpha_commerce.listing_template.error_required', { field: 'Brand' })}</a>`);
    expect(page.text).toContain(`<a href="#template-frame_size">${t('govuk_alpha_commerce.listing_template.error_option', { field: 'Frame size' })}</a>`);
    expect(page.text).toContain(`<a href="#template-gears">${t('govuk_alpha_commerce.listing_template.error_number', { field: 'Gears' })}</a>`);
    expect(page.text).toContain('value="lots"');
    expect(page.text).toContain('id="template-brand-error"');
  });

  it('sends no template_data for a category without a template', async () => {
    routeApi([...baseHandlers(), [['POST', /^\/listings$/], { data: { id: 78 } }]]);
    await request(createApp()).post('/marketplace/create').type('form')
      .send({ ...validListing, category_id: '6', template_brand: 'Ignored' });
    expect(postedListing('POST')).not.toHaveProperty('template_data');
  });

  it('fills the edit form from the listing and saves the fields, clearing them when all are emptied', async () => {
    const listing = { id: 42, title: 'Old bike', description: 'Used.', price_type: 'free', category_id: 5, is_own: true,
      template_data: { brand: 'Dawes', frame_size: 'L' } };
    routeApi([...baseHandlers(), [['GET', /^\/listings\/42$/], { data: listing }], [['PUT', /^\/listings\/42$/], { data: listing }]]);
    const app = createApp();
    const page = await request(app).get('/marketplace/42/edit');
    expect(page.text).toContain('name="template_brand" type="text" value="Dawes"');
    expect(page.text).toMatch(/<option value="L"\s+selected/);

    await request(app).post('/marketplace/42/update').type('form')
      .send({ ...validListing, template_brand: 'Dawes', template_frame_size: 'S' });
    expect(postedListing('PUT').template_data).toEqual({ brand: 'Dawes', frame_size: 'S' });

    api.callMarketplaceApi.mockClear();
    routeApi([...baseHandlers(), [['GET', /^\/listings\/42$/], { data: listing }], [['PUT', /^\/listings\/42$/], { data: listing }]]);
    // Brand is required, so use the no-template category to show clearing is not forced;
    // with the template category and every optional field empty, template_data is null.
    const optionalOnly = { data: { category_id: 5, fields: [{ key: 'gears', label: 'Gears', type: 'number' }] } };
    routeApi([[['GET', /^\/categories\/5\/template$/], optionalOnly], [['PUT', /^\/listings\/42$/], { data: listing }]]);
    await request(app).post('/marketplace/42/update').type('form').send({ ...validListing, template_gears: '' });
    expect(postedListing('PUT').template_data).toBeNull();
  });

  it('redraws the edit form for a newly chosen category', async () => {
    const listing = { id: 42, title: 'Old bike', description: 'Used.', price_type: 'free', category_id: 6, is_own: true };
    routeApi([...baseHandlers(), [['GET', /^\/listings\/42$/], { data: listing }]]);
    const agent = request.agent(createApp());
    const refresh = await agent.post('/marketplace/42/update').type('form')
      .send({ ...validListing, category_id: '5', form_action: 'show_category_fields' });
    expect(refresh.headers.location).toBe('/marketplace/42/edit#template-fields');
    expect(postedListing('PUT')).toBeUndefined();
    const page = await agent.get('/marketplace/42/edit');
    expect(page.text).toContain('name="template_brand"');
  });

  it('labels the listing page\'s item details with the category\'s own field names', async () => {
    routeApi([...baseHandlers(), [['GET', /^\/listings\/42$/], { data: {
      id: 42, title: 'Bike', description: 'Nice.', price_type: 'free', category_id: 5,
      template_data: { frame_size: 'M', colour: 'Red' }
    } }]]);
    const res = await request(createApp()).get('/marketplace/42');
    expect(res.text).toContain(t('govuk_alpha_commerce.detail.item_details'));
    expect(res.text).toContain('Frame size');
    // A key the template no longer defines still shows, humanised.
    expect(res.text).toContain('Colour');
  });
});

// ---------------------------------------------------------------------------
// 2. Listing video
// ---------------------------------------------------------------------------

describe('listing video', () => {
  it('offers a video on the create form', async () => {
    routeApi(baseHandlers());
    const res = await request(createApp()).get('/marketplace/create');
    expect(res.text).toContain('name="video" type="file" accept="video/mp4,video/webm,video/quicktime"');
    expect(res.text).toContain(t('govuk_alpha_commerce.listing_video.hint'));
  });

  it('uploads the chosen video once the listing exists', async () => {
    routeApi([...baseHandlers(), [['POST', /^\/listings$/], { data: { id: 77 } }]]);
    let request_ = request(createApp()).post('/marketplace/create');
    Object.entries({ ...validListing, category_id: '6' }).forEach(([key, value]) => { request_ = request_.field(key, value); });
    const res = await request_.attach('video', MP4, { filename: 'ride.mp4', contentType: 'video/mp4' });
    expect(res.headers.location).toBe('/marketplace/77?status=listing-created');
    const [token, id, file] = api.uploadMarketplaceListingVideo.mock.calls[0];
    expect(token).toBe('test-token');
    expect(id).toBe(77);
    expect(file.filename).toBe('ride.mp4');
    expect(file.contentType).toBe('video/mp4');
    expect(Buffer.isBuffer(file.buffer)).toBe(true);
  });

  it('refuses a file that is not MP4, WebM or MOV before creating anything', async () => {
    routeApi(baseHandlers());
    const agent = request.agent(createApp());
    let request_ = agent.post('/marketplace/create');
    Object.entries({ ...validListing, category_id: '6' }).forEach(([key, value]) => { request_ = request_.field(key, value); });
    const res = await request_.attach('video', Buffer.from('GIF89a'), { filename: 'clip.gif', contentType: 'image/gif' });
    expect(res.headers.location).toBe('/marketplace/create?status=listing-validation');
    expect(postedListing('POST')).toBeUndefined();
    const page = await agent.get('/marketplace/create');
    expect(page.text).toContain(`<a href="#video">${t('govuk_alpha_commerce.listing_video.error_type')}</a>`);
  });

  it('sends the seller to the video page when the listing was created but the video failed', async () => {
    routeApi([...baseHandlers(), [['POST', /^\/listings$/], { data: { id: 77 } }]]);
    api.uploadMarketplaceListingVideo.mockRejectedValueOnce(new api.ApiError('bad', 422));
    let request_ = request(createApp()).post('/marketplace/create');
    Object.entries({ ...validListing, category_id: '6' }).forEach(([key, value]) => { request_ = request_.field(key, value); });
    const res = await request_.attach('video', MP4, { filename: 'ride.mp4', contentType: 'video/mp4' });
    expect(res.headers.location).toBe('/marketplace/77/video?status=created-video-failed');
  });

  const OWN = { id: 42, title: 'Bike', description: 'Nice.', price_type: 'free', is_own: true };

  it('lets the seller see, replace and remove the video on its own page', async () => {
    routeApi([[['GET', /^\/listings\/42$/], { data: { ...OWN, video_url: '/storage/uploads/marketplace/videos/2/a.mp4' } }]]);
    const page = await request(createApp()).get('/marketplace/42/video');
    expect(page.status).toBe(200);
    expect(page.text).toContain('<video');
    expect(page.text).toContain('controls');
    expect(page.text).toContain('a.mp4');
    expect(page.text).toContain('enctype="multipart/form-data"');
    expect(page.text).toContain('href="/marketplace/42/video/remove"');
  });

  it('is forbidden to anyone but the seller', async () => {
    routeApi([[['GET', /^\/listings\/42$/], { data: { ...OWN, is_own: false } }]]);
    const page = await request(createApp()).get('/marketplace/42/video');
    expect(page.status).toBe(403);
  });

  it('uploads a video from its page and refuses a missing or wrong file', async () => {
    routeApi([[['GET', /^\/listings\/42$/], { data: OWN }]]);
    const agent = request.agent(createApp());
    const ok = await agent.post('/marketplace/42/video').attach('video', MP4, { filename: 'ride.webm', contentType: 'video/webm' });
    expect(ok.headers.location).toBe('/marketplace/42/video?status=uploaded');
    expect(api.uploadMarketplaceListingVideo.mock.calls[0][1]).toBe(42);

    api.uploadMarketplaceListingVideo.mockClear();
    const none = await agent.post('/marketplace/42/video').type('form').send({});
    expect(none.headers.location).toBe('/marketplace/42/video');
    expect(api.uploadMarketplaceListingVideo).not.toHaveBeenCalled();
    const page = await agent.get('/marketplace/42/video');
    expect(page.text).toContain(t('govuk_alpha_commerce.listing_video.error_none'));
    expect(page.text).toContain('href="#video"');
  });

  it('shows the API\'s own reason when it refuses the upload', async () => {
    routeApi([[['GET', /^\/listings\/42$/], { data: OWN }]]);
    api.uploadMarketplaceListingVideo.mockRejectedValueOnce(new api.ApiError('Video must be under 50MB.', 422));
    const agent = request.agent(createApp());
    await agent.post('/marketplace/42/video').attach('video', MP4, { filename: 'ride.mov', contentType: 'video/quicktime' });
    const page = await agent.get('/marketplace/42/video');
    expect(page.text).toContain('Video must be under 50MB.');
  });

  it('removes the video after a confirmation', async () => {
    routeApi([[['GET', /^\/listings\/42$/], { data: { ...OWN, video_url: '/storage/a.mp4' } }], [['DELETE', /^\/listings\/42\/video$/], {}]]);
    const app = createApp();
    const confirm = await request(app).get('/marketplace/42/video/remove');
    expect(confirm.text).toContain(t('govuk_alpha_commerce.listing_video.remove_heading'));
    const res = await request(app).post('/marketplace/42/video/remove').type('form').send({});
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'DELETE', '/listings/42/video');
    expect(res.headers.location).toBe('/marketplace/42/video?status=removed');
  });

  it('shows the video on the listing page with a download link and a text alternative', async () => {
    routeApi([[['GET', /^\/listings\/42$/], { data: { ...OWN, is_own: false, video_url: '/storage/uploads/marketplace/videos/2/a.mp4' } }]]);
    const res = await request(createApp()).get('/marketplace/42');
    expect(res.text).toMatch(/<video[^>]*controls[^>]*>/);
    expect(res.text).toContain(t('govuk_alpha_commerce.listing_video.download'));
    expect(res.text).toContain(escaped(t('govuk_alpha_commerce.listing_video.text_alternative')));
  });

  it('links to the video page from the edit form', async () => {
    routeApi([...baseHandlers(), [['GET', /^\/listings\/42$/], { data: { ...OWN, category_id: 6 } }]]);
    const res = await request(createApp()).get('/marketplace/42/edit');
    expect(res.text).toContain('href="/marketplace/42/video"');
  });
});

// ---------------------------------------------------------------------------
// 4. Seller coupon form
// ---------------------------------------------------------------------------

describe('seller coupon form: start date, uses per member and scope', () => {
  const couponHandlers = (coupon) => [
    [['GET', /^\/categories$/], CATEGORIES],
    [['GET', /^\/listings\?/], { data: [{ id: 3, title: 'Red kettle', status: 'active' }, { id: 4, title: 'Blue lamp', status: 'active' }] }],
    [['GET', /^\/seller\/coupons$/], { data: coupon ? [coupon] : [] }],
    [['POST', /^\/seller\/coupons$/], { data: { id: 9 } }],
    [['PUT', /^\/seller\/coupons\/\d+$/], { data: { id: 9 } }]
  ];

  function lastCouponPayload(method) {
    const calls = api.callMarketplaceApi.mock.calls.filter((c) => c[1] === method && /^\/seller\/coupons/.test(c[2]));
    return calls.length ? calls[calls.length - 1][3] : undefined;
  }

  it('shows the new fields, with the seller\'s own active listings and the categories to choose from', async () => {
    routeApi(couponHandlers());
    const res = await request(createApp()).get('/marketplace/coupons/new');
    expect(res.status).toBe(200);
    expect(api.callMarketplaceApi).toHaveBeenCalledWith('test-token', 'GET', '/listings?user_id=101&status=active&limit=100');
    expect(res.text).toContain('name="valid_from-day"');
    expect(res.text).toContain('name="max_uses_per_member"');
    expect(res.text).toContain('name="applies_to" type="radio" value="all_listings" checked');
    expect(res.text).toContain('value="listing_ids"');
    expect(res.text).toContain('value="category_ids"');
    expect(res.text).toContain('name="applies_to_listing_ids" type="checkbox" value="3"');
    expect(res.text).toContain('Red kettle');
    expect(res.text).toContain('name="applies_to_category_ids" type="checkbox" value="6"');
    expect(res.text).toContain('Books');
  });

  it('sends the start date, uses per member and chosen listings', async () => {
    routeApi(couponHandlers());
    const res = await request(createApp()).post('/marketplace/coupons/new').type('form').send({
      title: 'Spring', discount_type: 'percent', discount_value: '10', status: 'active',
      'valid_from-day': '1', 'valid_from-month': '11', 'valid_from-year': '2026',
      max_uses_per_member: '2',
      applies_to: 'listing_ids', applies_to_listing_ids: ['3', '4'], applies_to_category_ids: ['6']
    });
    expect(res.headers.location).toBe('/marketplace/coupons?status=coupon-created');
    expect(lastCouponPayload('POST')).toEqual({
      title: 'Spring',
      description: '',
      discount_type: 'percent',
      discount_value: 10,
      status: 'active',
      valid_from: '2026-11-01',
      max_uses_per_member: 2,
      applies_to: 'listing_ids',
      applies_to_ids: [3, 4]
    });
  });

  it('sends chosen categories', async () => {
    routeApi(couponHandlers());
    await request(createApp()).post('/marketplace/coupons/new').type('form').send({
      title: 'Books week', discount_type: 'percent', discount_value: '5', status: 'draft',
      applies_to: 'category_ids', applies_to_category_ids: '6'
    });
    expect(lastCouponPayload('POST')).toMatchObject({ applies_to: 'category_ids', applies_to_ids: [6] });
  });

  it('refuses a scope with nothing chosen, a bad uses-per-member and an unreal start date', async () => {
    routeApi(couponHandlers());
    const agent = request.agent(createApp());
    const res = await agent.post('/marketplace/coupons/new').type('form').send({
      title: 'Spring', discount_type: 'percent', discount_value: '10', status: 'active',
      'valid_from-day': '31', 'valid_from-month': '2', 'valid_from-year': '2026',
      max_uses_per_member: '0',
      applies_to: 'listing_ids'
    });
    expect(res.headers.location).toBe('/marketplace/coupons/new');
    expect(lastCouponPayload('POST')).toBeUndefined();
    const page = await agent.get('/marketplace/coupons/new');
    expect(page.text).toContain(`<a href="#applies_to-listing_ids">${t('govuk_alpha_commerce.coupon_scope.error_target_required')}</a>`);
    expect(page.text).toContain(`<a href="#max_uses_per_member">${t('govuk_alpha_commerce.coupon_scope.error_max_uses_per_member')}</a>`);
    expect(page.text).toContain('<a href="#valid_from-day">');
    expect(page.text).toContain('name="applies_to" type="radio" value="listing_ids" checked');
  });

  it('fills the edit form from the coupon and keeps a chosen listing that is no longer active', async () => {
    const coupon = { id: 9, title: 'Scoped', discount_type: 'percent', discount_value: 10, status: 'active',
      valid_from: '2026-11-01T00:00:00+00:00', max_uses_per_member: 3, applies_to: 'listing_ids', applies_to_ids: [3, 55] };
    routeApi(couponHandlers(coupon));
    const page = await request(createApp()).get('/marketplace/coupons/9/edit');
    expect(page.text).toContain('name="max_uses_per_member" type="text" inputmode="numeric" value="3"');
    expect(page.text).toContain('name="valid_from-year" type="text" value="2026"');
    expect(page.text).toContain('name="applies_to" type="radio" value="listing_ids" checked');
    expect(page.text).toContain('name="applies_to_listing_ids" type="checkbox" value="3" checked');
    expect(page.text).toContain('name="applies_to_listing_ids" type="checkbox" value="55" checked');
    expect(page.text).toContain(t('govuk_alpha_commerce.coupon_scope.listing_fallback', { id: 55 }));
  });

  it('saves the scope on edit, and widens it only when the seller chooses all listings', async () => {
    routeApi(couponHandlers());
    const app = createApp();
    await request(app).post('/marketplace/coupons/9/update').type('form').send({
      title: 'Scoped', discount_type: 'percent', discount_value: '10', status: 'active',
      applies_to: 'category_ids', applies_to_category_ids: ['6', '5'], max_uses_per_member: ''
    });
    const update = lastCouponPayload('PUT');
    expect(update).toMatchObject({ applies_to: 'category_ids', applies_to_ids: [6, 5] });
    // Left blank on an edit: the stored per-member limit is kept.
    expect(update).not.toHaveProperty('max_uses_per_member');

    await request(app).post('/marketplace/coupons/9/update').type('form').send({
      title: 'Scoped', discount_type: 'percent', discount_value: '10', status: 'active', applies_to: 'all_listings'
    });
    const widened = lastCouponPayload('PUT');
    expect(widened.applies_to).toBe('all_listings');
    expect(widened).not.toHaveProperty('applies_to_ids');
  });
});
