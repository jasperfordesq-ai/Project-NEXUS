// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * An organisation confirms its volunteers' qualifications on the accessible site
 * (routes/volunteering-org-qualifications.js, gap B7 part 3, 7 Oct 2026). Before this a
 * volunteer could record a qualification here but nobody could confirm it here.
 *
 * Pinned here:
 * - the register shows qualifications needing attention by default, the counts, and
 *   each qualification with only the actions the API accepts for its status;
 * - a member's own qualification offers no Confirm, only a note (withdraw stays);
 * - confirm sends the method and the organisation; withdraw sends the reason;
 * - the API's SELF_CONFIRMATION and EXPIRED refusals each come back with their own
 *   message, and the filter and search survive every round trip;
 * - someone who does not run the organisation gets the 403 page.
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
    getProfile: jest.fn()
  };
});
jest.mock('../src/lib/request-profile', () => ({ getRequestProfile: jest.fn() }));

const api = require('../src/lib/api');
const { getRequestProfile } = require('../src/lib/request-profile');
const qualificationRoutes = require('../src/routes/volunteering-org-qualifications');

const PREFIX = '/acme/accessible';
const MOUNT = `${PREFIX}/volunteering`;
const PAGE = `${MOUNT}/organisations/114/qualifications`;
const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');
const K = 'govuk_alpha_volunteering.org_qualifications.';
const html = (text) => String(text).replace(/'/g, '&#39;');

function createApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'org-qualifications-test-secret', resave: false, saveUninitialized: false }));
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
  }, qualificationRoutes);
  return app;
}

const ITEMS = [
  { id: 1, user_id: 50, volunteer: { id: 50, name: 'Ada Lovelace' }, qualification_type: 'first_aid', title: 'Occupational first aid', issuer: 'Red Cross', reference_number: 'RC-1', obtained_at: '2025-03-01', expires_at: '2027-03-01', status: 'recorded', is_expiring: true },
  { id: 2, user_id: 51, volunteer: { id: 51, name: 'Alan Turing' }, qualification_type: 'driving_licence', status: 'confirmed', confirmed_by: { name: 'Grace Hopper' }, confirmed_for_organization: { name: 'Garden Trust' }, confirmed_at: '2026-09-01 10:00:00', confirmation_method: 'saw_original' },
  { id: 3, user_id: 7, volunteer: { id: 7, name: 'Me Myself' }, qualification_type: 'food_hygiene', status: 'recorded' },
  { id: 4, user_id: 52, volunteer: { id: 52, name: 'Katherine Johnson' }, qualification_type: 'manual_handling', expires_at: '2026-01-01', status: 'expired' },
  { id: 5, user_id: 53, volunteer: { id: 53, name: 'Hedy Lamarr' }, qualification_type: 'other', status: 'withdrawn' }
];

function mockApi({ items = ITEMS, listError = null, writeError = null, nextCursor = null } = {}) {
  getRequestProfile.mockResolvedValue({ data: { id: 7 } });
  api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => {
    if (method === 'GET' && apiPath.startsWith('/organizations/114/qualifications?')) {
      if (listError) throw listError;
      return { data: { items, counts: { expiring: 1, recorded: 2, confirmed: 1, expired: 1 }, next_cursor: nextCursor } };
    }
    if (method === 'GET' && apiPath === '/organisations/114/stats') return { data: { org_name: 'Garden Trust' } };
    if (method === 'POST' && /^\/qualifications\/\d+\/(confirm|withdraw)$/.test(apiPath)) {
      if (writeError) throw writeError;
      return { data: { success: true } };
    }
    throw new api.ApiError('unexpected', 500, {});
  });
}

function card(text, id) {
  const start = text.indexOf(`data-testid="qualification-${id}"`);
  const end = text.indexOf('</article>', start);
  return text.slice(start, end);
}

function listPath() {
  return api.callVolunteeringApi.mock.calls.find(([, method, p]) => method === 'GET' && p.startsWith('/organizations/'))[2];
}

function writes() {
  return api.callVolunteeringApi.mock.calls.filter(([, method]) => method !== 'GET');
}

beforeEach(() => {
  api.callVolunteeringApi.mockReset();
  getRequestProfile.mockReset();
  mockApi();
});

