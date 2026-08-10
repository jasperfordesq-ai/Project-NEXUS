// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const path = require('path');
const express = require('express');
const session = require('express-session');
const nunjucks = require('nunjucks');
const request = require('supertest');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  },
  ApiOfflineError: class ApiOfflineError extends Error {
    constructor(message = 'Unable to connect') {
      super(message);
      this.name = 'ApiOfflineError';
      this.status = 503;
    }
  },
  callFederationApi: jest.fn(),
  getBalance: jest.fn()
}));

const api = require('../src/lib/api');
const federationRoutes = require('../src/routes/federation');
const federationActionRoutes = require('../src/routes/federation-actions');

const DEFAULT_SETTINGS = {
  federation_optin: false,
  profile_visible_federated: true,
  appear_in_federated_search: true,
  show_skills_federated: true,
  show_location_federated: false,
  show_reviews_federated: true,
  messaging_enabled_federated: true,
  transactions_enabled_federated: true,
  email_notifications: true,
  service_reach: 'local_only',
  travel_radius_km: 25
};

let settingsByToken;
let setupFailuresByToken;

function settingsFor(token) {
  return {
    ...DEFAULT_SETTINGS,
    ...(settingsByToken.get(token) || {})
  };
}

function checked(html, id) {
  return new RegExp(`id="${id}"[^>]* checked`).test(html);
}

function createApp() {
  const app = express();
  const views = path.join(__dirname, '..', 'src', 'views');
  const govuk = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');

  nunjucks.configure([views, govuk], {
    autoescape: true,
    express: app,
    watch: false
  });
  app.set('view engine', 'njk');
  app.set('views', views);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: 'federation-onboarding-test-secret',
    resave: false,
    saveUninitialized: false,
    name: 'federation-onboarding-test.sid'
  }));

  app.use('/:tenantSlug/accessible/federation', (req, res, next) => {
    const tenantSlug = req.params.tenantSlug;
    const tenantId = tenantSlug === 'beta' ? 3 : 2;
    const prefix = `/${tenantSlug}/accessible`;

    req.signedCookies = { token: `token:${tenantSlug}` };
    req.accessibleRouting = {
      mode: 'shared',
      tenantSlug,
      tenant: { id: tenantId, slug: tenantSlug, name: `${tenantSlug} community` },
      prefix
    };
    res.locals.urlFor = (value) => {
      const target = String(value || '/');
      return target.startsWith(prefix) ? target : `${prefix}${target.startsWith('/') ? target : `/${target}`}`;
    };
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: `${tenantSlug} community`,
      isAuthenticated: true,
      csrfToken: 'test-csrf-token',
      alphaNavItems: [],
      feedbackUrl: `${prefix}/feedback`,
      currentPath: `${prefix}/federation/onboarding`,
      alphaLocaleOptions: [],
      alphaLanguageQueryParams: [],
      htmlLang: 'en',
      htmlDirection: 'ltr',
      t: createTranslator('en'),
      tc: createChoiceTranslator('en')
    });
    next();
  }, federationRoutes, federationActionRoutes);

  return app;
}

beforeEach(() => {
  settingsByToken = new Map();
  setupFailuresByToken = new Map();
  api.callFederationApi.mockReset();
  api.callFederationApi.mockImplementation(async (token, method, apiPath) => {
    if (method === 'GET' && apiPath === '/settings') {
      return { data: { settings: settingsFor(token) } };
    }
    if (method === 'GET' && apiPath === '/partners') {
      return { data: [] };
    }
    if (method === 'GET' && apiPath === '/status') {
      const settings = settingsFor(token);
      return {
        data: {
          tenant_federation_enabled: true,
          federation_optin: settings.federation_optin,
          partnerships_count: 0,
          messages_count: 0,
          transactions_count: 0
        }
      };
    }
    if (method === 'GET' && apiPath === '/activity') {
      return { data: [] };
    }
    if (method === 'POST' && apiPath === '/setup') {
      const failures = setupFailuresByToken.get(token) || 0;
      if (failures > 0) {
        setupFailuresByToken.set(token, failures - 1);
        throw new Error('setup unavailable');
      }
      return { data: { success: true } };
    }
    throw new Error(`Unexpected federation API call: ${token} ${method} ${apiPath}`);
  });
});

