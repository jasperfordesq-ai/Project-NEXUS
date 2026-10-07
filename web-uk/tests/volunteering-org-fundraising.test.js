// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * An organisation runs its own fundraising campaigns on the accessible site
 * (routes/volunteering-org-fundraising.js, gap B7 part 2, 7 Oct 2026).
 *
 * Pinned here:
 * - the list offers each campaign only the changes that make sense for its state;
 * - the form is checked locally first (title, real dates in order, a money goal), sends
 *   exactly title / description / dates / goal, and shows the API's own reason on a 422;
 * - pause, resume and end send the website's bodies; ending goes through a warning page;
 * - the campaign page shows totals, hand-overs (Confirm only while waiting), gifts and
 *   history, and one section failing does not take the others down;
 * - confirming a hand-over posts to the organisation's own hand-over;
 * - a campaign of another organisation is "not found", and a non-admin gets 403.
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
    callVolunteeringApi: jest.fn()
  };
});

const api = require('../src/lib/api');
const routes = require('../src/routes/volunteering-org-fundraising');

const PREFIX = '/acme/accessible';
const MOUNT = `${PREFIX}/volunteering`;
const LIST = `${MOUNT}/organisations/114/fundraising`;
const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');
const K = 'govuk_alpha_volunteering.org_fundraising.';
const html = (text) => String(text).replace(/'/g, '&#39;');

function createApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'org-fundraising-test-secret', resave: false, saveUninitialized: false }));
  app.use(MOUNT, (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.accessibleRouting = { tenant: { id: 2, slug: 'acme', settings: { default_currency: 'EUR' } } };
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
  }, routes);
  return app;
}

const CAMPAIGNS = [
  { id: 1, title: 'Winter coats', description: 'Coats for the cold months.', start_date: '2099-01-01', end_date: '2099-03-01', goal_amount: '500.00', raised_amount: 120, is_active: true, status: 'active', organization_id: 114 },
  { id: 2, title: 'Paused drive', start_date: '2099-01-01', end_date: '2099-03-01', goal_amount: 100, raised_amount: 0, is_active: false, status: 'paused', organization_id: 114 },
  { id: 3, title: 'Last year', start_date: '2020-01-01', end_date: '2020-03-01', goal_amount: 100, raised_amount: 100, is_active: false, status: 'ended', organization_id: 114 }
];

function mockApi(overrides = {}) {
  const o = { campaigns: CAMPAIGNS, listError: null, writeError: null, giftsError: null, ...overrides };
  api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => {
    if (method === 'GET' && apiPath === '/organisations/114/campaigns') {
      if (o.listError) throw o.listError;
      return { data: { items: o.campaigns } };
    }
    if (method === 'GET' && apiPath === '/organisations/114/stats') return { data: { org_name: 'Garden Trust' } };
    if (method === 'GET' && apiPath === '/organisations/114/campaigns/1/gifts') {
      if (o.giftsError) throw o.giftsError;
      return { data: { items: [
        { id: 70, amount: 20, amount_refunded: 0, currency: 'EUR', status: 'completed', created_at: '2099-01-05 10:00:00', display_name: null, payment_method: 'card' },
        { id: 71, amount: 10, amount_refunded: 0, currency: 'EUR', status: 'pending', created_at: '2099-01-06 10:00:00', display_name: 'Ada Lovelace', payment_method: 'pledge' }
      ] } };
    }
    if (method === 'GET' && apiPath === '/organisations/114/campaigns/1/handovers') {
      return { data: {
        items: [
          { id: 9, amount: 50, currency: 'EUR', handed_over_on: '2099-02-01', method: 'bank_transfer', reference: 'TX-1', status: 'recorded', recorded_by_name: 'Community Admin' },
          { id: 8, amount: 30, currency: 'EUR', handed_over_on: '2099-01-20', method: 'cash', reference: 'C-1', status: 'confirmed', recorded_by_name: 'Community Admin', confirmed_by_name: 'Org Owner' }
        ],
        summary: { raised: 120, handed_over: 80, still_held: 40, currency: 'EUR' }
      } };
    }
    if (method === 'GET' && apiPath === '/organisations/114/campaigns/1/history') {
      return { data: { items: [
        { id: 5, event: 'campaign_updated', actor_kind: 'org_admin', actor_name: 'Org Owner', amount: null, currency: null, donation_id: null, details: { changes: { goal_amount: { from: '400.00', to: '500.00' } } }, created_at: '2099-01-02 09:00:00' },
        { id: 4, event: 'campaign_created', actor_kind: 'org_admin', actor_name: null, amount: null, currency: null, donation_id: null, details: null, created_at: '2099-01-01 09:00:00' }
      ] } };
    }
    if (o.writeError && method !== 'GET') throw o.writeError;
    if (method === 'POST' && apiPath === '/organisations/114/campaigns') return { data: { id: 10 } };
    if (method === 'PUT' && /^\/organisations\/114\/campaigns\/\d+$/.test(apiPath)) return { data: { success: true } };
    if (method === 'POST' && apiPath === '/organisations/114/handovers/9/confirm') return { data: { status: 'confirmed' } };
    throw new api.ApiError('unexpected', 500, {});
  });
}

