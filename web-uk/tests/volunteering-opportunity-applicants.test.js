// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Who applied to one opportunity, on the accessible site
 * (routes/volunteering-opportunity-applicants.js, parity gap 4, 21 Oct 2026). Before
 * this the only review list covered a whole organisation.
 *
 * Pinned here:
 * - the list shows applications waiting for a decision by default; Approved, Declined
 *   and All are one link away, and load-more keeps the tab;
 * - a waiting application offers Approve and Decline with an optional note; a decided
 *   one shows its status and the note instead;
 * - the decision is sent to the same API the organisation review list uses, and the
 *   organiser comes back to the same tab with the outcome;
 * - the API's own words are shown when it refuses (a note required when declining);
 * - someone who cannot manage the opportunity gets the 403 page.
 */

const request = require('supertest');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  return { ApiError, ApiOfflineError: class ApiOfflineError extends Error {}, callVolunteeringApi: jest.fn() };
});

const api = require('../src/lib/api');
const routes = require('../src/routes/volunteering-opportunity-applicants');
const { MOUNT, t, createVolunteeringApp, html } = require('./support/volunteering-route-app');

const PAGE = `${MOUNT}/opportunities/131/applications`;
const K = 'govuk_alpha_volunteering.opp_applicants.';

const ITEMS = [
  { id: 241, status: 'pending', message: 'I can do Saturdays.', org_note: null, user: { id: 50, name: 'Ada Lovelace' }, shift: { id: 71, start_time: '2099-03-14 09:00:00', end_time: '2099-03-14 12:00:00' }, created_at: '2026-10-01 10:00:00' },
  { id: 242, status: 'approved', message: '', org_note: 'Welcome aboard', user: { id: 51, name: 'Alan Turing' }, shift: null, created_at: '2026-09-01 10:00:00' }
];

function mockApi({ canManage = true, items = ITEMS, hasMore = false, writeError = null } = {}) {
  api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => {
    if (method === 'GET' && apiPath === '/opportunities/131') return { data: { id: 131, title: 'Garden help', can_manage: canManage } };
    if (method === 'GET' && apiPath.startsWith('/opportunities/131/applications?')) {
      return { data: { items, cursor: hasMore ? 'MjQw' : null, has_more: hasMore } };
    }
    if (method === 'PUT' && /^\/applications\/\d+$/.test(apiPath)) {
      if (writeError) throw writeError;
      return { data: { success: true } };
    }
    throw new api.ApiError(`unexpected ${method} ${apiPath}`, 500, {});
  });
}

function listPath() {
  return api.callVolunteeringApi.mock.calls.find(([, m, p]) => m === 'GET' && p.includes('/applications?'))[2];
}

function writes() {
  return api.callVolunteeringApi.mock.calls.filter(([, method]) => method !== 'GET');
}