describe('federation onboarding session parity', () => {
  it('persists non-default choices through back navigation and a confirm-only submit', async () => {
    const app = createApp();
    const agent = request.agent(app);

    const privacyPage = await agent.get('/acme/accessible/federation/onboarding?step=privacy');
    expect(privacyPage.status).toBe(200);
    expect(privacyPage.text).toContain('action="/acme/accessible/federation/onboarding"');
    expect(privacyPage.text).toContain('href="/acme/accessible/federation/onboarding?step=welcome"');

    const privacyPost = await agent
      .post('/acme/accessible/federation/onboarding')
      .type('form')
      .send({
        step: 'privacy',
        appear_in_federated_search: 'on',
        show_location_federated: 'on'
      });
    expect(privacyPost.status).toBe(302);
    expect(privacyPost.headers.location).toBe('/acme/accessible/federation/onboarding?step=communication');

    const backToPrivacy = await agent.get('/acme/accessible/federation/onboarding?step=privacy');
    expect(checked(backToPrivacy.text, 'profile_visible_federated')).toBe(false);
    expect(checked(backToPrivacy.text, 'appear_in_federated_search')).toBe(true);
    expect(checked(backToPrivacy.text, 'show_skills_federated')).toBe(false);
    expect(checked(backToPrivacy.text, 'show_location_federated')).toBe(true);
    expect(checked(backToPrivacy.text, 'show_reviews_federated')).toBe(false);

    const communicationPost = await agent
      .post('/acme/accessible/federation/onboarding')
      .type('form')
      .send({
        step: 'communication',
        transactions_enabled_federated: 'on',
        service_reach: 'travel_ok',
        travel_radius_km: '77'
      });
    expect(communicationPost.headers.location).toBe('/acme/accessible/federation/onboarding?step=confirm');

    const confirmPage = await agent.get('/acme/accessible/federation/onboarding?step=confirm');
    expect(confirmPage.status).toBe(200);
    expect(confirmPage.text).toContain('Happy to travel up to 77 km');
    expect(confirmPage.text).toContain('href="/acme/accessible/federation/onboarding?step=communication"');

    api.callFederationApi.mockClear();
    const confirmPost = await agent
      .post('/acme/accessible/federation/onboarding')
      .type('form')
      .send({ step: 'confirm' });

    expect(confirmPost.status).toBe(302);
    expect(confirmPost.headers.location).toBe('/acme/accessible/federation?status=opted-in');
    expect(api.callFederationApi).toHaveBeenCalledWith('token:acme', 'POST', '/setup', {
      federation_optin: true,
      profile_visible_federated: false,
      appear_in_federated_search: true,
      show_skills_federated: false,
      show_location_federated: true,
      show_reviews_federated: false,
      messaging_enabled_federated: false,
      transactions_enabled_federated: true,
      email_notifications: false,
      service_reach: 'travel_ok',
      travel_radius_km: 77
    });

    const freshPrivacyPage = await agent.get('/acme/accessible/federation/onboarding?step=privacy');
    expect(checked(freshPrivacyPage.text, 'profile_visible_federated')).toBe(true);
    expect(checked(freshPrivacyPage.text, 'show_location_federated')).toBe(false);
  });

  it('retains the tenant bag after a failed setup and reuses it on retry', async () => {
    const app = createApp();
    const agent = request.agent(app);
    setupFailuresByToken.set('token:acme', 1);

    await agent.get('/acme/accessible/federation/onboarding?step=privacy');
    await agent
      .post('/acme/accessible/federation/onboarding')
      .type('form')
      .send({ step: 'privacy', show_location_federated: 'on' });
    await agent
      .post('/acme/accessible/federation/onboarding')
      .type('form')
      .send({ step: 'communication', service_reach: 'remote_ok', travel_radius_km: '40' });

    const failed = await agent
      .post('/acme/accessible/federation/onboarding')
      .type('form')
      .send({ step: 'confirm' });
    expect(failed.headers.location).toBe('/acme/accessible/federation/onboarding?step=confirm&status=optin-failed');

    const retained = await agent.get('/acme/accessible/federation/onboarding?step=confirm&status=optin-failed');
    expect(retained.status).toBe(200);
    expect(retained.text).toContain('We could not enable federation. Please try again.');
    expect(retained.text).toContain('Remote is fine');

    api.callFederationApi.mockClear();
    const retried = await agent
      .post('/acme/accessible/federation/onboarding')
      .type('form')
      .send({ step: 'confirm' });
    expect(retried.headers.location).toBe('/acme/accessible/federation?status=opted-in');
    expect(api.callFederationApi).toHaveBeenCalledWith('token:acme', 'POST', '/setup', expect.objectContaining({
      show_location_federated: true,
      service_reach: 'remote_ok',
      travel_radius_km: 40
    }));
  });

  it('keeps choices isolated between tenants in one browser session', async () => {
    const app = createApp();
    const agent = request.agent(app);

    await agent.get('/acme/accessible/federation/onboarding?step=privacy');
    await agent
      .post('/acme/accessible/federation/onboarding')
      .type('form')
      .send({ step: 'privacy', show_location_federated: 'on' });

    const betaPage = await agent.get('/beta/accessible/federation/onboarding?step=privacy');
    expect(checked(betaPage.text, 'profile_visible_federated')).toBe(true);
    expect(checked(betaPage.text, 'show_location_federated')).toBe(false);

    const acmePage = await agent.get('/acme/accessible/federation/onboarding?step=privacy');
    expect(checked(acmePage.text, 'profile_visible_federated')).toBe(false);
    expect(checked(acmePage.text, 'show_location_federated')).toBe(true);
  });

  it('clamps unknown steps to welcome and never finalises them', async () => {
    const app = createApp();
    const agent = request.agent(app);

    const getResponse = await agent.get('/acme/accessible/federation/onboarding?step=unexpected');
    expect(getResponse.status).toBe(200);
    expect(getResponse.text).toContain('Connect beyond your community');

    api.callFederationApi.mockClear();
    const postResponse = await agent
      .post('/acme/accessible/federation/onboarding')
      .type('form')
      .send({ step: 'unexpected' });
    expect(postResponse.headers.location).toBe('/acme/accessible/federation/onboarding?step=privacy');
    expect(api.callFederationApi).not.toHaveBeenCalled();
  });

  it('redirects already opted-in members to the tenant-mounted hub', async () => {
    settingsByToken.set('token:acme', { federation_optin: true });
    const response = await request(createApp())
      .get('/acme/accessible/federation/onboarding?step=privacy');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/acme/accessible/federation');
  });

  it('links opted-out members to the Laravel onboarding CTA', async () => {
    const response = await request(createApp()).get('/acme/accessible/federation');

    expect(response.status).toBe(200);
    expect(response.text).toContain('href="/acme/accessible/federation/onboarding"');
    expect(response.text).toContain('Opt in to federation');
    expect(response.text).not.toContain('href="/acme/accessible/federation/opt-in">Turn on federation');
  });
});
