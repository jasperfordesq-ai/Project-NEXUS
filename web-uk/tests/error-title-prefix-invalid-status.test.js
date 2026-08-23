// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GDS requires a failed submission to prefix the page title with "Error: " — a screen
 * reader user hears the tab title before anything on the page, so it is often the first
 * thing that tells them the form did not go through.
 *
 * `src/views/layouts/base.njk` derives that prefix from `pageHasErrors` / `hasErrors` /
 * `error` / `errors` / `fieldErrors`. Its own comment records the gap this file pins: a
 * page that signals validation failure with a `status == 'x-invalid'` STRING carries none
 * of those locals, so it rendered an error summary under an unprefixed title.
 *
 * 🔴 The flag has to come from the ROUTE. A child template's top-level
 * `{% set pageHasErrors = true %}` runs after the parent has already emitted `<head>`, so
 * the title is computed before the set ever executes. These tests therefore drive the real
 * route handlers rather than rendering the templates directly — a template-only test would
 * pass against a fix that does not work.
 */

const path = require('path');
const express = require('express');
const nunjucks = require('nunjucks');
const request = require('supertest');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');
const { isValidationFailureStatus } = require('../src/lib/validation-status');

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  },
  ApiOfflineError: class ApiOfflineError extends Error {},
  callIdeationApi: jest.fn(),
  callUserSettingsApi: jest.fn(),
  uploadInsuranceCertificate: jest.fn(),
  getProfile: jest.fn(),
  invalidateUserCache: jest.fn()
}));

const api = require('../src/lib/api');
const ideationRoutes = require('../src/routes/ideation');
const settingsRoutes = require('../src/routes/settings');

const PREFIX = '/acme/accessible';
const ERROR_PREFIX = `${createTranslator('en')('states.error_prefix')} `;

function createApp(mountPath, routers) {
  const app = express();
  const views = path.join(__dirname, '..', 'src', 'views');
  const env = nunjucks.configure(
    [views, path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, express: app, watch: false }
  );
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));
  env.addFilter('string', String);

  app.set('view engine', 'njk');
  app.set('views', views);
  app.use(express.urlencoded({ extended: true }));

  app.use(mountPath, (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.accessibleRouting = {
      mode: 'shared',
      tenantSlug: 'acme',
      tenant: { id: 2, slug: 'acme', name: 'Acme Timebank' },
      prefix: PREFIX
    };
    res.locals.urlFor = (value) => {
      const target = String(value || '/');
      return target.startsWith(PREFIX) ? target : `${PREFIX}${target.startsWith('/') ? target : `/${target}`}`;
    };
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: 'Acme Timebank',
      isAuthenticated: true,
      csrfToken: 'test-csrf-token',
      alphaNavItems: [],
      feedbackUrl: `${PREFIX}/feedback`,
      currentPath: mountPath,
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
  }, ...routers);

  return app;
}

function titleOf(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/.exec(html);
  return match ? match[1].trim() : '';
}

// --------------------------------------------------------------------------------------
// The shared rule
// --------------------------------------------------------------------------------------

describe('isValidationFailureStatus', () => {
  it('recognises a -invalid status, in either shape', () => {
    expect(isValidationFailureStatus('campaign-invalid')).toBe(true);
    expect(isValidationFailureStatus('  draft-invalid  ')).toBe(true);
    expect(isValidationFailureStatus({ status: 'comment-invalid', type: 'error' })).toBe(true);
  });

  it('does not treat a transient failure, a success, or nothing as validation', () => {
    expect(isValidationFailureStatus('campaign-failed')).toBe(false);
    expect(isValidationFailureStatus('campaign-created')).toBe(false);
    expect(isValidationFailureStatus('invalid-code')).toBe(false);
    expect(isValidationFailureStatus('')).toBe(false);
    expect(isValidationFailureStatus(null)).toBe(false);
    expect(isValidationFailureStatus(undefined)).toBe(false);
    expect(isValidationFailureStatus({})).toBe(false);
  });
});

// --------------------------------------------------------------------------------------
// Ideation — six pages that signal validation with a `-invalid` status only
// --------------------------------------------------------------------------------------

