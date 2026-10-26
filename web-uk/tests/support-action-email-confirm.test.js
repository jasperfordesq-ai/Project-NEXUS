// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The emailed single-use link for a supported decision (React
 * `support-actions/confirm/:token`). Opening it is read-only; only the form POST
 * approves. No sign-in: the token is the authority, as on React.
 */

const request = require('supertest');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  return {
    ApiError,
    ApiOfflineError: class extends Error {},
    getSupportActionByEmailToken: jest.fn(),
    confirmSupportActionByEmailToken: jest.fn()
  };
});

const api = require('../src/lib/api');
const routes = require('../src/routes/support-action-confirm');
const { PREFIX, createApp, t } = require('./react-parity-harness');

const TOKEN = 'abcDEF123_token-value';
const app = () => createApp('/support-actions/confirm', [routes], { signedIn: false });
const pending = {
  action_type: 'credit_transfer',
  status: 'pending',
  supporter_name: 'Pat Helper',
  payload_summary: { amount: 2, recipient_name: 'Sam', recipient_id: 9 },
  expires_at: '2026-11-02T10:00:00Z'
};

describe('supported decision from the emailed link', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows what was prepared and by whom, with an Approve form, without confirming', async () => {
    api.getSupportActionByEmailToken.mockResolvedValue({ data: pending });

    const res = await request(app()).get(`${PREFIX}/support-actions/confirm/${TOKEN}`);

    expect(res.status).toBe(200);
    expect(api.getSupportActionByEmailToken).toHaveBeenCalledWith(TOKEN);
    expect(api.confirmSupportActionByEmailToken).not.toHaveBeenCalled();
    expect(res.text).toContain('Pat Helper');
    expect(res.text).toContain('2 → Sam (#9)');
    expect(res.text).toContain(`action="${PREFIX}/support-actions/confirm/${TOKEN}"`);
    expect(res.text).toContain(t('govuk_alpha_settings.support_confirm.button'));
  });

  it('approves on POST and shows the done page', async () => {
    api.confirmSupportActionByEmailToken.mockResolvedValue({ data: { status: 'confirmed' } });

    const post = await request(app()).post(`${PREFIX}/support-actions/confirm/${TOKEN}`).type('form').send({});
    expect(api.confirmSupportActionByEmailToken).toHaveBeenCalledWith(TOKEN);
    expect(post.headers.location).toBe(`${PREFIX}/support-actions/confirm/${TOKEN}?status=confirmed`);

    api.getSupportActionByEmailToken.mockResolvedValue({ data: { ...pending, status: 'confirmed' } });
    const page = await request(app()).get(post.headers.location);
    expect(page.text).toContain(t('govuk_alpha_settings.support_confirm.success_title'));
  });

  it('says the link did not work when confirming fails', async () => {
    api.confirmSupportActionByEmailToken.mockRejectedValue(new api.ApiError('gone', 422));
    const post = await request(app()).post(`${PREFIX}/support-actions/confirm/${TOKEN}`).type('form').send({});
    expect(post.headers.location).toBe(`${PREFIX}/support-actions/confirm/${TOKEN}?status=failed`);

    api.getSupportActionByEmailToken.mockResolvedValue({ data: pending });
    const page = await request(app()).get(post.headers.location);
    expect(page.text).toContain(t('govuk_alpha_settings.support_confirm.error_title'));
    expect(page.text).not.toContain(t('govuk_alpha_settings.support_confirm.button'));
  });

  it('says an answered or expired request is already answered, with no button', async () => {
    api.getSupportActionByEmailToken.mockResolvedValue({ data: { ...pending, status: 'expired' } });
    const res = await request(app()).get(`${PREFIX}/support-actions/confirm/${TOKEN}`);
    expect(res.text).toContain(t('govuk_alpha_settings.support_confirm.unavailable_title'));
    expect(res.text).not.toContain(t('govuk_alpha_settings.support_confirm.button'));
  });

  it('answers 404 for an unknown token and refuses a malformed one before the API', async () => {
    api.getSupportActionByEmailToken.mockRejectedValue(new api.ApiError('nope', 404));
    const unknown = await request(app()).get(`${PREFIX}/support-actions/confirm/${TOKEN}`);
    expect(unknown.status).toBe(404);

    jest.clearAllMocks();
    const bad = await request(app()).post(`${PREFIX}/support-actions/confirm/bad%20token`).type('form').send({});
    expect(bad.status).toBe(404);
    expect(api.confirmSupportActionByEmailToken).not.toHaveBeenCalled();
  });
});
