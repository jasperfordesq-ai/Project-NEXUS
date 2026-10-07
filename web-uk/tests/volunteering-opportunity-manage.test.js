// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Organisers change, close, reopen and cancel an opportunity on the accessible site
 * (routes/volunteering-opportunity-manage.js, gap B2, 7 Oct 2026). Before this an
 * opportunity could be posted here and never touched again.
 *
 * Pinned here:
 * - the opportunity page offers its managers Edit, Close/Reopen and Cancel, says when it
 *   is closed or cancelled, and stops volunteers applying to either;
 * - the edit form opens filled in, is checked locally first, keeps what was typed, and
 *   sends exactly the fields it shows (a changed place drops the old map pin);
 * - close, reopen and cancel call the right endpoint with the right body; cancelling
 *   goes through a confirmation page that offers closing instead;
 * - anyone who cannot manage it gets the 403 page and nothing is written;
 * - a cancelled opportunity cannot be edited any more.
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
    getVolunteeringCategories: jest.fn()
  };
});

const api = require('../src/lib/api');
const manageRoutes = require('../src/routes/volunteering-opportunity-manage');

const PREFIX = '/acme/accessible';
const MOUNT = `${PREFIX}/volunteering`;
const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');
const K = 'govuk_alpha_volunteering.opp_manage.';
// Nunjucks autoescape turns apostrophes into &#39;.
const html = (text) => String(text).replace(/'/g, '&#39;');

function locals(res) {
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
}

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
  app.use(session({ secret: 'opportunity-manage-test-secret', resave: false, saveUninitialized: false }));

  // The opportunity page itself lives in server.js; render its template directly with
  // an opportunity shaped the way server.js normalises it.
  app.get(`${MOUNT}/opportunities/:id/__page`, (req, res) => {
    locals(res);
    res.render('volunteer-opportunity', {
      title: 'Food bank',
      opportunity: JSON.parse(String(req.query.opportunity)),
      opportunityId: req.params.id,
      authRequired: false,
      status: null,
      csrfToken: 'test-csrf-token'
    });
  });

  app.use(MOUNT, (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    locals(res);
    next();
  }, manageRoutes);

  return app;
}

const OPPORTUNITY = {
  id: 131,
  title: 'Food bank sorting',
  description: 'Sort donated food into parcels.',
  location: 'Town Hall',
  skills_needed: 'Lifting',
  start_date: '2099-03-01',
  end_date: '2099-06-30 00:00:00',
  is_active: true,
  is_remote: false,
  category: 'Food',
  organization: { id: 114, name: 'Garden Trust' },
  status: 'open',
  federated_visibility: 'listed',
  can_manage: true,
  is_owner: false
};

const CATEGORIES = [{ id: 5, name: 'Environment' }, { id: 7, name: 'Food' }];

function mockApi(overrides = {}) {
  const options = { opportunity: OPPORTUNITY, writeError: null, ...overrides };
  api.getVolunteeringCategories.mockResolvedValue(CATEGORIES);
  api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => {
    if (method === 'GET' && apiPath === '/opportunities/131') return { data: options.opportunity };
    if (options.writeError) throw options.writeError;
    if (method === 'PUT' && apiPath === '/opportunities/131') return { data: { id: 131 } };
    if (method === 'DELETE' && apiPath === '/opportunities/131') return { data: { deleted: true } };
    throw new api.ApiError('unexpected', 500, {});
  });
}

function writes() {
  return api.callVolunteeringApi.mock.calls.filter(([, method]) => method !== 'GET');
}

function inputValue(text, id) {
  const match = text.match(new RegExp(`<input[^>]*id="${id}"[^>]*value="([^"]*)"`));
  return match ? match[1] : null;
}

const VALID = {
  _csrf: 'test-csrf-token',
  title: 'Food bank sorting (Saturdays)',
  description: 'Sort donated food into parcels.',
  location: 'Town Hall',
  original_location: 'Town Hall',
  skills_needed: 'Lifting',
  category_id: '7',
  'start_date-day': '1',
  'start_date-month': '3',
  'start_date-year': '2099',
  'end_date-day': '30',
  'end_date-month': '6',
  'end_date-year': '2099',
  federated_visibility: '1'
};

beforeEach(() => {
  api.callVolunteeringApi.mockReset();
  api.getVolunteeringCategories.mockReset();
  mockApi();
});

