// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The people who run an organisation, and the volunteers on its opportunities
 * (8 Oct 2026).
 *
 * An organiser could apply to volunteer for his own organisation's opportunity, and
 * nobody could then decide the application, because the decision screens refuse
 * "your own" items. The API now refuses that application for whoever runs the
 * organisation (they may still log hours and claim expenses with it — someone else
 * decides those), and organisations can take an approved volunteer off an
 * opportunity (POST /v2/volunteering/applications/{id}/remove).
 *
 * Pinned here (the opportunity page's own normalisation is pinned in
 * shared-accessible-shell.test.js):
 * - the opportunity page shows a "you run this organisation" note, not the Apply form;
 * - a refused application or expense claim shows the API's own reason;
 * - an approved application can be removed, through a confirmation page that names
 *   the volunteer and the opportunity, and a failure shows the API's reason.
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

const t = createTranslator('en');
const RO = 'govuk_alpha_volunteering.runs_organisation.';
const OM = 'govuk_alpha_volunteering.org_manage.';
// Nunjucks autoescape turns apostrophes into &#39;.
const html = (text) => String(text).replace(/'/g, '&#39;');

function setLocals(res) {
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
    formatLocaleDate: () => '8 October 2026',
  });
}

function mount() {
  const app = express();
  const environment = nunjucks.configure(
    [path.join(__dirname, '..', 'src', 'views'),
      path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true, express: app }
  );
  require('../src/lib/template-filters').registerTemplateFilters(environment);
  environment.addFilter('nl2br', (value) => value);
  environment.addFilter('formatEventDate', (value) => String(value || ''));
  environment.addFilter('date', (value) => String(value || ''));
  app.set('view engine', 'njk');
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'volunteering-runs-organisation-test-secret-32', resave: false, saveUninitialized: false }));

  // The opportunity page lives in server.js; render its template with an opportunity
  // shaped the way server.js normalises it.
  app.get('/__opportunity', (req, res) => {
    setLocals(res);
    res.render('volunteer-opportunity', {
      title: 'Food bank',
      opportunity: JSON.parse(String(req.query.opportunity)),
      opportunityId: '131',
      authRequired: false,
      status: null,
      csrfToken: 'csrf',
    });
  });

  app.use('/', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.csrfToken = () => 'csrf';
    req.flash = () => [];
    setLocals(res);
    next();
  }, volunteeringRoutes);
  return app;
}

const app = mount();

const forbidden = (message, field = 'organization_id') => new api.ApiError('forbidden', 403, {
  errors: [{ code: 'FORBIDDEN', message, field }],
});

/** Answer each API path from a table; anything unlisted resolves to an empty list. */
function routeApi(table) {
  api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => {
    const key = `${method} ${apiPath}`;
    const hit = Object.keys(table).find((pattern) => key === pattern || key.startsWith(pattern));
    if (!hit) return { data: [] };
    const answer = table[hit];
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? answer() : answer;
  });
}

beforeEach(() => {
  api.callVolunteeringApi.mockReset();
  api.getProfile.mockResolvedValue({ data: { id: 900015 } });
});

describe('the opportunity page, for whoever runs the organisation', () => {
  const page = (opportunity) => request(app).get('/__opportunity').query({
    opportunity: JSON.stringify({ title: 'Food bank sorting', shifts: [], organisationId: 114, ...opportunity }),
  });

  it('explains why there is no Apply form and links to the applications', async () => {
    const res = await page({ runsOrganisation: true, canManage: true });

    expect(res.status).toBe(200);
    expect(res.text).toContain('data-testid="opportunity-runs-organisation"');
    expect(res.text).toContain(t(`${RO}note`));
    expect(res.text).toContain(`href="/volunteering/organisations/114/manage">${t(`${RO}manage_link`)}</a>`);
    expect(res.text).not.toContain('action="/volunteering/opportunities/131/apply"');
  });

  it('still shows an earlier application rather than the note', async () => {
    const res = await page({ runsOrganisation: true, hasApplied: true });

    expect(res.text).toContain(html(t('govuk_alpha.volunteering.already_applied')));
    expect(res.text).not.toContain('data-testid="opportunity-runs-organisation"');
  });

  it('still offers everyone else the Apply form', async () => {
    const res = await page({ runsOrganisation: false });

    expect(res.text).toContain('action="/volunteering/opportunities/131/apply"');
    expect(res.text).not.toContain('data-testid="opportunity-runs-organisation"');
  });
});

