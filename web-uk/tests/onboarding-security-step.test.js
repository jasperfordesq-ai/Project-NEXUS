// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The optional "Protect your account" step (slug `security`). The server only
 * lists it for members who may set up two-factor; the page also skips itself
 * when two-factor is already on or not allowed. "Set up two-factor" hands over
 * to the existing /profile/two-factor flow with a return address; "Not now"
 * moves on and records nothing.
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
    getTwoFactorStatus: jest.fn(),
    uploadProfileAvatar: jest.fn(),
    updateProfile: jest.fn(),
    saveOnboardingSafeguarding: jest.fn(),
    getUserSkills: jest.fn(),
    getProfile: jest.fn(),
    invalidateUserCache: jest.fn(),
    callProfileApi: jest.fn(),
    callWebAuthnApi: jest.fn()
  };
});

const api = require('../src/lib/api');
const onboardingRoutes = require('../src/routes/onboarding-posts');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');

function buildApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'onboarding-security-step-test', resave: false, saveUninitialized: true }));
  app.use('/onboarding', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'acme', prefix: '', tenant: { id: 2, slug: 'acme' } };
    res.locals.urlFor = (value) => String(value || '/');
    Object.assign(res.locals, {
      t,
      tc: createChoiceTranslator('en'),
      serviceName: 'Project NEXUS',
      tenantName: 'Acme Timebank',
      isAuthenticated: true,
      csrfToken: 'test-csrf-token',
      alphaNavItems: [],
      alphaLocaleOptions: [],
      alphaLanguageQueryParams: [],
      htmlLang: 'en',
      htmlDirection: 'ltr',
      formatLocaleNumber: (value) => String(value ?? ''),
      formatLocaleDate: (value) => String(value ?? '')
    });
    next();
  }, onboardingRoutes);
  return app;
}

const WITH_SECURITY = ['welcome', 'profile', 'skills', 'safeguarding', 'security', 'confirm'];

function config(slugs) {
  return { data: { steps: slugs.map((slug) => ({ slug, label: slug, required: false })), config: {} } };
}

describe('the "Protect your account" onboarding step', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getOnboardingStatus.mockResolvedValue({ data: { onboarding_completed: false } });
    api.getOnboardingConfig.mockResolvedValue(config(WITH_SECURITY));
    api.getTwoFactorStatus.mockResolvedValue({ data: { enabled: false, enrollment_allowed: true } });
  });

  it('keeps the security slug when the community lists it', () => {
    const steps = onboardingRoutes.normalizeSteps(config(WITH_SECURITY).data.steps);
    expect(steps.map((item) => item.slug)).toEqual(WITH_SECURITY);
    expect(steps.find((item) => item.slug === 'security').required).toBe(false);
  });

  it('never invents the step when the community list is empty', () => {
    const steps = onboardingRoutes.normalizeSteps([]);
    expect(steps.map((item) => item.slug)).not.toContain('security');
  });

  it('renders the explanation with both "Set up two-factor" and "Not now"', async () => {
    const response = await request(buildApp()).get('/onboarding/security');
    expect(response.status).toBe(200);
    expect(api.getTwoFactorStatus).toHaveBeenCalledWith('token:test');
    expect(response.text).toContain('Protect your account');
    expect(response.text).toContain('authenticator app on your phone');
    expect(response.text).toContain('This is optional.');
    expect(response.text).toContain('href="/profile/two-factor?return=%2Fonboarding%2Fsecurity"');
    expect(response.text).toContain('Set up two-factor');
    expect(response.text).toMatch(/<form method="post" action="\/onboarding\/security"/);
    expect(response.text).toContain('Not now');
    // Step 5 of 6 in this community.
    expect(response.text).toMatch(/5[^0-9]+6/);
  });

  it('skips itself when two-factor is already on', async () => {
    api.getTwoFactorStatus.mockResolvedValue({ data: { enabled: true, enrollment_allowed: true } });
    const response = await request(buildApp()).get('/onboarding/security');
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/onboarding/confirm');
  });

  it('skips itself when the member may not set it up', async () => {
    api.getTwoFactorStatus.mockResolvedValue({ data: { enabled: false, enrollment_allowed: false } });
    const response = await request(buildApp()).get('/onboarding/security');
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/onboarding/confirm');
  });

  it('skips itself when the status cannot be read', async () => {
    api.getTwoFactorStatus.mockRejectedValue(new api.ApiError('Server error', 500));
    const response = await request(buildApp()).get('/onboarding/security');
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/onboarding/confirm');
  });

  it('is skipped, onward to the next listed step, when the community has not listed it', async () => {
    api.getOnboardingConfig.mockResolvedValue(config(['welcome', 'profile', 'confirm']));
    const response = await request(buildApp()).get('/onboarding/security');
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/onboarding/confirm');
    expect(api.getTwoFactorStatus).not.toHaveBeenCalled();
  });

  it('"Not now" goes to the next step without finishing onboarding or touching two-factor', async () => {
    const response = await request(buildApp()).post('/onboarding/security').type('form').send({});
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/onboarding/confirm');
    expect(api.completeOnboarding).not.toHaveBeenCalled();
    expect(api.getTwoFactorStatus).not.toHaveBeenCalled();
    expect(api.callProfileApi).not.toHaveBeenCalled();
    expect(api.callWebAuthnApi).not.toHaveBeenCalled();
    expect(api.updateProfile).not.toHaveBeenCalled();
  });

  it('Safeguarding moves on to the security step when the community has it', async () => {
    const response = await request(buildApp()).post('/onboarding/safeguarding').type('form').send({ skip: '1' });
    expect(response.headers.location).toBe('/onboarding/security');
  });
});
