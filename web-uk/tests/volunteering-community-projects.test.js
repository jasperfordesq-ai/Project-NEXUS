// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Propose and support community projects on the accessible site
 * (routes/volunteering-community-projects.js, parity gap 5, 21 Oct 2026). The tab
 * itself (and the list fix that made it show anything) is pinned in
 * shared-accessible-shell.test.js.
 *
 * Pinned here:
 * - the form sends the title and description, and the optional fields only when given,
 *   with the date as YYYY-MM-DD;
 * - a missing title or description, a number of volunteers that is not a whole number,
 *   or a half-entered date comes back with an error and what was typed, and nothing is
 *   sent; the API's own refusal is placed on its field;
 * - a proposal returns to the tab saying it waits for an administrator;
 * - Support and Remove your support call the API and say what happened; a safeguarding
 *   refusal is worded as one;
 * - a community with the section switched off gets the volunteering page.
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
const routes = require('../src/routes/volunteering-community-projects');
const { MOUNT, t, createVolunteeringApp, html } = require('./support/volunteering-route-app');

const FORM = `${MOUNT}/community-projects/propose`;
const CP = 'govuk_alpha_volunteering.community_projects.';
const TAB = '/acme/accessible/volunteering?tab=community_projects';

function writes() {
  return api.callVolunteeringApi.mock.calls.filter(([, method]) => method !== 'GET');
}

async function postAndFollow(agent, url, body) {
  const posted = await agent.post(url).type('form').send(body);
  expect(posted.status).toBe(302);
  return { posted, page: posted.headers.location.includes('/propose') ? await agent.get(posted.headers.location) : null };
}

beforeEach(() => {
  api.callVolunteeringApi.mockReset();
  api.callVolunteeringApi.mockResolvedValue({ data: { id: 30, status: 'proposed' } });
});

