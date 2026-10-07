// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The expense claim form offers what the API will actually accept.
 *
 * - Organisations: the API lets a volunteer claim from an organisation that
 *   accepted them onto an opportunity, or one they belong to
 *   (VolunteerExpenseService::userCanClaimAgainstOrganization). Being accepted does
 *   not make someone a member, so listing only "my organisations" hid the
 *   organisation most volunteers claim from.
 * - Opportunity: optional, and only one the volunteer was accepted onto at the
 *   chosen organisation. This page works without JavaScript, so it is one list
 *   grouped by organisation and checked again when the form is posted.
 * - Currency: the API always records the community's currency, so the form no
 *   longer offers a box that did nothing.
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

function createApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));
  env.addFilter('string', String);

  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: 'volunteering-expense-form-test-secret',
    resave: false,
    saveUninitialized: false,
    name: 'volunteering-expense-form-test.sid'
  }));

  app.use(MOUNT, (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.accessibleRouting = {
      mode: 'shared',
      tenantSlug: 'acme',
      tenant: { id: 2, slug: 'acme', name: 'Acme Timebank', settings: { default_currency: 'EUR' } },
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
      currentPath: MOUNT,
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
  }, volunteeringActionRoutes);

  return app;
}

const APPROVED_APPLICATIONS = [
  { id: 11, status: 'approved', opportunity: { id: 501, title: 'Garden clean-up' }, organization: { id: 7, name: 'Riverside Garden' } },
  { id: 12, status: 'approved', opportunity: { id: 502, title: 'Seed swap stall' }, organization: { id: 7, name: 'Riverside Garden' } },
  { id: 13, status: 'approved', opportunity: { id: 601, title: 'Food bank shift' }, organization: { id: 8, name: 'Food Bank' } }
];

beforeEach(() => {
  api.callVolunteeringApi.mockReset();
  api.getProfile.mockReset();
  api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Volunteer' } });
  api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => {
    if (method === 'GET' && String(apiPath).startsWith('/applications')) {
      return { data: { items: APPROVED_APPLICATIONS } };
    }
    if (method === 'GET' && String(apiPath).startsWith('/my-organisations')) {
      return { data: { items: [{ id: 3, name: 'My Own Club' }] } };
    }
    if (method === 'GET') {
      return { data: { items: [] } };
    }
    return { data: { id: 99 } };
  });
});

function postCalls() {
  return api.callVolunteeringApi.mock.calls.filter(([, method]) => method === 'POST');
}

describe('expense claim form', () => {
  it('lists organisations the volunteer was accepted by, not only ones they belong to', async () => {
    const page = await request(createApp()).get(`${MOUNT}/expenses`);

    expect(page.status).toBe(200);
    expect(page.text).toContain('<option value="7"');
    expect(page.text).toContain('Riverside Garden');
    expect(page.text).toContain('<option value="8"');
    expect(page.text).toContain('<option value="3"');
  });

  it('offers an optional opportunity, grouped by organisation, and no currency box', async () => {
    const page = await request(createApp()).get(`${MOUNT}/expenses`);

    expect(page.text).toContain('id="opportunity_id" name="opportunity_id"');
    expect(page.text).toContain('<optgroup label="Riverside Garden">');
    expect(page.text).toContain('<option value="501"');
    expect(page.text).toContain('Garden clean-up');
    expect(page.text).toContain('<optgroup label="Food Bank">');
    expect(page.text).not.toContain('id="currency"');
  });

  it('sends the chosen opportunity with the claim', async () => {
    const res = await request(createApp())
      .post(`${MOUNT}/expenses`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', organization_id: '7', opportunity_id: '502', expense_type: 'travel', amount: '8.50', description: 'Bus fare' });

    expect(res.headers.location).toContain('status=expense-submitted');
    const [[, , apiPath, body]] = postCalls();
    expect(apiPath).toBe('/expenses');
    expect(body).toEqual({ organization_id: 7, opportunity_id: 502, expense_type: 'travel', amount: 8.5, description: 'Bus fare' });
  });

  it('sends no opportunity and no currency when none is chosen', async () => {
    await request(createApp())
      .post(`${MOUNT}/expenses`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', organization_id: '8', opportunity_id: '', expense_type: 'meals', amount: '4', description: 'Lunch', currency: 'GBP' });

    const [[, , , body]] = postCalls();
    expect(body).toEqual({ organization_id: 8, expense_type: 'meals', amount: 4, description: 'Lunch' });
  });

  it('refuses an opportunity from a different organisation before calling the API, and keeps what was typed', async () => {
    const agent = request.agent(createApp());
    const res = await agent
      .post(`${MOUNT}/expenses`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', organization_id: '8', opportunity_id: '501', expense_type: 'travel', amount: '6', description: 'Train' });

    expect(res.headers.location).toContain('status=expense-opportunity-mismatch');
    expect(postCalls()).toHaveLength(0);

    const page = await agent.get(`${MOUNT}/expenses?status=expense-opportunity-mismatch`);
    expect(page.text).toContain('id="opportunity_id-error"');
    expect(page.text).toContain('<option value="501" selected');
    expect(page.text).toContain('<option value="8" selected');
  });
});
