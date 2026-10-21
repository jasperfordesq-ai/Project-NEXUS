// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The people who run a shift check a volunteer in and out on the accessible site
 * (routes/volunteering-checkin-verify.js, parity gap 6, 21 Oct 2026).
 *
 * Pinned here:
 * - opening the address changes nothing: the page asks first;
 * - Confirm sends the code to the API and says who is checked in, then offers Check out;
 * - Check out sends the code and says who is checked out;
 * - the API's own refusal is shown in its words (checking yourself in, checking out
 *   before the shift starts), and a bad code or a non-organiser gets plain wording;
 * - an address that is not a check-in code is not found.
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
const routes = require('../src/routes/volunteering-checkin-verify');
const { MOUNT, t, createVolunteeringApp, html } = require('./support/volunteering-route-app');

const CODE = 'a'.repeat(32) + 'b'.repeat(32);
const PAGE = `${MOUNT}/checkin/${CODE}`;
const K = 'govuk_alpha_volunteering.checkin_verify.';

async function postAndFollow(agent, url, body = {}) {
  const posted = await agent.post(url).type('form').send(body);
  expect(posted.status).toBe(302);
  expect(posted.headers.location).toBe(`/acme/accessible/volunteering/checkin/${CODE}`);
  return agent.get(posted.headers.location);
}

beforeEach(() => {
  api.callVolunteeringApi.mockReset();
  api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => {
    if (apiPath === `/checkin/verify/${CODE}`) return { data: { status: 'checked_in', user: { id: 50, name: 'Ada Lovelace' } } };
    if (apiPath === `/checkin/checkout/${CODE}`) return { data: { message: 'Checked out' } };
    throw new api.ApiError('unexpected', 500, {});
  });
});

describe('checking a volunteer in', () => {
  it('asks first and changes nothing on opening', async () => {
    const res = await request(createVolunteeringApp(routes)).get(PAGE);

    expect(res.status).toBe(200);
    expect(api.callVolunteeringApi).not.toHaveBeenCalled();
    expect(res.text).toContain(html(t(`${K}intro`)));
    expect(res.text).toContain(`action="/acme/accessible/volunteering/checkin/${CODE}/verify"`);
  });

  it('checks them in, says who, then offers Check out', async () => {
    const agent = request.agent(createVolunteeringApp(routes));
    const page = await postAndFollow(agent, `${PAGE}/verify`);

    expect(api.callVolunteeringApi).toHaveBeenCalledWith('test-token', 'POST', `/checkin/verify/${CODE}`);
    expect(page.text).toContain('data-testid="checkin-checked_in"');
    expect(page.text).toContain(html(t(`${K}checked_in`, { name: 'Ada Lovelace' })));
    expect(page.text).toContain(`action="/acme/accessible/volunteering/checkin/${CODE}/checkout"`);
    expect(page.text).toContain('name="name" value="Ada Lovelace"');

    // Shown once: coming back asks again rather than repeating the result.
    expect((await agent.get(PAGE)).text).toContain(html(t(`${K}intro`)));
  });

  it('checks them out and says who', async () => {
    const agent = request.agent(createVolunteeringApp(routes));
    const page = await postAndFollow(agent, `${PAGE}/checkout`, { name: 'Ada Lovelace' });

    expect(api.callVolunteeringApi).toHaveBeenCalledWith('test-token', 'POST', `/checkin/checkout/${CODE}`);
    expect(page.text).toContain(html(t(`${K}checked_out`, { name: 'Ada Lovelace' })));
    expect(page.text).not.toContain('/checkout"');
  });

  it("shows the API's refusal in its words", async () => {
    api.callVolunteeringApi.mockRejectedValue(new api.ApiError('self', 403, { errors: [{ code: 'FORBIDDEN', message: 'You cannot check yourself in.' }] }));
    const agent = request.agent(createVolunteeringApp(routes));
    const page = await postAndFollow(agent, `${PAGE}/verify`);

    expect(page.text).toContain('govuk-error-summary');
    expect(page.text).toContain('You cannot check yourself in.');
  });

  it('uses plain wording for a bad code or a non-organiser when the API gives none', async () => {
    api.callVolunteeringApi.mockRejectedValue(new api.ApiError('gone', 404, {}));
    const invalid = await postAndFollow(request.agent(createVolunteeringApp(routes)), `${PAGE}/verify`);
    expect(invalid.text).toContain(html(t(`${K}invalid`)));

    api.callVolunteeringApi.mockRejectedValue(new api.ApiError('no', 403, {}));
    const forbidden = await postAndFollow(request.agent(createVolunteeringApp(routes)), `${PAGE}/checkout`);
    expect(forbidden.text).toContain(html(t(`${K}forbidden`)));
  });

  it('keeps Check out after a refused check-out, with the reason', async () => {
    api.callVolunteeringApi.mockRejectedValue(new api.ApiError('early', 422, { errors: [{ code: 'VALIDATION_ERROR', message: 'Check-out is not available before the shift starts.' }] }));
    const page = await postAndFollow(request.agent(createVolunteeringApp(routes)), `${PAGE}/checkout`, { name: 'Ada Lovelace' });

    expect(page.text).toContain('data-testid="checkout-error"');
    expect(page.text).toContain('Check-out is not available before the shift starts.');
    expect(page.text).toContain(html(t(`${K}checked_in`, { name: 'Ada Lovelace' })));
    expect(page.text).toContain(`action="/acme/accessible/volunteering/checkin/${CODE}/checkout"`);
  });

  it('does not treat a short or odd address as a code', async () => {
    const res = await request(createVolunteeringApp(routes)).get(`${MOUNT}/checkin/abc`);
    expect(res.status).toBe(404);
    expect(api.callVolunteeringApi).not.toHaveBeenCalled();
  });

  it('sends a signed-out visitor to sign in', async () => {
    const res = await request(createVolunteeringApp(routes, { signedIn: false })).get(PAGE);
    expect(res.headers.location).toBe('/acme/accessible/login?status=auth-required');
  });
});
