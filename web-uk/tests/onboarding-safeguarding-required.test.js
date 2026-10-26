// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A required safeguarding step needs an answer (26 Oct 2026).
 *
 * The API now refuses POST /api/v2/onboarding/complete with 422
 * SAFEGUARDING_REQUIRED when the community made the safeguarding step required
 * and the member saved no answer (or skipped an option marked required). This
 * step used to move on with nothing saved, so the member only found out on the
 * last page with "Something went wrong". Now:
 *  - a required step with nothing chosen stays put, with the GOV.UK error
 *    summary and a field error naming the "None of these apply to me" answer;
 *  - a step that is not required still moves on with no answer, as before;
 *  - a refusal at the end sends the member back to this step with a message
 *    that says what is missing.
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
    getOnboardingStatus: jest.fn(),
    getOnboardingConfig: jest.fn(),
    getOnboardingCategories: jest.fn(),
    getOnboardingSafeguardingOptions: jest.fn(),
    completeOnboarding: jest.fn(),
    uploadProfileAvatar: jest.fn(),
    updateProfile: jest.fn(),
    saveOnboardingSafeguarding: jest.fn(),
    getUserSkills: jest.fn(),
    getProfile: jest.fn(),
    invalidateUserCache: jest.fn()
  };
});

const api = require('../src/lib/api');
const onboardingRoutes = require('../src/routes/onboarding-posts');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');

function buildApp(locale = 'en') {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  // The server keeps the raw form body for safeguarding[<id>] keys (server.js).
  app.use(express.urlencoded({
    extended: true,
    verify: (req, res, buffer) => { req.rawUrlencodedBody = buffer.toString('utf8'); }
  }));
  app.use(session({ secret: 'onboarding-safeguarding-required-test', resave: false, saveUninitialized: true }));
  app.use('/onboarding', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'acme', prefix: '', tenant: { id: 2, slug: 'acme' } };
    res.locals.urlFor = (value) => String(value || '/');
    Object.assign(res.locals, {
      t: createTranslator(locale),
      tc: createChoiceTranslator(locale),
      serviceName: 'Project NEXUS',
      tenantName: 'Acme Timebank',
      isAuthenticated: true,
      csrfToken: 'test-csrf-token',
      alphaNavItems: [],
      alphaLocaleOptions: [],
      alphaLanguageQueryParams: [],
      htmlLang: locale,
      htmlDirection: locale === 'ar' ? 'rtl' : 'ltr',
      formatLocaleNumber: (value) => String(value ?? ''),
      formatLocaleDate: (value) => String(value ?? '')
    });
    next();
  }, onboardingRoutes);
  return app;
}

function config(safeguardingRequired) {
  return {
    data: {
      steps: [
        { slug: 'welcome', required: false },
        { slug: 'profile', required: true },
        { slug: 'safeguarding', required: safeguardingRequired },
        { slug: 'confirm', required: true }
      ],
      config: {}
    }
  };
}

const OPTIONS = [
  { id: 4, option_key: 'is_vulnerable_adult', option_type: 'checkbox', label: 'I would like extra support', is_required: false },
  { id: 9, option_key: 'none_apply', option_type: 'checkbox', label: 'None of these apply to me', is_required: false }
];

beforeEach(() => {
  jest.clearAllMocks();
  api.getOnboardingStatus.mockResolvedValue({ data: { onboarding_completed: false } });
  api.getOnboardingConfig.mockResolvedValue(config(true));
  api.getOnboardingSafeguardingOptions.mockResolvedValue({ data: OPTIONS });
  api.saveOnboardingSafeguarding.mockResolvedValue({ data: {} });
  api.getProfile.mockResolvedValue({ data: { id: 7, bio: 'Hello', avatar_url: '/a.png' } });
});

describe('posting the safeguarding step', () => {
  it('stays on a required step when nothing is chosen, and saves nothing', async () => {
    const res = await request(buildApp()).post('/onboarding/safeguarding').type('form').send({ _csrf: 'x' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/onboarding/safeguarding?status=safeguarding-required');
    expect(api.saveOnboardingSafeguarding).not.toHaveBeenCalled();
  });

  it('does not let "skip" past a required step either', async () => {
    const res = await request(buildApp()).post('/onboarding/safeguarding').type('form').send({ skip: '1' });

    expect(res.headers.location).toBe('/onboarding/safeguarding?status=safeguarding-required');
  });

  it('accepts "None of these apply to me" as an answer', async () => {
    const res = await request(buildApp()).post('/onboarding/safeguarding').type('form').send({ 'safeguarding[9]': '1' });

    expect(api.saveOnboardingSafeguarding).toHaveBeenCalledWith('token:test', [{ option_id: 9, value: '1' }]);
    expect(res.headers.location).toBe('/onboarding/confirm');
  });

  it('still moves on with no answer when the step is not required', async () => {
    api.getOnboardingConfig.mockResolvedValue(config(false));

    const res = await request(buildApp()).post('/onboarding/safeguarding').type('form').send({ _csrf: 'x' });

    expect(res.headers.location).toBe('/onboarding/confirm');
    expect(api.saveOnboardingSafeguarding).not.toHaveBeenCalled();
  });
});

describe('the safeguarding step shows what is missing', () => {
  it('uses the GOV.UK error summary and a field error that names the "none apply" answer', async () => {
    const res = await request(buildApp()).get('/onboarding/safeguarding?status=safeguarding-required');

    expect(res.status).toBe(200);
    expect(res.text).toContain('govuk-error-summary');
    // The summary links to the first answer, as GOV.UK asks for checkboxes.
    expect(res.text).toContain('<a href="#sg-4">');
    expect(res.text).toContain('govuk-form-group--error');
    expect(res.text).toMatch(/id="safeguarding-error" class="govuk-error-message"/);
    expect(res.text).toContain('aria-describedby="safeguarding-error"');
    expect(res.text).toContain('Select at least one option');
    expect(res.text).toContain('None of these apply to me');
  });

  it('gives a member reading Irish an Irish message', async () => {
    const english = await request(buildApp('en')).get('/onboarding/safeguarding?status=safeguarding-required');
    const irish = await request(buildApp('ga')).get('/onboarding/safeguarding?status=safeguarding-required');

    expect(irish.text).toContain('govuk-error-summary');
    expect(irish.text).not.toContain('Select at least one option');
    expect(english.text).toContain('Select at least one option');
  });

  it('shows no error on a normal visit', async () => {
    const res = await request(buildApp()).get('/onboarding/safeguarding');

    expect(res.text).not.toContain('govuk-error-summary');
    expect(res.text).not.toContain('govuk-form-group--error');
  });
});

describe('finishing when the server still needs a safeguarding answer', () => {
  it('sends the member back to the safeguarding step with a message saying so', async () => {
    api.completeOnboarding.mockRejectedValue(new api.ApiError(
      'Please answer the safeguarding question before you finish.',
      422,
      { errors: [{ code: 'SAFEGUARDING_REQUIRED', message: 'Please answer the safeguarding question before you finish.', field: 'safeguarding' }] }
    ));

    const res = await request(buildApp()).post('/onboarding/confirm').type('form').send({ _csrf: 'x' });

    expect(res.headers.location).toBe('/onboarding/safeguarding?status=safeguarding-incomplete');
  });

  it('renders that message as an error on the safeguarding step', async () => {
    const res = await request(buildApp()).get('/onboarding/safeguarding?status=safeguarding-incomplete');

    expect(res.text).toContain('govuk-error-summary');
    expect(res.text).toContain('<a href="#sg-4">');
    expect(res.text).toContain('Answer the safeguarding question before you finish');
  });
});
