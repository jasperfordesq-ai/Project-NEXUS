// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "Where are you based?" on the accessible site (9 Oct 2026, owner decisions).
 *
 * - Only a member whose location is empty is asked. The API says so with
 *   `location_missing`; only a literal `true` counts.
 * - Onboarding asks inside the existing profile step and refuses a blank answer
 *   there — but the server never forces a location, so nothing here is required
 *   of a member who already has one.
 * - The dashboard reminder has NO dismiss control. It stays until a town is added.
 * - The registration hint no longer promises a suggestion list that does not exist.
 */

const express = require('express');
const fs = require('fs');
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
    getMemberEndorsements: jest.fn()
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
const onboardingRoutes = require('../src/routes/onboarding-posts');
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
      tenant: { id: 2, slug: 'acme', name: 'Acme Timebank' }
    };
    Object.assign(res.locals, localsFor(locale));
    next();
  }, router);
  return app;
}

const validationError = (field, message = 'Invalid') => new api.ApiError(message, 422, {
  errors: [{ code: 'VALIDATION_ERROR', message, field }]
});

describe('onboarding: profile step asks where the member is based', () => {
  const app = () => buildApp('/onboarding', onboardingRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
    api.getOnboardingStatus.mockResolvedValue({ data: { onboarding_completed: false } });
    api.getOnboardingConfig.mockResolvedValue({
      data: { steps: [{ slug: 'welcome' }, { slug: 'profile' }, { slug: 'confirm' }] }
    });
    api.updateProfile.mockResolvedValue({ data: {} });
  });

  it('shows a plain text "Where are you based?" field when location_missing is true', async () => {
    api.getProfile.mockResolvedValue({ data: { bio: '', location_missing: true } });

    const res = await request(app()).get('/onboarding/profile');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Where are you based?');
    expect(res.text).toMatch(/<input[^>]*name="location"[^>]*>/);
    expect(res.text).toMatch(/<input[^>]*name="location"[^>]*autocomplete="address-level2"/);
    // No JavaScript is needed and nothing may fill hidden coordinates.
    expect(res.text).not.toMatch(/name="latitude"/);
  });

  it.each([
    ['false', { location_missing: false }],
    ['absent (older server)', {}],
    ['a truthy string', { location_missing: 'true' }]
  ])('does not ask when location_missing is %s', async (_label, profile) => {
    api.getProfile.mockResolvedValue({ data: { bio: '', ...profile } });

    const res = await request(app()).get('/onboarding/profile');

    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/name="location"/);
  });

  it('saves the location with the bio in the same call', async () => {
    const res = await request(app())
      .post('/onboarding/profile')
      .type('form')
      .send({ _csrf: 'x', bio: 'Hello there', location: '  Coventry  ' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/onboarding/interests');
    expect(api.updateProfile).toHaveBeenCalledTimes(1);
    expect(api.updateProfile).toHaveBeenCalledWith('token:test', { bio: 'Hello there', location: 'Coventry' });
  });

  it('sends only the bio when the member already has a location (no field shown)', async () => {
    const res = await request(app())
      .post('/onboarding/profile')
      .type('form')
      .send({ _csrf: 'x', bio: 'Hello there' });

    expect(res.headers.location).toBe('/onboarding/interests');
    expect(api.updateProfile).toHaveBeenCalledWith('token:test', { bio: 'Hello there' });
  });

  it('refuses a blank answer, keeps the bio, and does not move on', async () => {
    const res = await request(app())
      .post('/onboarding/profile')
      .type('form')
      .send({ _csrf: 'x', bio: 'Hello there', location: '   ' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/onboarding/profile?status=location-required');
    // The bio the member typed is saved rather than thrown away; location is NOT sent.
    expect(api.updateProfile).toHaveBeenCalledWith('token:test', { bio: 'Hello there' });
  });

  it('shows the blank-answer error as a GOV.UK error summary plus an inline error', async () => {
    api.getProfile.mockResolvedValue({ data: { bio: '', location_missing: true } });

    const res = await request(app()).get('/onboarding/profile?status=location-required');

    expect(res.text).toContain('govuk-error-summary');
    expect(res.text).toContain('href="#location"');
    expect(res.text).toContain('Enter where you are based');
    expect(res.text).toMatch(/id="location-error"/);
    expect(res.text).toMatch(/govuk-form-group--error/);
  });

  it('turns a server complaint about the location field into our own translated message', async () => {
    api.updateProfile.mockRejectedValue(validationError('location', 'The location field must not exceed 255'));

    const res = await request(app())
      .post('/onboarding/profile')
      .type('form')
      .send({ _csrf: 'x', bio: '', location: 'x' });

    expect(res.headers.location).toBe('/onboarding/profile?status=location-invalid');
  });

  it('still reports a failed save for any other error', async () => {
    api.updateProfile.mockRejectedValue(new api.ApiError('boom', 500, {}));

    const res = await request(app())
      .post('/onboarding/profile')
      .type('form')
      .send({ _csrf: 'x', bio: '', location: 'Coventry' });

    expect(res.headers.location).toBe('/onboarding/profile?status=complete-failed');
  });

  it('shows the message in the member\'s own language', async () => {
    api.getProfile.mockResolvedValue({ data: { bio: '', location_missing: true } });

    const res = await request(buildApp('/onboarding', onboardingRoutes, 'de'))
      .get('/onboarding/profile?status=location-required');

    expect(res.text).toContain('Geben Sie ein, wo Sie ansässig sind');
    expect(res.text).toContain('Wo sind Sie ansässig?');
  });
});

describe('dashboard: the location reminder', () => {
  const app = (locale = 'en') => buildApp('/dashboard', dashboardRoutes, locale);

  beforeEach(() => {
    jest.clearAllMocks();
    api.getBalance.mockResolvedValue({ balance: 0 });
    api.getOnboardingStatus.mockResolvedValue({ data: { onboarding_completed: true } });
    api.getGamificationProfile.mockResolvedValue({ data: null });
    api.getMyBadges.mockResolvedValue({ data: [] });
    api.getListings.mockResolvedValue({ data: [] });
    api.getFeedPosts.mockResolvedValue({ data: [] });
    api.getMyEvents.mockResolvedValue({ data: [] });
    api.getExchangeAttentionCount.mockResolvedValue({ data: { count: 0, items: [] } });
    api.getMemberEndorsements.mockResolvedValue({ data: { endorsements: [] } });
    api.updateProfile.mockResolvedValue({ data: {} });
  });

  it('shows a banner with a small form when onboarding is done and location_missing is true', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 1, first_name: 'Ann', location_missing: true } });

    const res = await request(app()).get('/dashboard');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Tell us where you are based');
    expect(res.text).toMatch(/role="region"[^>]*aria-labelledby="dashboard-location-title"/);
    expect(res.text).toMatch(/<form[^>]*method="post"[^>]*action="\/dashboard\/location"/);
    expect(res.text).toContain('name="_csrf" value="test-csrf-token"');
    expect(res.text).toMatch(/<input[^>]*name="location"[^>]*autocomplete="address-level2"/);
  });

  it('also asks a member whose onboarding is not finished (the wizard may be off or optional)', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 1, location_missing: true } });
    api.getOnboardingStatus.mockResolvedValue({ data: { onboarding_completed: false } });

    const res = await request(app()).get('/dashboard');

    expect(res.status).toBe(200);
    expect(res.text).toContain('dashboard-location-title');
    expect(res.text).toContain('dashboard-onboarding-title');
  });

  it('has no way to dismiss the reminder', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 1, location_missing: true } });

    const res = await request(app()).get('/dashboard');
    const banner = res.text.slice(res.text.indexOf('dashboard-location-title') - 200);
    const bannerHtml = banner.slice(0, banner.indexOf('</form>') + 7);

    expect(bannerHtml).not.toMatch(/dismiss|close|hide|later|skip/i);
    expect(bannerHtml.match(/<button/g)).toHaveLength(1);
  });

  it.each([
    ['location_missing is false', { location_missing: false }, { onboarding_completed: true }],
    ['location_missing is absent', {}, { onboarding_completed: true }],
    ['location_missing is the string "true"', { location_missing: 'true' }, { onboarding_completed: true }],
    ['onboarding is not finished and location_missing is false', { location_missing: false }, { onboarding_completed: false }],
    ['onboarding is not finished and location_missing is absent', {}, { onboarding_completed: false }]
  ])('shows nothing when %s', async (_label, profile, onboarding) => {
    api.getProfile.mockResolvedValue({ data: { id: 1, ...profile } });
    api.getOnboardingStatus.mockResolvedValue({ data: onboarding });

    const res = await request(app()).get('/dashboard');

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('dashboard-location-title');
  });

  it('shows an error summary and an inline error after a blank submission', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 1, location_missing: true } });

    const res = await request(app()).get('/dashboard?status=location-required');

    expect(res.text).toContain('govuk-error-summary');
    expect(res.text).toContain('href="#dashboard-location"');
    expect(res.text).toContain('Enter where you are based');
    expect(res.text).toMatch(/id="dashboard-location-error"/);
  });

  it('shows a success banner after saving', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 1, location_missing: false } });

    const res = await request(app()).get('/dashboard?status=location-saved');

    expect(res.text).toContain('govuk-notification-banner--success');
    expect(res.text).toContain('Location saved');
  });

  it('POST /dashboard/location saves the trimmed town and returns with a success banner', async () => {
    const res = await request(app()).post('/dashboard/location').type('form').send({ _csrf: 'x', location: '  Coventry ' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/dashboard?status=location-saved');
    expect(api.updateProfile).toHaveBeenCalledWith('token:test', { location: 'Coventry' });
  });

  it('POST /dashboard/location with a blank answer saves nothing and shows the error state', async () => {
    const res = await request(app()).post('/dashboard/location').type('form').send({ _csrf: 'x', location: '   ' });

    expect(res.headers.location).toBe('/dashboard?status=location-required#dashboard-location');
    expect(api.updateProfile).not.toHaveBeenCalled();
  });

  it('POST /dashboard/location maps a location-field complaint to our own message', async () => {
    api.updateProfile.mockRejectedValue(validationError('location'));

    const res = await request(app()).post('/dashboard/location').type('form').send({ _csrf: 'x', location: 'x' });

    expect(res.headers.location).toBe('/dashboard?status=location-invalid#dashboard-location');
  });

  it('POST /dashboard/location reports any other failure honestly', async () => {
    api.updateProfile.mockRejectedValue(new api.ApiError('boom', 500, {}));

    const res = await request(app()).post('/dashboard/location').type('form').send({ _csrf: 'x', location: 'Coventry' });

    expect(res.headers.location).toBe('/dashboard?status=location-failed#dashboard-location');
  });

  it('lets an expired session through to the sign-in redirect', async () => {
    api.updateProfile.mockRejectedValue(new api.ApiError('expired', 401, {}));

    const res = await request(app()).post('/dashboard/location').type('form').send({ _csrf: 'x', location: 'Coventry' });

    // An expired session goes to sign-in; it must not be reported as "location failed".
    expect(res.headers.location || '').not.toContain('location-failed');
    expect(res.headers.location || '').toContain('/login');
  });
});

describe('registration hint', () => {
  it('no longer promises a suggestion list or says free text is refused (all 11 languages)', () => {
    for (const locale of ['ar', 'de', 'en', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt']) {
      const hint = createTranslator(locale)('auth.location_hint');
      // The old wording in every language promised a pick-from-a-list and refused free text.
      expect(hint).not.toMatch(/suggestion|Vorschlag|sugerencia|suggerimento|sugestão|sugestie|sugestię|اقتراح|提案|moladh|—|–/i);
      expect(hint.length).toBeGreaterThan(10);
    }
    expect(createTranslator('en')('auth.location_hint')).toBe('Type your town, city or area in your own words.');
  });
});