describe('proposing a project', () => {
  it('shows the form', async () => {
    const res = await request(createVolunteeringApp(routes)).get(FORM);

    expect(res.status).toBe(200);
    expect(res.text).toContain(html(t(`${CP}propose_title`)));
    expect(res.text).toContain(html(t(`${CP}propose_intro`)));
    expect(res.text).toContain('name="proposed_date-day"');
  });

  it('sends everything given and returns to the tab', async () => {
    const agent = request.agent(createVolunteeringApp(routes));
    const { posted } = await postAndFollow(agent, FORM, {
      title: ' Neighbourhood garden ', description: 'Grow food together', category: 'Environment',
      location: 'Mallow', target_volunteers: '6', 'proposed_date-day': '1', 'proposed_date-month': '5', 'proposed_date-year': '2099'
    });

    expect(writes()).toEqual([['test-token', 'POST', '/community-projects', {
      title: 'Neighbourhood garden', description: 'Grow food together', category: 'Environment',
      location: 'Mallow', target_volunteers: 6, proposed_date: '2099-05-01'
    }]]);
    expect(posted.headers.location).toBe(`${TAB}&status=project-proposed`);
  });

  it('leaves the optional fields out when they are empty', async () => {
    const agent = request.agent(createVolunteeringApp(routes));
    await postAndFollow(agent, FORM, { title: 'Garden', description: 'Dig', category: '', location: '', target_volunteers: '' });
    expect(writes()[0][3]).toEqual({ title: 'Garden', description: 'Dig' });
  });

  it('refuses a missing title and description, keeping what was typed', async () => {
    const agent = request.agent(createVolunteeringApp(routes));
    const { page } = await postAndFollow(agent, FORM, { title: '', description: '  ', location: 'Mallow' });

    expect(writes()).toEqual([]);
    expect(page.text).toContain('govuk-error-summary');
    expect(page.text).toContain(html(t(`${CP}title_required`)));
    expect(page.text).toContain(html(t(`${CP}description_required`)));
    expect(page.text).toContain('href="#title"');
    expect(page.text).toContain('value="Mallow"');
  });

  it('refuses a number of volunteers that is not a whole number, and a half-entered date', async () => {
    const agent = request.agent(createVolunteeringApp(routes));
    const { page } = await postAndFollow(agent, FORM, {
      title: 'Garden', description: 'Dig', target_volunteers: 'six', 'proposed_date-day': '1', 'proposed_date-month': '', 'proposed_date-year': '2099'
    });

    expect(writes()).toEqual([]);
    expect(page.text).toContain(html(t(`${CP}target_invalid`)));
    expect(page.text).toContain('href="#proposed_date-month"');
    expect(page.text).toContain('value="six"');
  });

  it("places the API's refusal on its field", async () => {
    api.callVolunteeringApi.mockRejectedValue(new api.ApiError('bad', 422, { errors: [{ code: 'VALIDATION_ERROR', message: 'Proposed date must be YYYY-MM-DD.', field: 'proposed_date' }] }));
    const agent = request.agent(createVolunteeringApp(routes));
    const { page } = await postAndFollow(agent, FORM, { title: 'Garden', description: 'Dig' });

    expect(page.text).toContain('Proposed date must be YYYY-MM-DD.');
    expect(page.text).toContain('href="#proposed_date-day"');
  });

  it('says so when the proposal could not be sent', async () => {
    api.callVolunteeringApi.mockRejectedValue(new api.ApiError('down', 500, {}));
    const agent = request.agent(createVolunteeringApp(routes));
    const { page } = await postAndFollow(agent, FORM, { title: 'Garden', description: 'Dig' });
    expect(page.text).toContain(html(t(`${CP}propose_failed`)));
  });

  it('sends a community with the section switched off to the volunteering page', async () => {
    const off = { volunteering_config: { 'volunteering.tab_community_projects': false } };
    const shown = await request(createVolunteeringApp(routes, { tenant: off })).get(FORM);
    expect(shown.status).toBe(302);
    expect(shown.headers.location).toBe('/acme/accessible/volunteering');

    const sent = await request(createVolunteeringApp(routes, { tenant: off })).post(FORM).type('form').send({ title: 'Garden', description: 'Dig' });
    expect(sent.headers.location).toBe('/acme/accessible/volunteering');
    expect(writes()).toEqual([]);
  });

  it('sends a signed-out visitor to sign in', async () => {
    const res = await request(createVolunteeringApp(routes, { signedIn: false })).get(FORM);
    expect(res.headers.location).toBe('/acme/accessible/login?status=auth-required');
  });
});

describe('supporting a project', () => {
  it('adds support and comes back to the project', async () => {
    const res = await request(createVolunteeringApp(routes)).post(`${MOUNT}/community-projects/12/support`).type('form').send({});

    expect(writes()).toEqual([['test-token', 'POST', '/community-projects/12/support']]);
    expect(res.headers.location).toBe(`${TAB}&status=project-supported#project-12`);
  });

  it('takes support back', async () => {
    const res = await request(createVolunteeringApp(routes)).post(`${MOUNT}/community-projects/12/unsupport`).type('form').send({});

    expect(writes()).toEqual([['test-token', 'DELETE', '/community-projects/12/support']]);
    expect(res.headers.location).toBe(`${TAB}&status=project-unsupported#project-12`);
  });

  it('says when it failed, and words a safeguarding refusal as one', async () => {
    api.callVolunteeringApi.mockRejectedValue(new api.ApiError('gone', 404, { errors: [{ code: 'NOT_FOUND' }] }));
    const failed = await request(createVolunteeringApp(routes)).post(`${MOUNT}/community-projects/12/support`).type('form').send({});
    expect(failed.headers.location).toBe(`${TAB}&status=project-support-failed#project-12`);

    api.callVolunteeringApi.mockRejectedValue(new api.ApiError('no', 403, { errors: [{ code: 'SAFEGUARDING_CONTACT_RESTRICTED' }] }));
    const refused = await request(createVolunteeringApp(routes)).post(`${MOUNT}/community-projects/12/support`).type('form').send({});
    expect(refused.headers.location).toBe(`${TAB}&status=project-support-restricted#project-12`);
  });
});
