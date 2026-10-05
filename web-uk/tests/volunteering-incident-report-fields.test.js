// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The volunteering "Report a safeguarding incident" form says WHAT kind of report it is,
 * WHEN it happened, and WHICH organisation and opportunity it is about.
 *
 * 🔴 Before this, the form sent only title, description, severity and category, and
 * hardcoded `incident_type: 'other'` — so every report from the accessible frontend
 * reached staff unclassified, undated and not tied to any organisation.
 *
 * Pinned here:
 * - the new fields are posted, and only when they have a value;
 * - the type defaults to `concern`, never the old hardcoded `other`;
 * - a half-typed, unreal or future date is refused locally, with what was typed kept;
 * - an opportunity that does not belong to the chosen organisation is refused locally
 *   (without JavaScript the opportunity list cannot be narrowed), and the API's own 422
 *   for the same mistake maps to the same message;
 * - if the organisation/opportunity list cannot be loaded, the form still renders.
 *
 * Every POST uses the field NAMES THE TEMPLATE EMITS.
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
    downloadVolunteerCredential: jest.fn(),
    getVolunteeringCategories: jest.fn(),
    uploadVolunteerCredential: jest.fn(),
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

const REPORT = 'A volunteer seemed frightened of another adult at the sorting shift and left early.';
const REPORT_OPTIONS = {
  data: {
    organisations: [
      { id: 3, name: 'Food Bank' },
      { id: 4, name: 'Bantry Community Trust' }
    ],
    opportunities: [
      { id: 9, title: 'Sorting donations', organization_id: 3, organization_name: 'Food Bank' },
      { id: 12, title: 'Garden tidy-up', organization_id: 4, organization_name: 'Bantry Community Trust' }
    ]
  }
};

function createApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));

  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: 'incident-report-fields-test-secret',
    resave: false,
    saveUninitialized: false,
    name: 'incident-report-fields-test.sid'
  }));

  app.use(MOUNT, (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.accessibleRouting = {
      mode: 'shared',
      tenantSlug: 'acme',
      tenant: { id: 2, slug: 'acme', name: 'Acme Timebank', settings: {} },
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

/**
 * Reads succeed (report options included unless `optionsError` is given); the incident
 * POST resolves unless `postError` is given.
 */
function mockApi({ optionsError = null, postError = null, incidents = [] } = {}) {
  api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => {
    if (method === 'GET' && apiPath === '/incidents/report-options') {
      if (optionsError) throw optionsError;
      return REPORT_OPTIONS;
    }
    if (method === 'GET' && apiPath === '/incidents') {
      return { data: { items: incidents } };
    }
    if (method === 'GET') {
      return { data: { items: [] } };
    }
    if (method === 'POST' && apiPath === '/incidents') {
      if (postError) throw postError;
      return { data: { id: 501 } };
    }
    throw new api.ApiError('unexpected call', 500, {});
  });
}

function incidentPosts() {
  return api.callVolunteeringApi.mock.calls.filter(([, method, apiPath]) => method === 'POST' && apiPath === '/incidents');
}

function valueOf(html, id) {
  const match = new RegExp(`id="${id}"(?![-\\w])[^>]*\\svalue="([^"]*)"`).exec(html);
  return match ? match[1] : null;
}

function isChecked(html, id) {
  return new RegExp(`id="${id}"(?![-\\w])[^>]*\\schecked`).test(html);
}

function selectBlock(html, id) {
  const start = html.indexOf(`id="${id}" name="${id}"`);
  if (start === -1) return null;
  return html.slice(start, html.indexOf('</select>', start));
}

function errorSummary(html) {
  const start = html.indexOf('<ul class="govuk-list govuk-error-summary__list">');
  return start === -1 ? '' : html.slice(start, html.indexOf('</ul>', start));
}

const BASE = { _csrf: 'test-csrf-token', title: 'Frightened volunteer', description: REPORT, severity: 'high' };
const today = new Date();

beforeEach(() => {
  api.callVolunteeringApi.mockReset();
  mockApi();
});

describe('the incident form offers type, date, organisation and opportunity', () => {
  it('renders every choice, with the opportunity named alongside its organisation', async () => {
    const page = await request(createApp()).get(`${MOUNT}/incidents`);

    expect(page.status).toBe(200);
    expect(api.callVolunteeringApi).toHaveBeenCalledWith('test-token', 'GET', '/incidents/report-options');

    expect(page.text).toContain('What kind of report is this?');
    for (const [value, label] of [
      ['concern', 'A concern about someone’s welfare'],
      ['allegation', 'An allegation about someone’s behaviour'],
      ['disclosure', 'Someone told me something worrying'],
      ['near_miss', 'A near miss (nobody was harmed)'],
      ['other', 'Something else']
    ]) {
      expect(page.text).toContain(`id="incident_type-${value}" name="incident_type" type="radio" value="${value}"`);
      expect(page.text).toContain(label);
      // GOV.UK: radios are never pre-selected.
      expect(isChecked(page.text, `incident_type-${value}`)).toBe(false);
    }

    expect(page.text).toContain('When did it happen? (optional)');
    expect(page.text).toContain('For example, 27 3 2026. Leave blank if it was today.');
    expect(page.text).toContain('name="incident_date-day"');
    expect(page.text).toContain('name="incident_date-month"');
    expect(page.text).toContain('name="incident_date-year"');

    const organisations = selectBlock(page.text, 'organization_id');
    expect(organisations).not.toBeNull();
    expect(page.text).toContain('Which organisation was this with? (optional)');
    expect(organisations).toContain('<option value="">Not about a particular organisation</option>');
    expect(organisations).toContain('<option value="3">Food Bank</option>');

    const opportunities = selectBlock(page.text, 'opportunity_id');
    expect(opportunities).not.toBeNull();
    expect(page.text).toContain('Which volunteering opportunity? (optional)');
    expect(opportunities).toContain('<option value="">Not about a particular opportunity</option>');
    expect(opportunities).toContain('<option value="9">Sorting donations — Food Bank</option>');
    expect(opportunities).toContain('<option value="12">Garden tidy-up — Bantry Community Trust</option>');
  });

  it('does not ask for the report options on the training tab', async () => {
    await request(createApp()).get(`${MOUNT}/training`);
    expect(api.callVolunteeringApi).not.toHaveBeenCalledWith('test-token', 'GET', '/incidents/report-options');
  });

  it('still renders the whole form when the report options cannot be loaded', async () => {
    mockApi({ optionsError: new api.ApiError('service unavailable', 503, {}) });
    const page = await request(createApp()).get(`${MOUNT}/incidents`);

    expect(page.status).toBe(200);
    expect(page.text).toContain('method="post" action="/acme/accessible/volunteering/incidents"');
    expect(page.text).toContain('id="title" name="title" type="text"');
    expect(page.text).toContain('id="incident_type-concern"');
    expect(page.text).toContain('name="incident_date-day"');
    expect(selectBlock(page.text, 'organization_id')).toBeNull();
    expect(selectBlock(page.text, 'opportunity_id')).toBeNull();
    expect(page.text).toContain('We could not load the list of organisations and opportunities just now.');
  });

  it('shows the organisation on each of the member’s own reports', async () => {
    mockApi({
      incidents: [
        { id: 81, title: 'Wet floor', description: 'A wet floor beside the kitchen door.', severity: 'low', status: 'open', organization_name: 'Food Bank', created_at: '2026-06-20T09:30:00Z' },
        { id: 82, title: 'Unrelated', description: 'Not tied to any organisation at all.', severity: 'low', status: 'open', created_at: '2026-06-21T09:30:00Z' }
      ]
    });
    const page = await request(createApp()).get(`${MOUNT}/incidents`);
    const tableStart = page.text.indexOf('<table class="govuk-table">');
    const table = page.text.slice(tableStart);

    expect(table).toContain('<th class="govuk-table__header" scope="col">Organisation</th>');
    expect(table).toContain('<td class="govuk-table__cell">Food Bank</td>');
    expect(table).toContain('<td class="govuk-table__cell">—</td>');
  });
});

describe('posting the new fields', () => {
  it('sends type, date, organisation and opportunity when they are chosen', async () => {
    const agent = request.agent(createApp());
    const post = await agent.post(`${MOUNT}/incidents`).type('form').send({
      ...BASE,
      incident_type: 'disclosure',
      'incident_date-day': '27',
      'incident_date-month': '3',
      'incident_date-year': '2026',
      organization_id: '3',
      opportunity_id: '9'
    });

    expect(post.headers.location).toBe(`${MOUNT}/incidents?status=incident-reported&tab=incidents`);
    expect(incidentPosts()).toHaveLength(1);
    expect(incidentPosts()[0][3]).toEqual({
      title: 'Frightened volunteer',
      description: REPORT,
      severity: 'high',
      category: 'general',
      incident_type: 'disclosure',
      incident_date: '2026-03-27',
      organization_id: 3,
      opportunity_id: 9
    });

    // A success leaves nothing behind to pre-fill the next, blank form.
    const page = await agent.get(`${MOUNT}/incidents?status=incident-reported&tab=incidents`);
    expect(valueOf(page.text, 'title')).toBe('');
    expect(isChecked(page.text, 'incident_type-disclosure')).toBe(false);
  });

  it('defaults the type to concern — not the old hardcoded other — and omits empty optional fields', async () => {
    await request(createApp()).post(`${MOUNT}/incidents`).type('form').send({
      ...BASE,
      'incident_date-day': '',
      'incident_date-month': '',
      'incident_date-year': '',
      organization_id: '',
      opportunity_id: ''
    });

    const payload = incidentPosts()[0][3];
    expect(payload.incident_type).toBe('concern');
    expect(payload).not.toHaveProperty('incident_date');
    expect(payload).not.toHaveProperty('organization_id');
    expect(payload).not.toHaveProperty('opportunity_id');
  });

  it('treats an unknown type as concern rather than passing it on', async () => {
    await request(createApp()).post(`${MOUNT}/incidents`).type('form')
      .send({ ...BASE, incident_type: 'something-invented' });
    expect(incidentPosts()[0][3].incident_type).toBe('concern');
  });

  it('sends an organisation on its own, without an opportunity', async () => {
    await request(createApp()).post(`${MOUNT}/incidents`).type('form')
      .send({ ...BASE, incident_type: 'allegation', organization_id: '4' });
    const payload = incidentPosts()[0][3];
    expect(payload.organization_id).toBe(4);
    expect(payload).not.toHaveProperty('opportunity_id');
  });
});

describe('the date it happened is checked before anything is sent', () => {
  it.each([
    ['half-typed', { 'incident_date-day': '27', 'incident_date-month': '', 'incident_date-year': '' }, 'incident-date-invalid'],
    ['not a real date', { 'incident_date-day': '31', 'incident_date-month': '2', 'incident_date-year': '2026' }, 'incident-date-invalid'],
    ['a two-digit year', { 'incident_date-day': '3', 'incident_date-month': '4', 'incident_date-year': '26' }, 'incident-date-invalid'],
    ['in the future', {
      'incident_date-day': '1',
      'incident_date-month': '1',
      'incident_date-year': String(today.getUTCFullYear() + 1)
    }, 'incident-date-future']
  ])('refuses a date that is %s', async (label, dateFields, status) => {
    const post = await request(createApp()).post(`${MOUNT}/incidents`).type('form')
      .send({ ...BASE, ...dateFields });
    expect(post.headers.location).toBe(`${MOUNT}/incidents?status=${status}&tab=incidents`);
    expect(incidentPosts()).toHaveLength(0);
  });

  it('accepts today', async () => {
    await request(createApp()).post(`${MOUNT}/incidents`).type('form').send({
      ...BASE,
      'incident_date-day': String(today.getDate()),
      'incident_date-month': String(today.getMonth() + 1),
      'incident_date-year': String(today.getFullYear())
    });
    expect(incidentPosts()).toHaveLength(1);
    expect(incidentPosts()[0][3].incident_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('keeps everything typed and points the error at the day field', async () => {
    const agent = request.agent(createApp());
    await agent.post(`${MOUNT}/incidents`).type('form').send({
      ...BASE,
      incident_type: 'near_miss',
      'incident_date-day': '27',
      'incident_date-month': '',
      'incident_date-year': '2026',
      organization_id: '3',
      opportunity_id: '9'
    });

    const page = await agent.get(`${MOUNT}/incidents?status=incident-date-invalid&tab=incidents`);
    expect(page.status).toBe(200);
    const message = 'Enter the date it happened as a real date, for example 27 3 2026, or leave it blank';
    expect(errorSummary(page.text)).toContain(`<a href="#incident_date-day">${message}</a>`);
    expect(page.text).toContain('id="incident_date-day"');
    expect(valueOf(page.text, 'incident_date-day')).toBe('27');
    expect(valueOf(page.text, 'incident_date-year')).toBe('2026');
    // Only the empty part is marked as the one in error.
    expect(page.text).toMatch(/govuk-input--error[^>]*id="incident_date-month"|id="incident_date-month"[^>]*govuk-input--error/);
    expect(page.text).not.toMatch(/govuk-input--error[^>]*id="incident_date-day"|id="incident_date-day"[^>]*govuk-input--error/);
    expect(isChecked(page.text, 'incident_type-near_miss')).toBe(true);
    expect(selectBlock(page.text, 'organization_id')).toContain('<option value="3" selected>Food Bank</option>');
    expect(selectBlock(page.text, 'opportunity_id')).toContain('<option value="9" selected>Sorting donations — Food Bank</option>');
    expect(page.text).toContain(REPORT);
  });

  it('maps the API refusing a future date to the same message', async () => {
    mockApi({ postError: new api.ApiError('invalid', 422, { errors: [{ code: 'VALIDATION_ERROR', field: 'incident_date' }] }) });
    const post = await request(createApp()).post(`${MOUNT}/incidents`).type('form').send({
      ...BASE,
      'incident_date-day': String(today.getDate()),
      'incident_date-month': String(today.getMonth() + 1),
      'incident_date-year': String(today.getFullYear())
    });
    expect(post.headers.location).toBe(`${MOUNT}/incidents?status=incident-date-future&tab=incidents`);
  });
});

describe('an opportunity from a different organisation', () => {
  it('is refused locally, before anything is sent, and keeps both choices', async () => {
    const agent = request.agent(createApp());
    const post = await agent.post(`${MOUNT}/incidents`).type('form')
      .send({ ...BASE, organization_id: '4', opportunity_id: '9' });

    expect(post.headers.location).toBe(`${MOUNT}/incidents?status=incident-opportunity-mismatch&tab=incidents`);
    expect(incidentPosts()).toHaveLength(0);

    const page = await agent.get(`${MOUNT}/incidents?status=incident-opportunity-mismatch&tab=incidents`);
    const message = 'The opportunity you chose is not run by the organisation you chose. Choose a matching opportunity, or change the organisation';
    expect(errorSummary(page.text)).toContain(`<a href="#opportunity_id">${message}</a>`);
    expect(page.text).toContain('id="opportunity_id-error"');
    expect(page.text).toContain('govuk-select govuk-select--error" id="opportunity_id"');
    expect(selectBlock(page.text, 'organization_id')).toContain('<option value="4" selected>Bantry Community Trust</option>');
    expect(selectBlock(page.text, 'opportunity_id')).toContain('<option value="9" selected>Sorting donations — Food Bank</option>');
  });

  it('is sent as-is when the options cannot be read, and the API refusal maps to the same message', async () => {
    mockApi({
      optionsError: new api.ApiError('service unavailable', 503, {}),
      postError: new api.ApiError('invalid', 422, { errors: [{ code: 'VALIDATION_ERROR', field: 'opportunity_id' }] })
    });
    const post = await request(createApp()).post(`${MOUNT}/incidents`).type('form')
      .send({ ...BASE, organization_id: '4', opportunity_id: '9' });

    expect(incidentPosts()).toHaveLength(1);
    expect(post.headers.location).toBe(`${MOUNT}/incidents?status=incident-opportunity-mismatch&tab=incidents`);
  });

  it('a matching pair is sent', async () => {
    await request(createApp()).post(`${MOUNT}/incidents`).type('form')
      .send({ ...BASE, organization_id: '3', opportunity_id: '9' });
    expect(incidentPosts()).toHaveLength(1);
  });

  it('any other API failure is still the generic one', async () => {
    mockApi({ postError: new api.ApiError('service unavailable', 503, {}) });
    const post = await request(createApp()).post(`${MOUNT}/incidents`).type('form').send(BASE);
    expect(post.headers.location).toBe(`${MOUNT}/incidents?status=incident-failed&tab=incidents`);
  });
});
