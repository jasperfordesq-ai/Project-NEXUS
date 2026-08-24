// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Logging volunteering hours told members to check their input when the real
 * reason was that they were waiting on the organisation.
 *
 * 🔴 Found by WALKING the volunteering journey on 2026-08-24, which needed the
 * fixture seeded first (register an organisation -> an admin activates it -> post
 * an opportunity -> apply). Logging hours requires an APPROVED application, and
 * the API refuses with FORBIDDEN naming the field:
 *
 *   {"code":"FORBIDDEN","message":"You need an approved application before using
 *    this opportunity","field":"opportunity_id"}
 *   {"code":"FORBIDDEN","message":"You need an approved volunteering relationship
 *    with this organisation","field":"organization_id"}
 *
 * Both were flattened into "Your hours could not be logged. Check the details and
 * try again." — so a member re-reads a date and an hours figure that are both
 * correct, and can never discover that the organisation has not approved them
 * yet. Verified live before and after: the same submission now answers
 * `hours-needs-approved-application`.
 *
 * The rest of that journey works and is recorded in the changelog: apply once
 * (the form is withdrawn afterwards), the organisation approves, hours are
 * accepted and held as pending, credits land ONLY on approval — measured 28 -> 30
 * for two hours.
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
    callVolunteeringApi: jest.fn(),
    getProfile: jest.fn(),
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] })),
  });
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() }),
}));

const api = require('../src/lib/api');
const volunteeringRoutes = require('../src/routes/volunteering-actions');

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
  app.use(session({ secret: 'volunteering-hours-test-secret-at-least-32', resave: false, saveUninitialized: false }));
  app.use('/', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.csrfToken = () => 'csrf';
    req.flash = () => [];
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'test', prefix: '/test/accessible', tenant: { id: 2, slug: 'test' } };
    res.locals.urlFor = (v) => String(v || '/');
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: 'Test',
      isAuthenticated: true,
      csrfToken: 'csrf',
      t: createTranslator('en'),
      tc: createChoiceTranslator('en'),
      htmlLang: 'en',
      htmlDirection: 'ltr',
      formatLocaleDate: () => '23 August 2026',
    });
    next();
  }, volunteeringRoutes);
  return app;
}

const app = mount();
const t = createTranslator('en');

const submitHours = () => request(app).post('/hours').type('form').send({
  organization_id: '108',
  opportunity_id: '130',
  hours: '2',
  description: 'Weeding at the community garden',
  'date-day': '23',
  'date-month': '8',
  'date-year': '2026',
});

describe('logging hours says WHY it was refused', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getProfile.mockResolvedValue({ data: { id: 900015 } });
  });

  const refuse = (field) => api.callVolunteeringApi.mockRejectedValue(
    new api.ApiError('forbidden', 403, {
      errors: [{ code: 'FORBIDDEN', message: 'You need an approved application before using this opportunity', field }],
    })
  );

  it('names the unapproved APPLICATION rather than blaming the input', async () => {
    refuse('opportunity_id');
    const res = await submitHours();
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('status=hours-needs-approved-application');
    expect(res.headers.location).not.toContain('status=hours-failed');
  });

  it('names the unapproved ORGANISATION relationship', async () => {
    refuse('organization_id');
    const res = await submitHours();
    expect(res.headers.location).toContain('status=hours-needs-approved-organisation');
  });

  it('still falls back to the generic failure for anything else', async () => {
    api.callVolunteeringApi.mockRejectedValue(new api.ApiError('nope', 422, {
      errors: [{ code: 'VALIDATION_ERROR', message: 'bad date', field: 'date' }],
    }));
    const res = await submitHours();
    expect(res.headers.location).toContain('status=hours-failed');
  });

  it('falls back when a FORBIDDEN names no field at all', async () => {
    api.callVolunteeringApi.mockRejectedValue(new api.ApiError('nope', 403, {
      errors: [{ code: 'FORBIDDEN', message: 'no' }],
    }));
    const res = await submitHours();
    expect(res.headers.location).toContain('status=hours-failed');
  });

  it('still reports success when the hours are accepted', async () => {
    api.callVolunteeringApi.mockResolvedValue({ data: { id: 586, status: 'pending' } });
    const res = await submitHours();
    expect(res.headers.location).toContain('status=hours-created');
  });
});

describe('the hours page renders each refusal distinctly', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getProfile.mockResolvedValue({ data: { id: 900015 } });
    api.callVolunteeringApi.mockResolvedValue({ data: [] });
  });

  const cases = [
    ['hours-needs-approved-application', 'govuk_alpha.volunteering.hours_needs_approved_application'],
    ['hours-needs-approved-organisation', 'govuk_alpha.volunteering.hours_needs_approved_organisation'],
    ['hours-failed', 'govuk_alpha.volunteering.hours_failed'],
  ];

  it.each(cases)('%s shows its own wording', async (status, key) => {
    const res = await request(app).get(`/hours?status=${status}`);
    expect(res.status).toBe(200);
    const message = t(key);
    expect(message).toBeTruthy();
    expect(message).not.toContain('govuk_alpha');
    expect(res.text).toContain(message);
  });

  it('the approval messages do not tell the member to check their details', () => {
    for (const [, key] of cases.slice(0, 2)) {
      expect(t(key)).not.toMatch(/check the details|try again/i);
      expect(t(key)).toMatch(/approv/i);
    }
  });

  it('all three messages are different', () => {
    const values = cases.map(([, key]) => t(key));
    expect(new Set(values).size).toBe(values.length);
  });
});
