// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Onboarding matches the website's wizard (React 8578ce739, 2 Oct 2026).
 *
 * The "Your interests" step is retired — nothing on the platform read its
 * answers and the API now accepts and DROPS `interests`. The skills step saves
 * skill NAMES into the member's skills (what matching, Explore and the
 * personalised feed read), sent as `skills: {offer, need, replace}`:
 *  - the community's listing categories are offered as ready-made suggestions,
 *    and the member can type others;
 *  - the member's existing skills are pre-selected, and `replace` is true only
 *    when they were loaded, so a failed read can never wipe their skills;
 *  - a member who never answered the skills step sends no skills at all.
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
  app.use(session({ secret: 'onboarding-skills-test', resave: false, saveUninitialized: true }));
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

beforeEach(() => {
  jest.clearAllMocks();
  api.getOnboardingStatus.mockResolvedValue({ data: { onboarding_completed: false } });
  api.getOnboardingConfig.mockResolvedValue(config(['welcome', 'profile', 'skills', 'confirm']));
  api.getOnboardingCategories.mockResolvedValue({ data: [{ id: 1, name: 'Gardening' }, { id: 2, name: 'Cooking' }] });
  api.getUserSkills.mockResolvedValue({ data: [
    { skill_name: 'Gardening', is_offering: 1, is_requesting: 0 },
    { skill_name: 'Welsh lessons', is_offering: 0, is_requesting: 1 }
  ] });
  api.getProfile.mockResolvedValue({ data: { id: 7, bio: 'Hello', avatar_url: '/a.png' } });
  api.completeOnboarding.mockResolvedValue({ data: { success: true } });
});

describe('the interests step is retired', () => {
  it('never routes to /onboarding/interests, even when a stale config lists it', async () => {
    api.getOnboardingConfig.mockResolvedValue(config(['welcome', 'interests', 'skills', 'confirm']));
    const response = await request(buildApp()).get('/onboarding/interests');
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/onboarding');
  });

  it('goes from the profile step straight to skills', async () => {
    api.updateProfile.mockResolvedValue({ data: {} });
    const response = await request(buildApp()).post('/onboarding/profile').type('form').send({ bio: 'About me' });
    expect(response.headers.location).toBe('/onboarding/skills');
  });
});

describe('the skills step', () => {
  it('offers category names as suggestions, pre-selects existing skills and has free-text fields', async () => {
    const response = await request(buildApp()).get('/onboarding/skills');

    expect(response.status).toBe(200);
    expect(api.getUserSkills).toHaveBeenCalledWith('token:test', 'me');
    expect(response.text).toMatch(/name="offers\[\]" type="checkbox" value="Gardening" checked>/);
    expect(response.text).toMatch(/name="offers\[\]" type="checkbox" value="Cooking">/);
    // An existing skill that is not a category is listed, so it can be unticked.
    expect(response.text).toMatch(/name="needs\[\]" type="checkbox" value="Welsh lessons" checked>/);
    expect(response.text).toContain('name="offers_other"');
    expect(response.text).toContain('name="needs_other"');
    expect(response.text).toContain(t('govuk_alpha.onboarding.skills.offers_other_label'));
    expect(response.text).not.toContain('name="interests[]"');
  });

  it('sends skill names with replace=true once existing skills were loaded', async () => {
    const agent = request.agent(buildApp());
    await agent.get('/onboarding/skills');
    await agent.post('/onboarding/skills').type('form').send({
      'offers[]': ['Gardening', 'Cooking'],
      offers_other: 'Dog walking, gardening',
      'needs[]': 'Welsh lessons',
      needs_other: ''
    });
    const confirm = await agent.get('/onboarding/confirm');
    expect(confirm.text).toContain('Gardening, Cooking, Dog walking');
    expect(confirm.text).not.toContain(t('onboarding.confirm.interests_row'));

    const done = await agent.post('/onboarding/confirm').type('form').send({});
    expect(done.headers.location).toBe('/dashboard?status=onboarding-complete');
    expect(api.completeOnboarding).toHaveBeenCalledWith('token:test', {
      skills: { offer: ['Gardening', 'Cooking', 'Dog walking'], need: ['Welsh lessons'], replace: true }
    });
    const payload = api.completeOnboarding.mock.calls[0][1];
    expect(payload).not.toHaveProperty('interests');
    expect(payload).not.toHaveProperty('offers');
  });

  it('sends replace=false when existing skills could not be read', async () => {
    api.getUserSkills.mockRejectedValue(new api.ApiError('Server error', 500));
    const agent = request.agent(buildApp());
    await agent.get('/onboarding/skills');
    await agent.post('/onboarding/skills').type('form').send({ offers_other: 'Baking' });
    await agent.post('/onboarding/confirm').type('form').send({});
    expect(api.completeOnboarding).toHaveBeenCalledWith('token:test', {
      skills: { offer: ['Baking'], need: [], replace: false }
    });
  });

  it('sends no skills for a member who never answered the skills step', async () => {
    await request(buildApp()).post('/onboarding/confirm').type('form').send({});
    expect(api.completeOnboarding).toHaveBeenCalledWith('token:test', {});
  });

  it('splits typed skills on Latin, Arabic and Japanese commas and de-duplicates by case', () => {
    expect(onboardingRoutes.collectSkillNames(['Gardening'], 'gardening, Ironing، Baking、Sewing'))
      .toEqual(['Gardening', 'Ironing', 'Baking', 'Sewing']);
  });
});
