// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Seller onboarding: opening hours and shop photos (React MerchantOnboardingPage).
 *
 * React's wizard asks for opening hours (step 2, `opening_hours`
 * {mon..sun: {open, close} | null}) and an optional profile photo and cover
 * image (uploaded to POST /v2/merchant-onboarding/image, then step 3, which
 * requires `avatar_url`). The accessible form sent identity and address only.
 * MerchantOnboardingService::completeOnboarding does not need step 3, so photos
 * stay optional.
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
const { parseMultipartForm } = require('../src/middleware/multipart');
const marketplaceRoutes = require('../src/routes/marketplace');
const marketplaceActionRoutes = require('../src/routes/marketplace-actions');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function createApp({ uploads = false } = {}) {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));
  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  if (uploads) {
    app.locals.marketplaceOnboardingUploads = true;
    app.use('/marketplace/onboarding', parseMultipartForm({ maxFileSize: 10 * 1024 * 1024, maxFiles: 2 }));
  }
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'marketplace-onboarding-test-secret', resave: false, saveUninitialized: false }));
  app.use((req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.accessibleRouting = { tenant: { id: 2, slug: 'acme', name: 'Acme', settings: {} } };
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
      t,
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

function mockOnboarding(profile = {}) {
  api.callMerchantOnboardingApi.mockImplementation((token, method, apiPath) => {
    if (method === 'GET' && apiPath === '/status') {
      return Promise.resolve({ data: { onboarding_completed: false, profile } });
    }
    return Promise.resolve({ data: { profile: {} } });
  });
  api.uploadMerchantOnboardingImage.mockImplementation((token, field) => Promise.resolve({ data: { url: `https://cdn.example/${field}.png` } }));
}

function hoursBody(overrides = {}) {
  const body = { seller_type: 'private', display_name: 'Ann' };
  for (const day of DAYS) {
    if (day === 'sun') {
      body.hours_sun_closed = '1';
    } else {
      body[`hours_${day}_open`] = '09:00';
      body[`hours_${day}_close`] = '17:30';
    }
  }
  return { ...body, ...overrides };
}

function postedTo(apiPath) {
  return api.callMerchantOnboardingApi.mock.calls.filter(([, method, p]) => method === 'POST' && p === apiPath);
}

function multipartPost(app, body) {
  let req = request(app).post('/marketplace/onboarding');
  for (const [key, value] of Object.entries(body)) req = req.field(key, value);
  return req;
}

describe('seller onboarding: opening hours', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows saved hours, with a closed day ticked', async () => {
    mockOnboarding({ opening_hours: JSON.stringify({ mon: { open: '08:00', close: '16:00' }, sun: null }) });
    const res = await request(createApp()).get('/marketplace/onboarding');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_commerce.onboarding.section_hours'));
    expect(res.text).toMatch(/id="hours_mon_open"[^>]*value="08:00"/);
    expect(res.text).toMatch(/id="hours_mon_close"[^>]*value="16:00"/);
    expect(res.text).toMatch(/id="hours_sun_closed"[^>]*checked/);
    expect(res.text).not.toMatch(/id="hours_mon_closed"[^>]*checked/);
    for (const day of DAYS) expect(res.text).toContain(t(`govuk_alpha_commerce.onboarding.day_${day}`));
  });

  it('starts new sellers on Monday to Saturday, 09:00 to 18:00, as React does', async () => {
    mockOnboarding({});
    const res = await request(createApp()).get('/marketplace/onboarding');
    expect(res.text).toMatch(/id="hours_sat_open"[^>]*value="09:00"/);
    expect(res.text).toMatch(/id="hours_sat_close"[^>]*value="18:00"/);
    expect(res.text).toMatch(/id="hours_sun_closed"[^>]*checked/);
  });

  it('sends the hours with step 2 and still completes without a photo', async () => {
    mockOnboarding({});
    const res = await request(createApp()).post('/marketplace/onboarding').type('form').send(hoursBody());
    expect(res.headers.location).toBe('/marketplace/onboarding?status=onboarding-complete');
    const [[, , , body]] = postedTo('/step-2');
    expect(body.opening_hours).toEqual({
      mon: { open: '09:00', close: '17:30' },
      tue: { open: '09:00', close: '17:30' },
      wed: { open: '09:00', close: '17:30' },
      thu: { open: '09:00', close: '17:30' },
      fri: { open: '09:00', close: '17:30' },
      sat: { open: '09:00', close: '17:30' },
      sun: null
    });
    expect(postedTo('/step-3')).toHaveLength(0);
    expect(postedTo('/complete')).toHaveLength(1);
  });

  it('refuses an open day without both times, and replays what was typed', async () => {
    mockOnboarding({});
    const agent = request.agent(createApp());
    const post = await agent.post('/marketplace/onboarding').type('form')
      .send(hoursBody({ hours_tue_close: '', bio: 'Fresh bread' }));
    expect(post.headers.location).toBe('/marketplace/onboarding');
    expect(postedTo('/step-1')).toHaveLength(0);
    const page = await agent.get('/marketplace/onboarding');
    expect(page.text).toContain('href="#hours_tue_open"');
    expect(page.text).toContain(t('govuk_alpha_commerce.onboarding.error_hours'));
    expect(page.text).toContain('Fresh bread');
    expect(page.text).toMatch(/id="hours_mon_close"[^>]*value="17:30"/);
  });
});