function writes() {
  return api.callVolunteeringApi.mock.calls.filter(([, method]) => method !== 'GET');
}

function card(text, id) {
  const start = text.indexOf(`data-testid="fundraising-campaign-${id}"`);
  return text.slice(start, text.indexOf('</article>', start));
}

const VALID = {
  title: 'Spring seeds',
  description: 'Seeds for the community garden.',
  'start_date-day': '1', 'start_date-month': '4', 'start_date-year': '2099',
  'end_date-day': '30', 'end_date-month': '4', 'end_date-year': '2099',
  goal_amount: '250.50'
};

beforeEach(() => {
  api.callVolunteeringApi.mockReset();
  mockApi();
});

describe('the campaign list', () => {
  it('shows each campaign with only the changes that fit its state', async () => {
    const res = await request(createApp()).get(LIST);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Garden Trust');
    expect(res.text).toContain(`href="${LIST}/new"`);
    const live = card(res.text, 1);
    expect(live).toContain(t(`${K}status.active`));
    expect(live).toContain('€120.00');
    expect(live).toContain(`action="${LIST}/1/pause"`);
    expect(live).not.toContain('/resume"');
    expect(live).toContain(`href="${LIST}/1/end"`);
    const paused = card(res.text, 2);
    expect(paused).toContain(`action="${LIST}/2/resume"`);
    expect(paused).not.toContain('/pause"');
    const ended = card(res.text, 3);
    expect(ended).not.toContain('/pause"');
    expect(ended).not.toContain('/end"');
  });

  it('says so when there are none, and refuses a non-admin', async () => {
    mockApi({ campaigns: [] });
    expect((await request(createApp()).get(LIST)).text).toContain('data-testid="fundraising-empty"');

    mockApi({ listError: new api.ApiError('denied', 403, {}) });
    expect((await request(createApp()).get(LIST)).status).toBe(403);
  });
});

