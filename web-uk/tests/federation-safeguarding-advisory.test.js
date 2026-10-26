// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A partner-community member's profile says UP FRONT when that community's
 * safeguarding policy will refuse contact (React 57a8249a8). Before this, the
 * accessible profile offered Connect, Message and Send credits and the member
 * found out only after a failed send.
 *
 * Pinned: an explicit `contact_allowed: false` shows Laravel's sentence once and
 * offers no contact form; the transfer page is not offered either; an allowed or
 * ABSENT advisory leaves every action in place; Block stays available.
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
const { PREFIX, createApp, t } = require('./react-parity-harness');

const DETAIL = 'This member is not available for direct messages because their safeguarding preferences require coordinator-mediated contact.';
const restricted = {
  contact_allowed: false,
  status: 'deny',
  code: 'SAFEGUARDING_CONTACT_RESTRICTED',
  title: 'Coordinator arrangement needed',
  detail: DETAIL,
  message: 'Your message has not been sent.'
};

function member(overrides = {}) {
  return {
    id: 20,
    name: 'Robin Partner',
    tenant_id: 9,
    timebank: { id: 9, name: 'Partner Timebank' },
    messaging_enabled: true,
    transactions_enabled: true,
    connection_status: 'none',
    ...overrides
  };
}

function mockProfile(memberData) {
  api.callFederationApi.mockImplementation((token, method, endpoint) => {
    if (endpoint === '/settings') {
      return Promise.resolve({
        data: { enabled: true, settings: { federation_optin: true, messaging_enabled_federated: true, transactions_enabled_federated: true } }
      });
    }
    return Promise.resolve({ data: memberData });
  });
  api.getUserBlockStatus.mockResolvedValue({ data: { is_blocked: false } });
  api.getBalance.mockResolvedValue({ data: { balance: 10 } });
}

const app = () => createApp('/federation', [federationRoutes]);
const connectForm = `action="${PREFIX}/federation/connections"`;
const messageForm = `action="${PREFIX}/federation/messages"`;
const transferLink = '/transfer?tenant_id=';

describe('partner profile safeguarding advisory', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the refusal once and offers no Connect, Message or Send credits', async () => {
    mockProfile(member({ safeguarding: restricted }));

    const res = await request(app()).get(`${PREFIX}/federation/members/20?tenant_id=9`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Coordinator arrangement needed');
    expect(res.text.split(DETAIL)).toHaveLength(2);
    expect(res.text).not.toContain(connectForm);
    expect(res.text).not.toContain(messageForm);
    expect(res.text).not.toContain(transferLink);
    // The member can still protect themselves.
    expect(res.text).toContain(`action="${PREFIX}/federation/members/20/block"`);
  });

  it('falls back to its own wording when Laravel sends no sentence', async () => {
    mockProfile(member({ safeguarding: { contact_allowed: false } }));

    const res = await request(app()).get(`${PREFIX}/federation/members/20?tenant_id=9`);

    expect(res.text).toContain(t('govuk_alpha_federation.safeguarding.heading'));
    expect(res.text).toContain(t('govuk_alpha_federation.safeguarding.body'));
    expect(res.text).not.toContain(messageForm);
  });

  it('does not offer the transfer page while safeguarding refuses contact', async () => {
    mockProfile(member({ safeguarding: restricted }));

    const res = await request(app()).get(`${PREFIX}/federation/members/20/transfer?tenant_id=9`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${PREFIX}/federation/members/20?tenant_id=9`);
    expect(api.getBalance).toHaveBeenCalled();
  });

  it('leaves every action in place when safeguarding allows contact', async () => {
    mockProfile(member({ safeguarding: { contact_allowed: true, status: 'allow', detail: null } }));

    const res = await request(app()).get(`${PREFIX}/federation/members/20?tenant_id=9`);

    expect(res.text).toContain(connectForm);
    expect(res.text).toContain(messageForm);
    expect(res.text).toContain(transferLink);
    expect(res.text).not.toContain('fed-safeguarding-advisory');
  });

  it('treats a missing advisory as no advisory, never as a refusal', async () => {
    mockProfile(member());

    const res = await request(app()).get(`${PREFIX}/federation/members/20?tenant_id=9`);

    expect(res.text).toContain(messageForm);
    expect(res.text).toContain(transferLink);
    expect(res.text).not.toContain('fed-safeguarding-advisory');
  });
});
