// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Clear an RSVP back to "no answer" (React EventDetailPage clicks the current
 * answer again, which calls DELETE /v2/events/{id}/rsvp). Deep audit B, item E1.
 */
const express = require('express');
const session = require('express-session');
const request = require('supertest');
const nunjucks = require('nunjucks');
const path = require('node:path');
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
  return new Proxy({
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    getEvent: jest.fn(),
    getEvents: jest.fn(),
    getEventPermissions: jest.fn(),
    getEventRsvps: jest.fn(),
    getEventCategories: jest.fn(),
    getProfile: jest.fn(),
    callEventApi: jest.fn(),
    callEventBroadcastApi: jest.fn(),
    removeEventRsvp: jest.fn(),
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] })),
  });
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() }),
}));

const api = require('../src/lib/api');
const eventsRoutes = require('../src/routes/events');

const t = createTranslator('en');

function mount() {
  const app = express();
  const environment = nunjucks.configure(
    [path.join(__dirname, '..', 'src', 'views'),
      path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true, express: app }
  );
  require('../src/lib/template-filters').registerTemplateFilters(environment);
  environment.addFilter('nl2br', (value) => value);
  app.set('view engine', 'njk');
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'events-rsvp-clear-test-secret-at-least-32-chars', resave: false, saveUninitialized: false }));
  app.use('/', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.csrfToken = () => 'csrf';
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'test', prefix: '/test/accessible', tenant: { id: 2, slug: 'test' } };
    res.locals.urlFor = (v) => String(v || '/');
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: 'Test',
      isAuthenticated: true,
      csrfToken: 'csrf',
      t,
      tc: createChoiceTranslator('en'),
      htmlLang: 'en',
      htmlDirection: 'ltr',
      formatLocaleDate: () => '20 September 2026',
    });
    next();
  }, eventsRoutes);
  return app;
}

const app = mount();

const SUMMER_EVENT = { data: { id: 501, title: 'Repair cafe', timezone: 'Europe/Dublin', start_time: '2027-07-01T18:00:00+00:00', end_time: '2027-07-01T21:00:00+00:00', user_id: 900014 } };

function routeApi(handlers) {
  api.callEventApi.mockImplementation(async (token, method, apiPath, data) => {
    for (const [pattern, handler] of handlers) {
      if (pattern.test(`${method} ${apiPath}`)) return handler(data);
    }
    return { data: {} };
  });
}


function eventWith(engagementState, registrationState = 'none') {
  return { data: { ...SUMMER_EVENT.data, relationship: {
    engagement: { state: engagementState, can_change: true },
    registration: { state: registrationState, can_register: true, can_withdraw: registrationState === 'confirmed' }
  } } };
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: 77 } });
  api.getEventRsvps.mockResolvedValue({ data: [] });
  api.getEventPermissions.mockResolvedValue({ data: {} });
});

describe('clear my RSVP', () => {
  it('offers to clear an "interested" answer', async () => {
    routeApi([[/^GET \/501$/, () => eventWith('interested')]]);
    api.getEvent.mockResolvedValue(eventWith('interested'));
    const res = await request(app).get('/501');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_events.rsvp.clear_button'));
    expect(res.text).toMatch(/name="status" value="clear"/);
  });

  it('does not offer it when there is no answer to clear', async () => {
    routeApi([[/^GET \/501$/, () => eventWith('none')]]);
    api.getEvent.mockResolvedValue(eventWith('none'));
    const res = await request(app).get('/501');
    expect(res.text).not.toContain(t('govuk_alpha_events.rsvp.clear_button'));
  });

  it('does not offer it on a confirmed place, which has its own withdraw step', async () => {
    routeApi([[/^GET \/501$/, () => eventWith('none', 'confirmed')]]);
    api.getEvent.mockResolvedValue(eventWith('none', 'confirmed'));
    const res = await request(app).get('/501');
    expect(res.text).not.toContain(t('govuk_alpha_events.rsvp.clear_button'));
  });

  it('clears through DELETE /v2/events/{id}/rsvp', async () => {
    api.removeEventRsvp.mockResolvedValue({ data: { status: null } });
    const res = await request(app).post('/501/rsvp').type('form').send({ status: 'clear' });
    expect(api.removeEventRsvp).toHaveBeenCalledWith('token:test', '501');
    expect(api.callEventApi).not.toHaveBeenCalledWith('token:test', 'POST', expect.stringContaining('/registration/'), expect.anything(), expect.anything());
    expect(res.headers.location).toBe('/events/501?status=rsvp-cleared');
  });

  it('confirms the cleared answer', async () => {
    routeApi([[/^GET \/501$/, () => eventWith('none')]]);
    api.getEvent.mockResolvedValue(eventWith('none'));
    const res = await request(app).get('/501?status=rsvp-cleared');
    expect(res.text).toContain(t('govuk_alpha_events.rsvp.cleared'));
  });

  it('shows the API reason when the clear is refused', async () => {
    api.removeEventRsvp.mockRejectedValue(new api.ApiError('refused', 422, { errors: [{ code: 'EVENT_STARTED', message: 'This event has already started.' }] }));
    const res = await request(app).post('/501/rsvp').type('form').send({ status: 'clear' });
    expect(res.headers.location).toBe('/events/501?status=rsvp-failed');
  });
});
