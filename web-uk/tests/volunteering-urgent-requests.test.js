// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Organisers ask volunteers to cover a shift at short notice, and withdraw the request,
 * on the accessible site (routes/volunteering-shifts.js, parity gap 2, 21 Oct 2026).
 * Before this only the website could send one.
 *
 * Pinned here:
 * - every upcoming shift on the shift list offers "Ask for help"; a past one does not;
 * - the form sends shift, message, priority, expiry and (only when given) skills;
 * - an empty or too-long message comes back with an error and the typed values, and
 *   nothing is sent;
 * - the result says how many volunteers were asked, or that nobody could be;
 * - a shift that has started cannot be asked about, and a refusal the API words
 *   itself is shown in its words;
 * - active requests are listed with their answers, and Withdraw deletes one;
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
const routes = require('../src/routes/volunteering-shifts');
const { MOUNT, t, createVolunteeringApp, html } = require('./support/volunteering-route-app');

const SHIFTS = `${MOUNT}/opportunities/131/shifts`;
const FORM = `${SHIFTS}/71/ask-for-help`;
const U = 'govuk_alpha_volunteering.urgent_requests.';

const SHIFT_ROWS = [
  { id: 71, start_time: '2099-03-14 09:00:00', end_time: '2099-03-14 12:00:00', capacity: 3, signup_count: 2 },
  { id: 70, start_time: '2020-01-01 09:00:00', end_time: '2020-01-01 12:00:00', capacity: 3, signup_count: 3 }
];
const ALERTS = [
  { id: 9, priority: 'critical', message: 'Two people dropped out.', status: 'active', shift: { id: 71, start_time: '2099-03-14 09:00:00', end_time: '2099-03-14 12:00:00' }, stats: { total_notified: 6, total_accepted: 1, total_declined: 2 } },
  { id: 8, priority: 'normal', message: 'Old request', status: 'expired', shift: { id: 71, start_time: '2099-03-14 09:00:00', end_time: '2099-03-14 12:00:00' }, stats: {} }
];

function mockApi({ canManage = true, alerts = ALERTS, sendResult = { id: 10, notified: 4 }, sendError = null, withdrawError = null } = {}) {
  api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => {
    if (method === 'GET' && apiPath === '/opportunities/131') return { data: { id: 131, title: 'Garden help', can_manage: canManage } };
    if (method === 'GET' && apiPath === '/opportunities/131/shifts') return { data: { shifts: SHIFT_ROWS } };
    if (method === 'GET' && apiPath === '/opportunities/131/recurring-patterns') return { data: [] };
    if (method === 'GET' && apiPath === '/opportunities/131/emergency-alerts') return { data: { alerts } };
    if (method === 'POST' && apiPath === '/emergency-alerts') {
      if (sendError) throw sendError;
      return { data: sendResult };
    }
    if (method === 'DELETE' && apiPath === '/emergency-alerts/9') {
      if (withdrawError) throw withdrawError;
      return {};
    }
    throw new api.ApiError(`unexpected ${method} ${apiPath}`, 500, {});
  });
}

function writes() {
  return api.callVolunteeringApi.mock.calls.filter(([, method]) => method !== 'GET');
}

/** Follow one redirect inside the same agent, so the one-shot form replay survives. */
async function postAndFollow(agent, url, body) {
  const posted = await agent.post(url).type('form').send(body);
  expect(posted.status).toBe(302);
  return { posted, page: await agent.get(posted.headers.location) };
}

beforeEach(() => {
  api.callVolunteeringApi.mockReset();
  mockApi();
});

