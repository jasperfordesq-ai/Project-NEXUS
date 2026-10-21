// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Retire, reinstate and remove volunteers on an organisation's roster on the accessible
 * site (routes/volunteering-org-roster.js and the roster list in
 * routes/volunteering-actions.js, parity gap 3, 21 Oct 2026). The roster was read-only.
 *
 * Pinned here:
 * - the roster has Active and Retired tabs; Retired asks the API for status=retired and
 *   shows when each volunteer was retired; load-more keeps the tab;
 * - an active volunteer offers Retire and Remove, a retired one Reinstate and Remove;
 * - Retire and Remove ask first on a page naming the volunteer, found by the roster's
 *   own cursor; someone not on that list gets the 404 page;
 * - each action calls the API, comes back to the right tab, and says what happened
 *   with the volunteer's name, which never appears in the address;
 * - the API's own refusal wording is shown when it gives one;
 * - someone who does not run the organisation gets the 403 page.
 */

const express = require('express');
const request = require('supertest');

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
    getProfile: jest.fn()
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] }))
  });
});
jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() })
}));

const api = require('../src/lib/api');
const rosterRoutes = require('../src/routes/volunteering-org-roster');
const volunteeringRoutes = require('../src/routes/volunteering-actions');
const { MOUNT, t, createVolunteeringApp, html } = require('./support/volunteering-route-app');

const ROSTER = `${MOUNT}/organisations/114/volunteers`;
const R = 'govuk_alpha_volunteering.org_roster.';

const ACTIVE = [{ id: 50, name: "Ada O'Brien", email: 'ada@example.org', total_hours: 12.5, applications_count: 2, applied_at: '2026-06-20 09:00:00', retired_at: null }];
const RETIRED = [{ id: 51, name: 'Alan Turing', email: 'alan@example.org', total_hours: 3, applications_count: 1, applied_at: '2026-05-01 09:00:00', retired_at: '2026-10-01 10:00:00' }];

function app() {
  const both = express.Router();
  both.use(rosterRoutes);
  both.use(volunteeringRoutes);
  return createVolunteeringApp(both);
}

function mockApi({ listError = null, writeError = null, hasMore = false } = {}) {
  api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => {
    if (method === 'GET' && apiPath === '/organisations/114/stats') return { data: { org_name: 'Garden Trust' } };
    if (method === 'GET' && apiPath.startsWith('/organisations/114/volunteers?')) {
      if (listError) throw listError;
      const query = new URLSearchParams(apiPath.split('?')[1]);
      const rows = query.get('status') === 'retired' ? RETIRED : ACTIVE;
      const below = query.get('cursor') ? Number(query.get('cursor')) : Infinity;
      const items = rows.filter((row) => row.id < below).slice(0, Number(query.get('per_page')));
      return { data: items, meta: { cursor: hasMore ? '40' : null, has_more: hasMore } };
    }
    if (/^\/organisations\/114\/volunteers\/\d+(\/retire|\/reinstate)?$/.test(apiPath) && method !== 'GET') {
      if (writeError) throw writeError;
      return { data: { user_id: 50 } };
    }
    throw new api.ApiError(`unexpected ${method} ${apiPath}`, 500, {});
  });
}

function listCalls() {
  return api.callVolunteeringApi.mock.calls.filter(([, m, p]) => m === 'GET' && p.startsWith('/organisations/114/volunteers?')).map(([, , p]) => p);
}

function writes() {
  return api.callVolunteeringApi.mock.calls.filter(([, method]) => method !== 'GET');
}

async function postAndFollow(agent, url, body) {
  const posted = await agent.post(url).type('form').send(body);
  expect(posted.status).toBe(302);
  return { posted, page: await agent.get(posted.headers.location) };
}

beforeEach(() => {
  api.callVolunteeringApi.mockReset();
  mockApi();
});

describe('the roster', () => {
  it('lists active volunteers with Retire and Remove', async () => {
    const res = await request(app()).get(ROSTER);

    expect(res.status).toBe(200);
    expect(listCalls()).toEqual(['/organisations/114/volunteers?per_page=20']);
    expect(res.text).toMatch(/aria-current="page" data-testid="roster-tab-active"/);
    expect(res.text).toContain(`href="/acme/accessible/volunteering/organisations/114/volunteers/50/retire"`);
    expect(res.text).toContain(`href="/acme/accessible/volunteering/organisations/114/volunteers/50/remove"`);
    expect(res.text).not.toContain('/reinstate');
  });

  it('lists retired volunteers with the date, Reinstate and Remove', async () => {
    const res = await request(app()).get(`${ROSTER}?show=retired`);

    expect(listCalls()).toEqual(['/organisations/114/volunteers?per_page=20&status=retired']);
    expect(res.text).toMatch(/aria-current="page" data-testid="roster-tab-retired"/);
    expect(res.text).toContain('Alan Turing');
    expect(res.text).toContain(t(`${R}retired_on`, { date: '1 October 2026' }));
    expect(res.text).toContain('action="/acme/accessible/volunteering/organisations/114/volunteers/51/reinstate"');
    expect(res.text).toContain('href="/acme/accessible/volunteering/organisations/114/volunteers/51/remove?show=retired"');
    expect(res.text).not.toContain('/51/retire');
  });

  it('keeps the Retired tab when loading more', async () => {
    mockApi({ hasMore: true });
    const res = await request(app()).get(`${ROSTER}?show=retired`);
    expect(res.text).toContain('href="/acme/accessible/volunteering/organisations/114/volunteers?show=retired&amp;cursor=40"');
  });

  it('says so when nobody is retired', async () => {
    api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => (
      apiPath.includes('/stats') ? { data: {} } : { data: [], meta: {} }
    ));
    const res = await request(app()).get(`${ROSTER}?show=retired`);
    expect(res.text).toContain(html(t(`${R}none_retired`)));
  });
});