function card(text, id) {
  const start = text.indexOf(`data-testid="applicant-${id}"`);
  return start < 0 ? '' : text.slice(start, text.indexOf('</article>', start));
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

describe("an opportunity's applications", () => {
  it('asks for those waiting for a decision by default', async () => {
    const res = await request(createVolunteeringApp(routes)).get(PAGE);

    expect(res.status).toBe(200);
    expect(listPath()).toBe('/opportunities/131/applications?per_page=20&status=pending');
    expect(res.text).toContain('Garden help');
    expect(res.text).toContain(html(t(`${K}title`)));
    expect(res.text).toMatch(/aria-current="page" data-testid="applicants-filter-pending"/);
  });

  it('offers Approve and Decline with a note on a waiting application', async () => {
    const res = await request(createVolunteeringApp(routes)).get(PAGE);
    const ada = card(res.text, 241);

    expect(ada).toContain('href="/acme/accessible/members/50"');
    expect(ada).toContain('I can do Saturdays.');
    expect(ada).toContain('Saturday, 14 March 2099');
    expect(ada).toContain('1 October 2026');
    expect(ada).toContain('action="/acme/accessible/volunteering/opportunities/131/applications/241"');
    expect(ada).toContain('name="org_note"');
    expect(ada).toContain('value="approve"');
    expect(ada).toContain('value="decline"');
  });

  it('shows a decided application with its status and note, and no form', async () => {
    const res = await request(createVolunteeringApp(routes)).get(PAGE);
    const alan = card(res.text, 242);

    expect(alan).toContain('data-testid="applicant-status-242"');
    expect(alan).toContain('Welcome aboard');
    expect(alan).not.toContain('<form');
  });

  it('asks for every status under All and keeps the tab when loading more', async () => {
    mockApi({ hasMore: true });
    const res = await request(createVolunteeringApp(routes)).get(`${PAGE}?show=all`);

    expect(listPath()).toBe('/opportunities/131/applications?per_page=20');
    expect(res.text).toContain('href="/acme/accessible/volunteering/opportunities/131/applications?show=all&amp;cursor=MjQw"');
  });

  it('says so when nobody has applied, or nobody has that status', async () => {
    mockApi({ items: [] });
    const all = await request(createVolunteeringApp(routes)).get(`${PAGE}?show=all`);
    expect(all.text).toContain(html(t(`${K}none_yet`)));
    const declined = await request(createVolunteeringApp(routes)).get(`${PAGE}?show=declined`);
    expect(declined.text).toContain(html(t(`${K}none_filtered`)));
  });

  it('gives someone who cannot manage the opportunity the 403 page', async () => {
    mockApi({ canManage: false });
    const res = await request(createVolunteeringApp(routes)).get(PAGE);
    expect(res.status).toBe(403);
    expect(api.callVolunteeringApi.mock.calls.some(([, , p]) => p.includes('/applications?'))).toBe(false);
  });
});

describe('deciding an application', () => {
  it('approves with the note and returns to the same tab', async () => {
    const agent = request.agent(createVolunteeringApp(routes));
    const { posted, page } = await postAndFollow(agent, `${PAGE}/241`, { action: 'approve', org_note: ' See you Saturday ', show: 'all' });

    expect(writes()).toEqual([['test-token', 'PUT', '/applications/241', { action: 'approve', org_note: 'See you Saturday' }]]);
    expect(posted.headers.location).toBe('/acme/accessible/volunteering/opportunities/131/applications?show=all&status=application-approved');
    expect(page.text).toContain(html(t('govuk_alpha.vol_org.states.application-approved')));
  });

  it('declines without a note when none is written', async () => {
    const agent = request.agent(createVolunteeringApp(routes));
    const { posted } = await postAndFollow(agent, `${PAGE}/241`, { action: 'decline', org_note: '' });

    expect(writes()[0][3]).toEqual({ action: 'decline' });
    expect(posted.headers.location).toBe('/acme/accessible/volunteering/opportunities/131/applications?status=application-declined');
  });

  it("shows the API's words when it refuses", async () => {
    mockApi({ writeError: new api.ApiError('note', 422, { errors: [{ code: 'VALIDATION_ERROR', message: 'A note is required before declining.' }] }) });
    const agent = request.agent(createVolunteeringApp(routes));
    const { page } = await postAndFollow(agent, `${PAGE}/241`, { action: 'decline' });

    expect(page.text).toContain('govuk-error-summary');
    expect(page.text).toContain('A note is required before declining.');
  });

  it('explains a safeguarding refusal in the safeguarding wording', async () => {
    mockApi({ writeError: new api.ApiError('no', 403, { errors: [{ code: 'VETTING_REQUIRED' }] }) });
    const agent = request.agent(createVolunteeringApp(routes));
    const { page } = await postAndFollow(agent, `${PAGE}/241`, { action: 'approve' });
    expect(page.text).toContain(html(t('safeguarding.errors.interaction_not_allowed')));
  });
});