describe('seller onboarding: shop photos', () => {
  beforeEach(() => jest.clearAllMocks());

  it('offers no file fields until the server parses uploads on this form', async () => {
    mockOnboarding({});
    const res = await request(createApp()).get('/marketplace/onboarding');
    expect(res.text).not.toContain('type="file"');
    expect(res.text).not.toContain('multipart/form-data');
  });

  it('offers optional photo fields when uploads are available', async () => {
    mockOnboarding({});
    const res = await request(createApp({ uploads: true })).get('/marketplace/onboarding');
    expect(res.text).toContain('enctype="multipart/form-data"');
    expect(res.text).toMatch(/name="avatar" type="file"/);
    expect(res.text).toMatch(/name="cover_image" type="file"/);
  });

  it('uploads a profile photo and cover, then saves step 3', async () => {
    mockOnboarding({});
    const res = await multipartPost(createApp({ uploads: true }), hoursBody())
      .attach('avatar', PNG, { filename: 'shop.png', contentType: 'image/png' })
      .attach('cover_image', PNG, { filename: 'cover.png', contentType: 'image/png' });

    expect(res.headers.location).toBe('/marketplace/onboarding?status=onboarding-complete');
    expect(api.uploadMerchantOnboardingImage).toHaveBeenCalledWith('test-token', 'avatar', expect.objectContaining({ filename: 'shop.png' }));
    expect(api.uploadMerchantOnboardingImage).toHaveBeenCalledWith('test-token', 'cover_image', expect.objectContaining({ filename: 'cover.png' }));
    const [[, , , body]] = postedTo('/step-3');
    expect(body).toEqual({ avatar_url: 'https://cdn.example/avatar.png', cover_image_url: 'https://cdn.example/cover_image.png' });
    expect(postedTo('/complete')).toHaveLength(1);
  });

  it('refuses a cover image on its own, before anything is sent', async () => {
    mockOnboarding({});
    const agent = request.agent(createApp({ uploads: true }));
    let req = agent.post('/marketplace/onboarding');
    for (const [key, value] of Object.entries(hoursBody())) req = req.field(key, value);
    const res = await req.attach('cover_image', PNG, { filename: 'cover.png', contentType: 'image/png' });
    expect(res.headers.location).toBe('/marketplace/onboarding');
    expect(api.uploadMerchantOnboardingImage).not.toHaveBeenCalled();
    expect(postedTo('/step-1')).toHaveLength(0);
    const page = await agent.get('/marketplace/onboarding');
    expect(page.text).toContain(t('govuk_alpha_commerce.onboarding.error_cover_needs_photo'));
    expect(page.text).toContain('href="#avatar"');
  });

  it('refuses a file that is not an image', async () => {
    mockOnboarding({});
    const res = await multipartPost(createApp({ uploads: true }), hoursBody())
      .attach('avatar', Buffer.from('%PDF-1.4'), { filename: 'notes.pdf', contentType: 'application/pdf' });
    expect(res.headers.location).toBe('/marketplace/onboarding');
    expect(api.uploadMerchantOnboardingImage).not.toHaveBeenCalled();
  });
});