describe('the opportunity page', () => {
  function page(opportunity) {
    return request(createApp())
      .get(`${MOUNT}/opportunities/131/__page`)
      .query({ opportunity: JSON.stringify({ title: 'Food bank sorting', shifts: [], ...opportunity }) });
  }

  it('offers an open opportunity\'s managers Edit, Close and Cancel', async () => {
    const res = await page({ canManage: true });

    expect(res.status).toBe(200);
    expect(res.text).toContain('data-testid="opportunity-manage"');
    expect(res.text).toContain(`href="${MOUNT}/opportunities/131/edit"`);
    expect(res.text).toContain(`action="${MOUNT}/opportunities/131/close"`);
    expect(res.text).not.toContain(`action="${MOUNT}/opportunities/131/reopen"`);
    expect(res.text).toContain(`href="${MOUNT}/opportunities/131/cancel"`);
  });

  it('marks a closed opportunity and offers Reopen instead of Close', async () => {
    const res = await page({ canManage: true, isClosed: true });

    expect(res.text).toContain(t(`${K}status_closed`));
    expect(res.text).toContain(html(t(`${K}closed_hint`)));
    expect(res.text).toContain(`action="${MOUNT}/opportunities/131/reopen"`);
    expect(res.text).not.toContain(`action="${MOUNT}/opportunities/131/close"`);
  });

  it('offers nothing to change once an opportunity is cancelled', async () => {
    const res = await page({ canManage: true, isCancelled: true });

    expect(res.text).toContain(t(`${K}status_cancelled`));
    expect(res.text).toContain(t(`${K}cancelled_hint`));
    expect(res.text).not.toContain('/opportunities/131/edit"');
    expect(res.text).not.toContain('/opportunities/131/close"');
    expect(res.text).not.toContain('/opportunities/131/cancel"');
    expect(res.text).not.toContain(`href="${MOUNT}/opportunities/131/shifts"`);
  });

  it('stops volunteers applying to a closed or cancelled opportunity', async () => {
    const closed = await page({ canManage: false, isClosed: true });
    expect(closed.text).toContain(t(`${K}volunteer_closed`));
    expect(closed.text).not.toContain(`action="${MOUNT}/opportunities/131/apply"`);
    expect(closed.text).not.toContain('data-testid="opportunity-manage"');

    const cancelled = await page({ canManage: false, isCancelled: true });
    expect(cancelled.text).toContain(t(`${K}volunteer_cancelled`));
    expect(cancelled.text).not.toContain(`action="${MOUNT}/opportunities/131/apply"`);
  });

  it('still shows volunteers the Apply form on an open opportunity', async () => {
    const res = await page({ canManage: false });

    expect(res.text).toContain(`action="${MOUNT}/opportunities/131/apply"`);
    expect(res.text).not.toContain('data-testid="opportunity-manage"');
  });
});

describe('changing the details', () => {
  it('opens the form filled in, with the organisation shown but not asked', async () => {
    const res = await request(createApp()).get(`${MOUNT}/opportunities/131/edit`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(t(`${K}edit_title`));
    expect(res.text).toContain('Garden Trust');
    expect(res.text).not.toContain('name="organization_id"');
    expect(inputValue(res.text, 'title')).toBe('Food bank sorting');
    expect(inputValue(res.text, 'location')).toBe('Town Hall');
    expect(res.text).toContain('<option value="7" selected>Food</option>');
    expect(inputValue(res.text, 'start_date-day')).toBe('1');
    expect(inputValue(res.text, 'end_date-month')).toBe('6');
    expect(res.text).toMatch(/id="federated_visibility"[^>]*checked/);
    expect(res.text).toContain(`action="${MOUNT}/opportunities/131/edit"`);
  });

  it('saves exactly the fields on the form and keeps the map pin when the place is unchanged', async () => {
    const res = await request(createApp()).post(`${MOUNT}/opportunities/131/edit`).type('form').send(VALID);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${MOUNT}/opportunities/131?status=opp-updated`);
    expect(writes()).toEqual([['test-token', 'PUT', '/opportunities/131', {
      title: 'Food bank sorting (Saturdays)',
      description: 'Sort donated food into parcels.',
      location: 'Town Hall',
      is_remote: false,
      skills_needed: 'Lifting',
      start_date: '2099-03-01',
      end_date: '2099-06-30',
      federated_visibility: 'listed',
      category_id: 7
    }]]);
  });

  it('drops the old map pin when the place changes', async () => {
    await request(createApp()).post(`${MOUNT}/opportunities/131/edit`).type('form')
      .send({ ...VALID, location: 'Community Centre' });

    const body = writes()[0][3];
    expect(body.location).toBe('Community Centre');
    expect(body.latitude).toBeNull();
    expect(body.longitude).toBeNull();
  });

  it('keeps a category it cannot match rather than wiping it', async () => {
    mockApi({ opportunity: { ...OPPORTUNITY, category: 'Heritage' } });

    const form = await request(createApp()).get(`${MOUNT}/opportunities/131/edit`);
    expect(form.text).toContain('<option value="keep" selected>Heritage</option>');

    await request(createApp()).post(`${MOUNT}/opportunities/131/edit`).type('form')
      .send({ ...VALID, category_id: 'keep' });
    expect(writes()[0][3]).not.toHaveProperty('category_id');
  });

  it('refuses a missing title and a half-filled date locally, keeping what was typed', async () => {
    const res = await request(createApp()).post(`${MOUNT}/opportunities/131/edit`).type('form')
      .send({ ...VALID, title: '  ', 'end_date-day': '', description: 'New words' });

    expect(res.status).toBe(400);
    expect(res.text).toContain('govuk-error-summary');
    expect(res.text).toContain(t('govuk_alpha_volunteering.create_opp.error_title_required'));
    expect(res.text).toContain(t(`${K}error_end_date`));
    expect(res.text).toContain('New words');
    expect(writes()).toHaveLength(0);
  });

  it('refuses an end date before the start date', async () => {
    const res = await request(createApp()).post(`${MOUNT}/opportunities/131/edit`).type('form')
      .send({ ...VALID, 'end_date-year': '2098' });

    expect(res.status).toBe(400);
    expect(res.text).toContain(t(`${K}error_end_before_start`));
    expect(writes()).toHaveLength(0);
  });

  it('comes back to the form, still filled in, when the API refuses the details', async () => {
    mockApi({ writeError: new api.ApiError('invalid', 422, { errors: [{ code: 'VALIDATION_ERROR' }] }) });
    const agent = request.agent(createApp());

    const post = await agent.post(`${MOUNT}/opportunities/131/edit`).type('form').send({ ...VALID, title: 'Typed title' });
    expect(post.headers.location).toBe(`${MOUNT}/opportunities/131/edit`);

    const form = await agent.get(`${MOUNT}/opportunities/131/edit`);
    expect(form.text).toContain(t(`${K}update_invalid`));
    expect(inputValue(form.text, 'title')).toBe('Typed title');
  });

  it('refuses anyone who cannot manage it, and writes nothing', async () => {
    mockApi({ opportunity: { ...OPPORTUNITY, can_manage: false, is_owner: false } });

    expect((await request(createApp()).get(`${MOUNT}/opportunities/131/edit`)).status).toBe(403);
    expect((await request(createApp()).post(`${MOUNT}/opportunities/131/edit`).type('form').send(VALID)).status).toBe(403);
    expect((await request(createApp()).post(`${MOUNT}/opportunities/131/close`).type('form').send({})).status).toBe(403);
    expect((await request(createApp()).post(`${MOUNT}/opportunities/131/cancel`).type('form').send({})).status).toBe(403);
    expect(writes()).toHaveLength(0);
  });

  it('sends a cancelled opportunity back to its page instead of editing it', async () => {
    mockApi({ opportunity: { ...OPPORTUNITY, is_active: false } });

    const res = await request(createApp()).get(`${MOUNT}/opportunities/131/edit`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${MOUNT}/opportunities/131?status=opp-is-cancelled`);
  });
});