describe('the shift list', () => {
  it('offers Ask for help on an upcoming shift only', async () => {
    const res = await request(createVolunteeringApp(routes)).get(SHIFTS);

    expect(res.status).toBe(200);
    expect(res.text).toContain('data-testid="shift-ask-for-help-71"');
    expect(res.text).toContain(`href="/acme/accessible/volunteering/opportunities/131/shifts/71/ask-for-help"`);
    expect(res.text).not.toContain('data-testid="shift-ask-for-help-70"');
  });

  it('lists the active requests with their answers and a Withdraw button', async () => {
    const res = await request(createVolunteeringApp(routes)).get(SHIFTS);
    const list = res.text.slice(res.text.indexOf('data-testid="urgent-request-list"'));

    expect(res.text).toContain(html(t(`${U}list_heading`)));
    expect(list).toContain('data-testid="urgent-request-9"');
    expect(list).not.toContain('data-testid="urgent-request-8"');
    expect(list).toContain('Two people dropped out.');
    expect(list).toContain(t(`${U}priority.critical`));
    expect(list).toContain(html(t(`${U}list_counts`, { asked: 6, accepted: 1, declined: 2 })));
    expect(list).toContain('action="/acme/accessible/volunteering/opportunities/131/urgent-requests/9/withdraw"');
  });

  it('shows no request section when there are none, and survives the list failing', async () => {
    mockApi({ alerts: [] });
    const none = await request(createVolunteeringApp(routes)).get(SHIFTS);
    expect(none.text).not.toContain('data-testid="urgent-request-list"');

    api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => {
      if (apiPath === '/opportunities/131/emergency-alerts') throw new api.ApiError('down', 500, {});
      if (apiPath === '/opportunities/131') return { data: { id: 131, title: 'Garden help', can_manage: true } };
      if (apiPath === '/opportunities/131/shifts') return { data: { shifts: SHIFT_ROWS } };
      return { data: [] };
    });
    const failing = await request(createVolunteeringApp(routes)).get(SHIFTS);
    expect(failing.status).toBe(200);
    expect(failing.text).toContain('data-testid="shift-ask-for-help-71"');
  });
});

