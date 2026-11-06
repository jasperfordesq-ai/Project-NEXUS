// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Each step moves on to the next step the COMMUNITY has, not the next one in
 * the fixed list. The server leaves Safeguarding out when a community has no
 * safeguarding questions, and a community can switch Skills off. Walking the
 * fixed list sent the member to a step that does not exist for them, which
 * bounced to /onboarding and back to Welcome — a loop they could not leave.
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
const t = createTranslator('en');

function buildApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'onboarding-step-order-test', resave: false, saveUninitialized: true }));
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

function config(slugs) {
  return { data: { steps: slugs.map((slug) => ({ slug, label: slug, required: false })), config: {} } };
}

describe('moving to the next step', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getOnboardingStatus.mockResolvedValue({ data: { onboarding_completed: false } });
    api.getOnboardingConfig.mockResolvedValue(config(['welcome', 'profile', 'skills', 'confirm']));
    api.updateProfile.mockResolvedValue({ data: {} });
  });

  it('goes from Skills to Confirm when the community has no Safeguarding step', async () => {
    const response = await request(buildApp()).post('/onboarding/skills').type('form').send({ offers_other: 'Gardening' });
    expect(response.headers.location).toBe('/onboarding/confirm');
  });

  it('goes from Profile to Safeguarding when the community has switched Skills off', async () => {
    api.getOnboardingConfig.mockResolvedValue(config(['welcome', 'profile', 'safeguarding', 'confirm']));
    const response = await request(buildApp()).post('/onboarding/profile').type('form').send({ bio: 'About me here' });
    expect(response.headers.location).toBe('/onboarding/safeguarding');
  });

  it('still goes from Skills to Safeguarding when the community has it', async () => {
    api.getOnboardingConfig.mockResolvedValue(config(['welcome', 'profile', 'skills', 'safeguarding', 'confirm']));
    const response = await request(buildApp()).post('/onboarding/skills').type('form').send({ offers_other: 'Gardening' });
    expect(response.headers.location).toBe('/onboarding/safeguarding');
  });
});