describe('ideation pages prefix the title with Error: on a -invalid status', () => {
  const MOUNT = `${PREFIX}/ideation`;

  function ideationApp() {
    return createApp(MOUNT, [ideationRoutes]);
  }

  const CHALLENGE = {
    id: 3,
    title: 'Warm rooms for winter',
    description: 'Ideas welcome',
    status: 'open',
    created_at: '2026-08-01T09:00:00Z'
  };
  const IDEA = {
    id: 4,
    // The handler 404s unless the idea belongs to the challenge in the URL.
    challenge_id: 3,
    title: 'Open the library late',
    description: 'A warm place to sit',
    created_at: '2026-08-02T09:00:00Z'
  };

  beforeEach(() => {
    api.getProfile.mockReset();
    api.callIdeationApi.mockReset();

    api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Member', role: 'admin' } });
    api.callIdeationApi.mockImplementation(async (token, method, apiPath) => {
      if (/^\/campaigns\/\d+/.test(apiPath)) {
        return { data: { id: 2, title: 'Winter campaign', description: 'Ideas', status: 'active' } };
      }
      if (apiPath.startsWith('/campaigns')) return { data: [] };
      if (/^\/ideation-ideas\/\d+\/comments/.test(apiPath)) return { data: [] };
      if (/^\/ideation-ideas\/\d+\/media/.test(apiPath)) return { data: [] };
      if (/^\/ideation-ideas\/\d+/.test(apiPath)) return { data: IDEA };
      if (/^\/challenges\/\d+\/ideas/.test(apiPath)) return { data: [] };
      if (/^\/challenges\/\d+/.test(apiPath)) return { data: CHALLENGE };
      if (apiPath.startsWith('/challenges')) return { data: [] };
      if (apiPath.startsWith('/categories')) return { data: [] };
      if (apiPath.startsWith('/templates')) return { data: [] };
      if (apiPath.startsWith('/comments')) return { data: [] };
      if (apiPath.startsWith('/media')) return { data: [] };
      return { data: [] };
    });
  });

  // [path, the -invalid status that page renders]
  const cases = [
    ['/new', 'challenge-invalid'],
    ['/campaigns', 'campaign-invalid'],
    ['/campaigns/2', 'campaign-invalid'],
    ['/3', 'idea-invalid'],
    ['/3/drafts', 'draft-invalid'],
    ['/3/ideas/4', 'comment-invalid'],
    ['/3/ideas/4', 'media-invalid'],
    ['/3/edit', 'challenge-invalid']
  ];

  it.each(cases)('%s starts its title with the error prefix on ?status=%s', async (route, status) => {
    const page = await request(ideationApp()).get(`${MOUNT}${route}?status=${status}`);
    expect(page.status).toBe(200);
    expect(titleOf(page.text).startsWith(ERROR_PREFIX)).toBe(true);
  });

  it.each(cases)('%s does NOT prefix its title on a clean visit (control for %s)', async (route) => {
    const page = await request(ideationApp()).get(`${MOUNT}${route}`);
    expect(page.status).toBe(200);
    expect(titleOf(page.text).startsWith(ERROR_PREFIX)).toBe(false);
  });

  it('does NOT prefix the title for a transient -failed status', async () => {
    const page = await request(ideationApp()).get(`${MOUNT}/campaigns?status=campaign-failed`);
    expect(page.status).toBe(200);
    expect(titleOf(page.text).startsWith(ERROR_PREFIX)).toBe(false);
  });

  it('does NOT prefix the title for a success status', async () => {
    const page = await request(ideationApp()).get(`${MOUNT}/campaigns?status=campaign-created`);
    expect(page.status).toBe(200);
    expect(titleOf(page.text).startsWith(ERROR_PREFIX)).toBe(false);
  });
});

// --------------------------------------------------------------------------------------
// Linked accounts — the one page whose validation status does not end in `-invalid`
// --------------------------------------------------------------------------------------

describe('linked accounts prefixes the title when the typed email is rejected', () => {
  const MOUNT = `${PREFIX}/settings`;

  function settingsApp() {
    return createApp(MOUNT, [settingsRoutes]);
  }

  beforeEach(() => {
    api.callUserSettingsApi.mockReset();
    api.callUserSettingsApi.mockResolvedValue({ data: { items: [] } });
  });

  it('prefixes the title on link-email-invalid', async () => {
    const page = await request(settingsApp()).get(`${MOUNT}/linked-accounts?status=link-email-invalid`);
    expect(page.status).toBe(200);
    expect(titleOf(page.text).startsWith(ERROR_PREFIX)).toBe(true);
  });

  // 🔴 `link-user-not-found` is real input validation — the member typed an address that
  // belongs to nobody in this community — but it does NOT end in `-invalid`, so the shared
  // suffix rule alone would miss it. The route names it explicitly; this pins that.
  it('prefixes the title on link-user-not-found', async () => {
    const page = await request(settingsApp()).get(`${MOUNT}/linked-accounts?status=link-user-not-found`);
    expect(page.status).toBe(200);
    expect(titleOf(page.text).startsWith(ERROR_PREFIX)).toBe(true);
  });

  it('does NOT prefix the title on a clean visit', async () => {
    const page = await request(settingsApp()).get(`${MOUNT}/linked-accounts`);
    expect(page.status).toBe(200);
    expect(titleOf(page.text).startsWith(ERROR_PREFIX)).toBe(false);
  });

  it('does NOT prefix the title on a success status', async () => {
    const page = await request(settingsApp()).get(`${MOUNT}/linked-accounts?status=link-requested`);
    expect(page.status).toBe(200);
    expect(titleOf(page.text).startsWith(ERROR_PREFIX)).toBe(false);
  });

  it('does NOT prefix the title for a transient link-failed', async () => {
    const page = await request(settingsApp()).get(`${MOUNT}/linked-accounts?status=link-failed`);
    expect(page.status).toBe(200);
    expect(titleOf(page.text).startsWith(ERROR_PREFIX)).toBe(false);
  });
});
