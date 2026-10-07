// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Joining a full shift's waitlist from the opportunity page (gap B4, 7 Oct 2026).
 * The page showed a "full" tag and nothing else, while the waitlist page told
 * volunteers they could join one.
 *
 * Pinned here (the page itself is covered in shared-accessible-shell.test.js):
 * - the action posts to the shift's waitlist and comes back with a confirmation;
 * - "already waiting", "a place has come free / it has started", a plain failure and a
 *   safeguarding refusal each come back with their own message, not a generic one;
 * - each waitlist entry links to its opportunity, where a freed place is claimed.
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
    constructor(message, status, data) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  return {
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    callVolunteeringApi: jest.fn(),
    getVolunteeringCategories: jest.fn(),
    searchUsers: jest.fn(),
    getProfile: jest.fn(),
    invalidateUserCache: jest.fn()
  };
});

const api = require('../src/lib/api');
const volunteeringActionRoutes = require('../src/routes/volunteering-actions');

const PREFIX = '/acme/accessible';
const MOUNT = `${PREFIX}/volunteering`;
const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');

function createApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('formatEventDate', (value) => String(value || ''));
  env.addFilter('date', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));

  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'waitlist-join-test-secret', resave: false, saveUninitialized: false }));

  app.use(MOUNT, (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
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
      currentPath: MOUNT,
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
  }, volunteeringActionRoutes);

  return app;
}

function join() {
  return request(createApp()).post(`${MOUNT}/opportunities/131/shifts/73/waitlist`).type('form').send({});
}

function refuse(code, status = 422) {
  api.callVolunteeringApi.mockRejectedValueOnce(new api.ApiError('refused', status, { errors: [{ code }] }));
}

beforeEach(() => {
  api.callVolunteeringApi.mockReset();
  api.callVolunteeringApi.mockResolvedValue({ data: { id: 5, position: 1 } });
});

describe('joining a full shift\'s waitlist', () => {
  it('posts to the shift\'s waitlist and comes back with a confirmation', async () => {
    const res = await join();

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${MOUNT}/opportunities/131?status=waitlist-joined`);
    expect(api.callVolunteeringApi.mock.calls[0].slice(0, 3)).toEqual(['test-token', 'POST', '/shifts/73/waitlist']);
  });

  it.each([
    ['ALREADY_EXISTS', 409, 'waitlist-already'],
    ['VALIDATION_ERROR', 422, 'waitlist-not-available'],
    ['FORBIDDEN', 403, 'waitlist-join-failed'],
    ['SAFEGUARDING_CONTACT_RESTRICTED', 403, 'shift-safeguarding-restricted'],
    ['SAFEGUARDING_POLICY_UNAVAILABLE', 503, 'shift-safeguarding-unavailable']
  ])('answers %s with its own message', async (code, status, expected) => {
    refuse(code, status);

    const res = await join();
    expect(res.headers.location).toBe(`${MOUNT}/opportunities/131?status=${expected}`);
  });
});

describe('the waitlist page', () => {
  it('links each entry to its opportunity', async () => {
    api.callVolunteeringApi.mockResolvedValueOnce({
      data: [
        { id: 9, position: 0, status: 'notified', shift: { id: 73, start_time: '2099-03-29 14:00:00' }, opportunity: { id: 131, title: 'Food bank sorting' }, organization: { name: 'Food Share' } }
      ]
    });

    const res = await request(createApp()).get(`${MOUNT}/waitlist`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(`href="${MOUNT}/opportunities/131"`);
    expect(res.text).toContain(t('govuk_alpha_volunteering.shift_waitlist.view_opportunity'));
  });
});