describe('asking for help', () => {
  it('shows the form for the shift, urgent and one day chosen', async () => {
    const res = await request(createVolunteeringApp(routes)).get(FORM);

    expect(res.status).toBe(200);
    expect(res.text).toContain(html(t(`${U}title`)));
    expect(res.text).toContain(html(t(`${U}intro`)));
    expect(res.text).toMatch(/value="urgent" checked/);
    expect(res.text).toMatch(/value="24" checked/);
    expect(res.text).toContain('maxlength="1000"');
  });

  it('sends the request and says how many volunteers were asked', async () => {
    const agent = request.agent(createVolunteeringApp(routes));
    const { posted, page } = await postAndFollow(agent, FORM, {
      message: '  Can anyone cover?  ', priority: 'critical', required_skills: 'first aid, driving', expires_hours: '6'
    });

    expect(writes()).toEqual([['test-token', 'POST', '/emergency-alerts', {
      shift_id: 71, message: 'Can anyone cover?', priority: 'critical', expires_hours: 6, required_skills: 'first aid, driving'
    }]]);
    expect(posted.headers.location).toBe('/acme/accessible/volunteering/opportunities/131/shifts?status=urgent-sent&count=4');
    expect(page.text).toContain(html(t(`${U}sent`, { count: 4 })));
  });

  it('leaves skills out when none are named, and says when nobody could be asked', async () => {
    mockApi({ sendResult: { id: 10, notified: 0 } });
    const agent = request.agent(createVolunteeringApp(routes));
    const { posted, page } = await postAndFollow(agent, FORM, { message: 'Help', priority: 'normal', expires_hours: '72' });

    expect(writes()[0][3]).toEqual({ shift_id: 71, message: 'Help', priority: 'normal', expires_hours: 72 });
    expect(posted.headers.location).toBe('/acme/accessible/volunteering/opportunities/131/shifts?status=urgent-sent-none');
    expect(page.text).toContain(html(t(`${U}sent_none`)));
    expect(page.text).toContain('govuk-notification-banner');
  });

  it('refuses an empty message, keeping what was chosen', async () => {
    const agent = request.agent(createVolunteeringApp(routes));
    const { page } = await postAndFollow(agent, FORM, { message: '   ', priority: 'critical', required_skills: 'driving', expires_hours: '48' });

    expect(writes()).toEqual([]);
    expect(page.text).toContain('govuk-error-summary');
    expect(page.text).toContain(html(t(`${U}message_required`)));
    expect(page.text).toContain('href="#message"');
    expect(page.text).toMatch(/value="critical" checked/);
    expect(page.text).toMatch(/value="48" checked/);
    expect(page.text).toContain('value="driving"');
  });

  it('refuses a message over 1,000 characters and keeps it to be cut', async () => {
    const agent = request.agent(createVolunteeringApp(routes));
    const long = 'a'.repeat(1001);
    const { page } = await postAndFollow(agent, FORM, { message: long, priority: 'urgent', expires_hours: '24' });

    expect(writes()).toEqual([]);
    expect(page.text).toContain(html(t(`${U}message_too_long`)));
    expect(page.text).toContain(long);
  });

  it('ignores an invented priority or expiry and uses the defaults', async () => {
    const agent = request.agent(createVolunteeringApp(routes));
    await postAndFollow(agent, FORM, { message: 'Help', priority: 'apocalyptic', expires_hours: '9999' });
    expect(writes()[0][3]).toEqual({ shift_id: 71, message: 'Help', priority: 'urgent', expires_hours: 24 });
  });

  it("shows the API's own words when it refuses", async () => {
    mockApi({ sendError: new api.ApiError('bad', 422, { errors: [{ code: 'VALIDATION_ERROR', message: 'Nope, said the API.', field: 'message' }] }) });
    const agent = request.agent(createVolunteeringApp(routes));
    const { page } = await postAndFollow(agent, FORM, { message: 'Help', priority: 'urgent', expires_hours: '24' });

    expect(page.text).toContain('Nope, said the API.');
    expect(page.text).toContain('href="#message"');
  });

  it('sends the organiser back to the list when the shift has started', async () => {
    const past = await request(createVolunteeringApp(routes)).get(`${SHIFTS}/70/ask-for-help`);
    expect(past.status).toBe(302);
    expect(past.headers.location).toBe('/acme/accessible/volunteering/opportunities/131/shifts?status=shift-started');

    mockApi({ sendError: new api.ApiError('started', 400, { errors: [{ code: 'VALIDATION_ERROR', message: 'Started', field: 'shift_id' }] }) });
    const posted = await request(createVolunteeringApp(routes)).post(FORM).type('form').send({ message: 'Help' });
    expect(posted.headers.location).toBe('/acme/accessible/volunteering/opportunities/131/shifts?status=shift-started');
  });

  it('gives someone who cannot manage the opportunity the 403 page', async () => {
    mockApi({ canManage: false });
    expect((await request(createVolunteeringApp(routes)).get(FORM)).status).toBe(403);

    mockApi({ sendError: new api.ApiError('no', 403, { errors: [{ code: 'FORBIDDEN' }] }) });
    expect((await request(createVolunteeringApp(routes)).post(FORM).type('form').send({ message: 'Help' })).status).toBe(403);
  });
});

describe('withdrawing a request', () => {
  it('deletes it and says so', async () => {
    const agent = request.agent(createVolunteeringApp(routes));
    const { posted, page } = await postAndFollow(agent, `${MOUNT}/opportunities/131/urgent-requests/9/withdraw`, { confirmed: '1' });

    expect(writes()).toEqual([['test-token', 'DELETE', '/emergency-alerts/9']]);
    expect(posted.headers.location).toBe('/acme/accessible/volunteering/opportunities/131/shifts?status=urgent-withdrawn');
    expect(page.text).toContain(html(t(`${U}withdrawn`)));
  });

  it('says when it could not be withdrawn', async () => {
    mockApi({ withdrawError: new api.ApiError('gone', 500, {}) });
    const agent = request.agent(createVolunteeringApp(routes));
    const { page } = await postAndFollow(agent, `${MOUNT}/opportunities/131/urgent-requests/9/withdraw`, { confirmed: '1' });

    expect(page.text).toContain('govuk-error-summary');
    expect(page.text).toContain(html(t(`${U}withdraw_failed`)));
  });
});