describe('the qualifications register', () => {
  it('shows what needs attention by default, with the counts and the organisation', async () => {
    const res = await request(createApp()).get(PAGE);

    expect(res.status).toBe(200);
    expect(listPath()).toBe('/organizations/114/qualifications?per_page=20&status=attention');
    expect(res.text).toContain('Garden Trust');
    expect(res.text).toContain(t(`${K}heading`));
    expect(res.text).toContain(t(`${K}tiles.expiring`));
    expect(res.text).toMatch(/govuk-tabs__list-item--selected">\s*<a[^>]*aria-current="page">/);
  });

  it('shows each qualification with its details', async () => {
    const res = await request(createApp()).get(PAGE);

    const first = card(res.text, 1);
    expect(first).toContain('Ada Lovelace');
    expect(first).toContain(`${t(`${K}types.first_aid`)}: Occupational first aid`);
    expect(first).toContain('Red Cross');
    expect(first).toContain(t(`${K}reference`, { ref: 'RC-1' }));
    expect(first).toContain(t(`${K}status.expiring`));
    expect(first).toContain('1 March 2027');

    const confirmed = card(res.text, 2);
    expect(confirmed).toContain('Grace Hopper');
    expect(confirmed).toContain(t(`${K}method_short.saw_original`));

    expect(card(res.text, 4)).toContain(t(`${K}expired_on`, { date: '1 January 2026' }));
  });

  it('offers only the actions the API accepts for each status', async () => {
    const res = await request(createApp()).get(PAGE);

    const recorded = card(res.text, 1);
    expect(recorded).toContain(`action="${PAGE}/1/confirm"`);
    expect(recorded).toContain(`action="${PAGE}/1/withdraw"`);
    expect(recorded).toContain('name="method" type="radio" value="saw_original" checked');

    const confirmed = card(res.text, 2);
    expect(confirmed).not.toContain('/confirm"');
    expect(confirmed).toContain(`action="${PAGE}/2/withdraw"`);

    expect(card(res.text, 4)).toContain(`action="${PAGE}/4/confirm"`);

    const withdrawn = card(res.text, 5);
    expect(withdrawn).not.toContain('<form');
  });

  it('offers no Confirm on the member\'s own qualification, only a note', async () => {
    const res = await request(createApp()).get(PAGE);

    const own = card(res.text, 3);
    expect(own).not.toContain('/confirm"');
    expect(own).toContain(html(t(`${K}confirm.self`)));
    expect(own).toContain(`action="${PAGE}/3/withdraw"`);
  });

  it('passes the filter and the search to the API, and keeps them in every form', async () => {
    const res = await request(createApp()).get(`${PAGE}?show=all&q=lovelace`);

    expect(listPath()).toBe('/organizations/114/qualifications?per_page=20&q=lovelace');
    const first = card(res.text, 1);
    expect(first).toContain('name="show" value="all"');
    expect(first).toContain('name="q" value="lovelace"');
  });

  it('ignores an unknown filter', async () => {
    await request(createApp()).get(`${PAGE}?show=everything`);
    expect(listPath()).toBe('/organizations/114/qualifications?per_page=20&status=attention');
  });

  it('links to the next page when there is one', async () => {
    mockApi({ nextCursor: 'abc' });
    const res = await request(createApp()).get(`${PAGE}?show=confirmed`);
    expect(res.text).toContain(`href="${PAGE}?show=confirmed&amp;cursor=abc"`);
  });

  it('says so when there is nothing to show', async () => {
    mockApi({ items: [] });
    const res = await request(createApp()).get(PAGE);
    expect(res.text).toContain(t(`${K}empty_title`));
  });

  it('gives someone who does not run the organisation the 403 page', async () => {
    mockApi({ listError: new api.ApiError('denied', 403, {}) });
    expect((await request(createApp()).get(PAGE)).status).toBe(403);
  });
});

describe('confirming a qualification', () => {
  function confirm(id, body) {
    return request(createApp()).post(`${PAGE}/${id}/confirm`).type('form').send(body);
  }

  it('sends the method and the organisation', async () => {
    const res = await confirm(1, { method: 'online_register', show: 'all', q: 'ada' });

    expect(res.headers.location).toBe(`${PAGE}?show=all&q=ada&status=qualification-confirmed`);
    expect(writes()).toEqual([['test-token', 'POST', '/qualifications/1/confirm', { method: 'online_register', organization_id: 114 }]]);
  });

  it.each([
    [new api.ApiError('own', 403, { errors: [{ code: 'SELF_CONFIRMATION' }] }), 'qualification-self'],
    [new api.ApiError('expired', 409, { errors: [{ code: 'EXPIRED' }] }), 'qualification-expired'],
    [new api.ApiError('broken', 500, {}), 'qualification-failed']
  ])('answers a refusal with its own message (%#)', async (error, outcome) => {
    mockApi({ writeError: error });
    const res = await confirm(1, { method: 'saw_original' });
    expect(res.headers.location).toBe(`${PAGE}?status=${outcome}`);
  });

  it('refuses an unknown method without calling the API', async () => {
    const res = await confirm(1, { method: 'trust_me' });
    expect(res.headers.location).toBe(`${PAGE}?status=qualification-failed`);
    expect(writes()).toHaveLength(0);
  });

  it('shows the outcome on the page', async () => {
    const res = await request(createApp()).get(`${PAGE}?status=qualification-expired`);
    expect(res.text).toContain(t(`${K}confirm.expired_hint`));
  });
});

describe('withdrawing a qualification', () => {
  function withdraw(id, body) {
    return request(createApp()).post(`${PAGE}/${id}/withdraw`).type('form').send(body);
  }

  it('sends the reason', async () => {
    const res = await withdraw(2, { reason: 'no_longer_held' });

    expect(res.headers.location).toBe(`${PAGE}?status=qualification-withdrawn`);
    expect(writes()).toEqual([['test-token', 'POST', '/qualifications/2/withdraw', { reason: 'no_longer_held' }]]);
  });

  it('refuses an unknown reason without calling the API', async () => {
    const res = await withdraw(2, { reason: 'bored' });
    expect(res.headers.location).toBe(`${PAGE}?status=qualification-failed`);
    expect(writes()).toHaveLength(0);
  });

  it('reports a failure', async () => {
    mockApi({ writeError: new api.ApiError('broken', 500, {}) });
    const res = await withdraw(2, { reason: 'replaced' });
    expect(res.headers.location).toBe(`${PAGE}?status=qualification-failed`);
  });
});