describe('closing, reopening and cancelling', () => {
  it('closes and reopens through the status field', async () => {
    const close = await request(createApp()).post(`${MOUNT}/opportunities/131/close`).type('form').send({});
    expect(close.headers.location).toBe(`${MOUNT}/opportunities/131?status=opp-closed`);

    const reopen = await request(createApp()).post(`${MOUNT}/opportunities/131/reopen`).type('form').send({});
    expect(reopen.headers.location).toBe(`${MOUNT}/opportunities/131?status=opp-reopened`);

    expect(writes()).toEqual([
      ['test-token', 'PUT', '/opportunities/131', { status: 'closed' }],
      ['test-token', 'PUT', '/opportunities/131', { status: 'open' }]
    ]);
  });

  it('asks before cancelling, and offers closing instead', async () => {
    const res = await request(createApp()).get(`${MOUNT}/opportunities/131/cancel`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(t(`${K}cancel_title`));
    expect(res.text).toContain('govuk-warning-text');
    expect(res.text).toContain(`action="${MOUNT}/opportunities/131/cancel"`);
    expect(res.text).toContain(`action="${MOUNT}/opportunities/131/close"`);
    expect(writes()).toHaveLength(0);
  });

  it('does not offer closing on the cancel page when it is already closed', async () => {
    mockApi({ opportunity: { ...OPPORTUNITY, status: 'closed' } });

    const res = await request(createApp()).get(`${MOUNT}/opportunities/131/cancel`);
    expect(res.text).not.toContain(`action="${MOUNT}/opportunities/131/close"`);
  });

  it('cancels with DELETE and says so', async () => {
    const res = await request(createApp()).post(`${MOUNT}/opportunities/131/cancel`).type('form').send({});

    expect(res.headers.location).toBe(`${MOUNT}/opportunities/131?status=opp-cancelled`);
    expect(writes()).toEqual([['test-token', 'DELETE', '/opportunities/131', undefined]]);
  });

  it('reports a failure on the opportunity page', async () => {
    mockApi({ writeError: new api.ApiError('broken', 500, {}) });

    const res = await request(createApp()).post(`${MOUNT}/opportunities/131/close`).type('form').send({});
    expect(res.headers.location).toBe(`${MOUNT}/opportunities/131?status=opp-manage-failed`);
  });
});