describe('refusals say why, in the API\'s own words', () => {
  it('a refused application goes back with the API message stashed for the page', async () => {
    const message = "You run this organisation, so you can't apply to volunteer for its opportunities.";
    routeApi({
      'POST /opportunities/131/apply': new api.ApiError('refused', 422, { errors: [{ code: 'VALIDATION_ERROR', message }] }),
    });
    const agent = request.agent(app);

    const res = await agent.post('/opportunities/131/apply').type('form').send({ message: 'Hello' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/volunteering/opportunities/131?status=apply-refused');
  });

  it('an application refused for another reason keeps the generic failure', async () => {
    routeApi({ 'POST /opportunities/131/apply': new api.ApiError('boom', 500, {}) });

    const res = await request(app).post('/opportunities/131/apply').type('form').send({});

    expect(res.headers.location).toBe('/volunteering/opportunities/131?status=apply-failed');
  });

  it('a refused expense claim shows the API message in the error summary', async () => {
    const message = 'You need an approved volunteering relationship with this organisation';
    routeApi({ 'POST /expenses': forbidden(message) });
    const agent = request.agent(app);

    const res = await agent.post('/expenses').type('form').send({
      organization_id: '108', amount: '12.50', description: 'Bus fare', expense_type: 'travel',
    });
    expect(res.headers.location).toBe('/volunteering/expenses?status=expense-forbidden');

    const page = await agent.get('/expenses?status=expense-forbidden');
    expect(page.status).toBe(200);
    expect(page.text).toContain('govuk-error-summary');
    expect(page.text).toContain(html(message));
  });
});

describe('an organisation removes an approved volunteer', () => {
  const approved = {
    id: 77,
    status: 'approved',
    user: { id: 501, name: 'Ada Lovelace' },
    opportunity: { id: 131, title: 'Food bank sorting' },
  };

  it('offers Remove on approved applications only', async () => {
    routeApi({
      'GET /organisations/42/applications': {
        data: [approved, { ...approved, id: 78, status: 'declined', user: { id: 502, name: 'Bob' } }],
      },
    });

    const page = await request(app).get('/organisations/42/manage?app_status=all');

    expect(page.status).toBe(200);
    expect(page.text).toContain('href="/volunteering/organisations/42/applications/77/remove"');
    expect(page.text).not.toContain('/applications/78/remove');
  });

  it('asks first, naming the volunteer and the opportunity', async () => {
    routeApi({ 'GET /organisations/42/applications': { data: [approved] } });

    const page = await request(app).get('/organisations/42/applications/77/remove');

    expect(page.status).toBe(200);
    expect(api.callVolunteeringApi).toHaveBeenCalledWith(
      'token:test', 'GET', '/organisations/42/applications?status=approved&per_page=1&cursor=78'
    );
    expect(page.text).toContain(html(t(`${OM}remove_title`, { name: 'Ada Lovelace', opportunity: 'Food bank sorting' })));
    expect(page.text).toContain(html(t(`${OM}remove_body`)));
    expect(page.text).toContain('action="/volunteering/organisations/42/applications/77/remove"');
    expect(page.text).toContain('name="_csrf" value="csrf"');
    expect(api.callVolunteeringApi.mock.calls.filter(([, method]) => method !== 'GET')).toHaveLength(0);
  });

  it('says "not found" for an application that is not an approved one of this organisation', async () => {
    routeApi({ 'GET /organisations/42/applications': { data: [{ ...approved, id: 70 }] } });

    const page = await request(app).get('/organisations/42/applications/77/remove');

    expect(page.status).toBe(404);
  });

  it('removes through the API and goes back with a success banner', async () => {
    routeApi({ 'POST /applications/77/remove': { data: { id: 77, removed: true } } });
    const agent = request.agent(app);

    const res = await agent.post('/organisations/42/applications/77/remove').type('form').send({ _csrf: 'csrf' });

    expect(api.callVolunteeringApi).toHaveBeenCalledWith('token:test', 'POST', '/applications/77/remove', {});
    expect(res.headers.location).toBe('/volunteering/organisations/42/manage?status=application-removed&app_status=approved');

    const page = await agent.get('/organisations/42/manage?status=application-removed&app_status=approved');
    expect(page.text).toContain('govuk-notification-banner--success');
    expect(page.text).toContain(t(`${OM}removed`));
  });

  it('shows the API reason when the removal is refused', async () => {
    const message = 'Only an approved volunteer can be removed.';
    routeApi({
      'POST /applications/77/remove': new api.ApiError('bad', 400, { errors: [{ code: 'VALIDATION_ERROR', message }] }),
    });
    const agent = request.agent(app);

    const res = await agent.post('/organisations/42/applications/77/remove').type('form').send({ _csrf: 'csrf' });
    expect(res.headers.location).toBe('/volunteering/organisations/42/manage?status=application-remove-failed&app_status=approved');

    const page = await agent.get('/organisations/42/manage?status=application-remove-failed&app_status=approved');
    expect(page.text).toContain('govuk-error-summary');
    expect(page.text).toContain(message);
  });
});