describe('retiring a volunteer', () => {
  it('asks first, naming the volunteer found by the roster cursor', async () => {
    const res = await request(app()).get(`${ROSTER}/50/retire`);

    expect(res.status).toBe(200);
    expect(listCalls()).toEqual(['/organisations/114/volunteers?per_page=1&cursor=51']);
    expect(res.text).toContain(html(t(`${R}retire_title`)));
    expect(res.text).toContain(html(t(`${R}retire_confirm`, { name: "Ada O'Brien" })));
    expect(res.text).toContain('action="/acme/accessible/volunteering/organisations/114/volunteers/50/retire"');
  });

  it('gives the 404 page for someone not on the active list', async () => {
    expect((await request(app()).get(`${ROSTER}/51/retire`)).status).toBe(404);
  });

  it('retires, returns to the active tab and says so by name', async () => {
    const agent = request.agent(app());
    const { posted, page } = await postAndFollow(agent, `${ROSTER}/50/retire`, { name: "Ada O'Brien" });

    expect(writes()).toEqual([['test-token', 'POST', '/organisations/114/volunteers/50/retire']]);
    expect(posted.headers.location).toBe('/acme/accessible/volunteering/organisations/114/volunteers');
    expect(posted.headers.location).not.toContain('Ada');
    expect(page.text).toContain(html(t(`${R}retired`, { name: "Ada O'Brien" })));
    expect(page.text).toContain('govuk-notification-banner--success');

    // The message is shown once.
    expect((await agent.get(ROSTER)).text).not.toContain(html(t(`${R}retired`, { name: "Ada O'Brien" })));
  });

  it("shows the API's words when it refuses", async () => {
    mockApi({ writeError: new api.ApiError('dup', 409, { errors: [{ code: 'ALREADY_RETIRED', message: 'Already retired.' }] }) });
    const agent = request.agent(app());
    const { page } = await postAndFollow(agent, `${ROSTER}/50/retire`, { name: 'Ada' });

    expect(page.text).toContain('govuk-error-summary');
    expect(page.text).toContain('Already retired.');
  });
});

describe('reinstating a volunteer', () => {
  it('goes straight through and returns to the retired tab', async () => {
    const agent = request.agent(app());
    const { posted, page } = await postAndFollow(agent, `${ROSTER}/51/reinstate`, { name: 'Alan Turing' });

    expect(writes()).toEqual([['test-token', 'POST', '/organisations/114/volunteers/51/reinstate']]);
    expect(posted.headers.location).toBe('/acme/accessible/volunteering/organisations/114/volunteers?show=retired');
    expect(page.text).toContain(html(t(`${R}reinstated`, { name: 'Alan Turing' })));
  });

  it('falls back to its own message when the API gives none', async () => {
    mockApi({ writeError: new api.ApiError('down', 500, {}) });
    const agent = request.agent(app());
    const { page } = await postAndFollow(agent, `${ROSTER}/51/reinstate`, { name: 'Alan Turing' });
    expect(page.text).toContain(html(t(`${R}reinstate_failed`)));
  });
});

describe('removing a volunteer', () => {
  it('asks first, on either list', async () => {
    const active = await request(app()).get(`${ROSTER}/50/remove`);
    expect(active.text).toContain(html(t(`${R}remove_confirm`, { name: "Ada O'Brien" })));
    expect(active.text).toContain('govuk-button--warning');

    const retired = await request(app()).get(`${ROSTER}/51/remove?show=retired`);
    expect(retired.status).toBe(200);
    expect(retired.text).toContain(html(t(`${R}remove_confirm`, { name: 'Alan Turing' })));
    expect(retired.text).toContain('name="show" value="retired"');
  });

  it('removes and returns to the tab it came from', async () => {
    const agent = request.agent(app());
    const { posted, page } = await postAndFollow(agent, `${ROSTER}/51/remove`, { name: 'Alan Turing', show: 'retired' });

    expect(writes()).toEqual([['test-token', 'DELETE', '/organisations/114/volunteers/51']]);
    expect(posted.headers.location).toBe('/acme/accessible/volunteering/organisations/114/volunteers?show=retired');
    expect(page.text).toContain(html(t(`${R}removed`, { name: 'Alan Turing' })));
  });
});

describe('someone who does not run the organisation', () => {
  it('gets the 403 page on the confirmation and the action', async () => {
    mockApi({ listError: new api.ApiError('no', 403, {}) });
    expect((await request(app()).get(`${ROSTER}/50/retire`)).status).toBe(403);

    mockApi({ writeError: new api.ApiError('no', 403, {}) });
    expect((await request(app()).post(`${ROSTER}/50/remove`).type('form').send({})).status).toBe(403);
  });
});
