// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A refused federated credit transfer must say WHY (React d2f7efc4).
 *
 * The accessible route mapped every API failure to `transfer-failed` and sent
 * the member back to the profile page, whose banner list had no entry for it,
 * so a refusal showed nothing at all. The specific safeguarding banners existed
 * but were never set. Pinned here: each explained refusal from
 * FederationV2Controller::sendTransaction reaches a specific banner, and any
 * other explained refusal shows the API's own (translated) sentence.
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

const member = {
  id: 20,
  name: 'Robin Partner',
  tenant_id: 9,
  timebank: { id: 9, name: 'Partner Timebank' },
  messaging_enabled: true,
  transactions_enabled: true,
  connection_status: 'none'
};

function refuse(status, code, message, field) {
  const error = new api.ApiError(message, status, {
    success: false,
    errors: [{ code, message, ...(field ? { field } : {}) }]
  });
  api.callFederationApi.mockImplementation((token, method, endpoint) => {
    if (method === 'POST' && endpoint === '/transactions') return Promise.reject(error);
    if (endpoint === '/settings') {
      return Promise.resolve({ data: { enabled: true, settings: { federation_optin: true, transactions_enabled_federated: true } } });
    }
    return Promise.resolve({ data: member });
  });
  api.getUserBlockStatus.mockResolvedValue({ data: { is_blocked: false } });
  api.getBalance.mockResolvedValue({ data: { balance: 10 } });
}

const body = { receiver_tenant_id: '9', amount: '2', description: 'Helped with setup', idempotency_key: 'abc12345' };

async function submitAndFollow(agent) {
  const post = await agent.post(`${PREFIX}/federation/members/20/transfer`).type('form').send(body);
  expect(post.status).toBe(302);
  const page = await agent.get(post.headers.location.replace(/^https?:\/\/[^/]+/, ''));
  return { location: post.headers.location, page };
}

const app = () => createApp('/federation', [federationActionRoutes, federationRoutes]);

describe('federated transfer refusals', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    [403, 'SAFEGUARDING_CONTACT_RESTRICTED', 'transfer-safeguarding-restricted'],
    [503, 'SAFEGUARDING_POLICY_UNAVAILABLE', 'transfer-safeguarding-unavailable'],
    [400, 'INSUFFICIENT_BALANCE', 'transfer-insufficient'],
    [400, 'SELF_TRANSACTION', 'transfer-self'],
    [403, 'SENDER_TRANSACTIONS_DISABLED', 'transfer-not-enabled'],
    [403, 'RECIPIENT_TRANSACTIONS_DISABLED', 'transfer-recipient-unavailable'],
    [404, 'RECIPIENT_NOT_FOUND', 'transfer-recipient-unavailable']
  ])('%s %s shows the specific banner', async (httpStatus, code, expected) => {
    refuse(httpStatus, code, 'server sentence');
    const { location, page } = await submitAndFollow(request.agent(app()));
    expect(location).toContain(`status=${expected}`);
    expect(page.text).toContain(t(`fed2.transfer.status.${expected}`));
  });

  it('maps a field validation refusal to its field', async () => {
    refuse(422, 'VALIDATION_ERROR', 'Amount must be between 1 and 100.', 'amount');
    const { location } = await submitAndFollow(request.agent(app()));
    expect(location).toContain('status=transfer-amount-invalid');
  });

  it("shows the API's own sentence for any other explained refusal", async () => {
    const sentence = 'This partnership does not allow credit transfers.';
    refuse(403, 'TRANSACTIONS_NOT_ALLOWED', sentence);
    const { location, page } = await submitAndFollow(request.agent(app()));
    expect(location).toContain('status=transfer-refused');
    expect(page.text).toContain(sentence);
  });

  it('falls back to the generic failure when the refusal carries no sentence', async () => {
    refuse(500, 'SERVER_ERROR', '');
    const { location, page } = await submitAndFollow(request.agent(app()));
    expect(location).toContain('status=transfer-failed');
    expect(page.text).toContain(t('fed2.transfer.status.transfer-failed'));
  });

  it('never shows a stale refusal sentence on a later visit', async () => {
    refuse(403, 'TRANSACTIONS_NOT_ALLOWED', 'One-off sentence.');
    const agent = request.agent(app());
    const { location } = await submitAndFollow(agent);
    const again = await agent.get(location.replace(/^https?:\/\/[^/]+/, ''));
    expect(again.text).not.toContain('One-off sentence.');
  });
});