describe('starting and changing a campaign', () => {
  it('sends exactly the form\'s fields', async () => {
    const res = await request(createApp()).post(`${LIST}/new`).type('form').send(VALID);

    expect(res.headers.location).toBe(`${LIST}?status=campaign-saved`);
    expect(writes()).toEqual([['test-token', 'POST', '/organisations/114/campaigns', {
      title: 'Spring seeds',
      description: 'Seeds for the community garden.',
      start_date: '2099-04-01',
      end_date: '2099-04-30',
      goal_amount: 250.5
    }]]);
  });

  it('checks the form before the API, keeping what was typed', async () => {
    const res = await request(createApp()).post(`${LIST}/new`).type('form')
      .send({ ...VALID, title: ' ', goal_amount: 'lots', 'end_date-year': '2098', description: 'Kept words' });

    expect(res.status).toBe(400);
    expect(res.text).toContain(t(`${K}error_title`));
    expect(res.text).toContain(t(`${K}error_goal`));
    expect(res.text).toContain(t(`${K}error_end_before_start`));
    expect(res.text).toContain('Kept words');
    expect(writes()).toHaveLength(0);
  });

  it('shows the API\'s own reason when it refuses', async () => {
    mockApi({ writeError: new api.ApiError('no', 422, { errors: [{ code: 'VALIDATION_ERROR', message: 'Only approved organisations can run campaigns.' }] }) });
    const agent = request.agent(createApp());

    const post = await agent.post(`${LIST}/new`).type('form').send(VALID);
    expect(post.headers.location).toBe(`${LIST}/new`);
    const form = await agent.get(`${LIST}/new`);
    expect(form.text).toContain('Only approved organisations can run campaigns.');
    expect(form.text).toContain('value="Spring seeds"');
  });

  it('opens the change form filled in and saves with PUT', async () => {
    const form = await request(createApp()).get(`${LIST}/1/edit`);
    expect(form.status).toBe(200);
    expect(form.text).toContain('value="Winter coats"');
    expect(form.text).toContain('value="500"');

    await request(createApp()).post(`${LIST}/1/edit`).type('form').send(VALID);
    expect(writes()[0].slice(1, 3)).toEqual(['PUT', '/organisations/114/campaigns/1']);
  });

  it('is "not found" for a campaign that is not this organisation\'s', async () => {
    expect((await request(createApp()).get(`${LIST}/99/edit`)).status).toBe(404);
    expect((await request(createApp()).post(`${LIST}/99/pause`).type('form').send({})).status).toBe(404);
    expect(writes()).toHaveLength(0);
  });
});

describe('pausing, resuming and ending', () => {
  it('sends the website\'s bodies', async () => {
    await request(createApp()).post(`${LIST}/1/pause`).type('form').send({});
    await request(createApp()).post(`${LIST}/2/resume`).type('form').send({});
    const end = await request(createApp()).post(`${LIST}/1/end`).type('form').send({});

    expect(end.headers.location).toBe(`${LIST}?status=campaign-ended`);
    expect(writes().map(([, , , body]) => body)).toEqual([
      { is_active: false },
      { is_active: true },
      { is_active: false, end_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }
    ]);
  });

  it('warns before ending, offering a pause instead', async () => {
    const res = await request(createApp()).get(`${LIST}/1/end`);
    expect(res.text).toContain('govuk-warning-text');
    expect(res.text).toContain(html(t(`${K}end_confirm`)));
    expect(res.text).toContain(`action="${LIST}/1/pause"`);
    expect(writes()).toHaveLength(0);
  });
});

describe('one campaign', () => {
  it('shows totals, hand-overs, gifts and history', async () => {
    const res = await request(createApp()).get(`${LIST}/1`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Winter coats');
    expect(res.text).toContain('€40.00');
    expect(res.text).toContain(`action="${LIST}/1/handovers/9/confirm"`);
    expect(res.text).not.toContain('/handovers/8/confirm"');
    expect(res.text).toContain(t(`${K}handovers.confirmed_by`, { name: 'Org Owner' }));
    expect(res.text).toContain(t(`${K}anonymous`));
    expect(res.text).toContain('Ada Lovelace');
    expect(res.text).toContain(t(`${K}history.event.campaign_updated`));
    expect(res.text).toContain(t(`${K}history.change`, { field: t(`${K}history.field.goal_amount`), from: '400.00', to: '500.00' }));
  });

  it('keeps showing the rest when one section fails', async () => {
    mockApi({ giftsError: new api.ApiError('broken', 500, {}) });
    const res = await request(createApp()).get(`${LIST}/1`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(t(`${K}load_failed`));
    expect(res.text).toContain(`action="${LIST}/1/handovers/9/confirm"`);
  });

  it('confirms a hand-over through the organisation\'s own address', async () => {
    const res = await request(createApp()).post(`${LIST}/1/handovers/9/confirm`).type('form').send({});

    expect(res.headers.location).toBe(`${LIST}/1?status=handover-confirmed`);
    expect(writes()[0].slice(1, 3)).toEqual(['POST', '/organisations/114/handovers/9/confirm']);
  });

  it('says so when the hand-over cannot be confirmed', async () => {
    mockApi({ writeError: new api.ApiError('no', 422, {}) });
    const res = await request(createApp()).post(`${LIST}/1/handovers/9/confirm`).type('form').send({});
    expect(res.headers.location).toBe(`${LIST}/1?status=handover-failed`);
  });
});
