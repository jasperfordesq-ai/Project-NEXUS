// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Federated debit approvals (React a44148956). An external partner's transfer
 * out of a member's account is held in `federation_debit_approvals` until that
 * member says yes. React lists them on Federation settings with Approve and
 * Decline; the accessible frontend had no way to see or answer them, so a
 * held transfer simply expired.
 *
 * API: GET /v2/federation/debit-approvals, POST /v2/federation/debit-approvals/{id}/decision
 * with { decision: approve|reject } (FederationDebitApprovalController).
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
    ApiOfflineError: class ApiOfflineError extends Error {},
    callFederationApi: jest.fn(),
    getBalance: jest.fn(),
    getUserBlockStatus: jest.fn(),
    blockMember: jest.fn(),
    unblockMember: jest.fn()
  };
});

const api = require('../src/lib/api');
const federationRoutes = require('../src/routes/federation');
const federationActionRoutes = require('../src/routes/federation-actions');
const { PREFIX, createApp, t } = require('./react-parity-harness');

const app = () => createApp('/federation', [federationActionRoutes, federationRoutes]);

function mockApi({ approvals = [], approvalsError = null, decisionError = null } = {}) {
  api.callFederationApi.mockImplementation((token, method, endpoint) => {
    if (endpoint === '/settings') {
      return Promise.resolve({ data: { enabled: true, settings: { federation_optin: true } } });
    }
    if (method === 'GET' && endpoint === '/debit-approvals') {
      return approvalsError ? Promise.reject(approvalsError) : Promise.resolve({ success: true, data: { approvals } });
    }
    if (method === 'POST' && /^\/debit-approvals\/\d+\/decision$/.test(endpoint)) {
      return decisionError ? Promise.reject(decisionError) : Promise.resolve({ success: true, data: { status: 'approved' } });
    }
    return Promise.resolve({ data: {} });
  });
}

describe('GET /federation/settings lists debit approvals', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows each pending approval with Approve and Decline', async () => {
    mockApi({ approvals: [
      { id: 42, protocol: 'credit_commons', amount: '2.0000', description: 'Gardening', expires_at: '2026-11-01T10:00:00Z', payee_label: 'partner/alice' },
      { id: 43, protocol: 'credit_commons_reversal', amount: '1.5', description: 'Refund', expires_at: '2026-11-02T10:00:00Z', payee_label: 'partner/bob' }
    ] });

    const res = await request(app()).get(`${PREFIX}/federation/settings`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_federation.debit_approvals.heading'));
    expect(res.text).toContain(t('govuk_alpha_federation.debit_approvals.summary', { amount: '2', payee: 'partner/alice' }));
    expect(res.text).toContain(t('govuk_alpha_federation.debit_approvals.reversal_summary', { amount: '1.5', payee: 'partner/bob' }));
    expect(res.text).toContain('Gardening');
    expect(res.text).toContain(`action="${PREFIX}/federation/settings/debit-approvals/42/decision"`);
    expect(res.text).toContain('name="decision" value="approve"');
    expect(res.text).toContain('name="decision" value="reject"');
    expect(res.text).toContain('name="_csrf" value="test-csrf-token"');
  });

  it('shows no section when nothing is waiting', async () => {
    mockApi({ approvals: [] });
    const res = await request(app()).get(`${PREFIX}/federation/settings`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(t('govuk_alpha_federation.debit_approvals.heading'));
  });

  it('says so when the list cannot be loaded, without breaking the page', async () => {
    mockApi({ approvalsError: new api.ApiError('down', 500, {}) });
    const res = await request(app()).get(`${PREFIX}/federation/settings`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_federation.debit_approvals.load_error'));
  });
});

describe('POST /federation/settings/debit-approvals/:id/decision', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends the decision and reports it saved', async () => {
    mockApi();
    const res = await request(app())
      .post(`${PREFIX}/federation/settings/debit-approvals/42/decision`)
      .type('form').send({ decision: 'reject' });

    expect(api.callFederationApi).toHaveBeenCalledWith('test-token', 'POST', '/debit-approvals/42/decision', { decision: 'reject' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/federation/settings?status=debit-decision-saved');
  });

  it('refuses an unknown decision without calling the API', async () => {
    mockApi();
    const res = await request(app())
      .post(`${PREFIX}/federation/settings/debit-approvals/42/decision`)
      .type('form').send({ decision: 'maybe' });

    expect(api.callFederationApi).not.toHaveBeenCalled();
    expect(res.headers.location).toContain('status=debit-decision-failed');
  });

  it('reports a refused decision', async () => {
    mockApi({ decisionError: new api.ApiError('gone', 404, {}) });
    const res = await request(app())
      .post(`${PREFIX}/federation/settings/debit-approvals/42/decision`)
      .type('form').send({ decision: 'approve' });

    expect(res.headers.location).toContain('status=debit-decision-failed');
    const page = await request(app()).get(`${PREFIX}/federation/settings?status=debit-decision-failed`);
    expect(page.text).toContain(t('govuk_alpha_federation.debit_approvals.failed'));
  });

  it('shows the saved banner', async () => {
    mockApi();
    const page = await request(app()).get(`${PREFIX}/federation/settings?status=debit-decision-saved`);
    expect(page.text).toContain(t('govuk_alpha_federation.debit_approvals.saved'));
  });
});
