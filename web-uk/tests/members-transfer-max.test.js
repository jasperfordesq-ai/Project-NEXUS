// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * The "send time credits" form on a member's profile is a second transfer path
 * beside /wallet. The wallet page learned the community's own transfer limit
 * (GET /v2/wallet/config -> max_transfer) on 27 Oct 2026; this route did not, so
 * an amount above a lower community limit went to the API, was refused, and the
 * member saw only "We could not complete the transfer".
 */

const express = require('express');
const session = require('express-session');
const request = require('supertest');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  return {
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    transferWalletCredits: jest.fn(),
    callWalletApi: jest.fn()
  };
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() })
}));

const api = require('../src/lib/api');
const membersRoutes = require('../src/routes/members');
const { profileStatusMessage } = membersRoutes;
const { walletMaxTransfer, PLATFORM_MAX_TRANSFER } = require('../src/lib/wallet-limits');

function buildApp() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'members-transfer-max-test-secret-32chars', resave: false, saveUninitialized: false }));
  app.use('/', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'acme', prefix: '/acme/accessible', tenant: { id: 2, slug: 'acme' } };
    res.locals.urlFor = (value) => String(value || '/');
    res.locals.t = createTranslator('en');
    res.locals.tc = createChoiceTranslator('en');
    next();
  }, membersRoutes);
  return app;
}

const validBody = { confirm: '1', idempotency_key: 'abcd-1234-efgh-5678', note: 'thanks' };

describe('member profile transfer follows the community transfer limit', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuses an amount above the community limit before calling the transfer API', async () => {
    api.callWalletApi.mockResolvedValue({ data: { max_transfer: 50 } });
    const res = await request(buildApp()).post('/42/transfer').type('form').send({ ...validBody, amount: '60' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('status=transfer-too-large');
    expect(api.callWalletApi).toHaveBeenCalledWith('token:test', 'GET', '/config');
    expect(api.transferWalletCredits).not.toHaveBeenCalled();
  });

  it('sends an amount within the community limit', async () => {
    api.callWalletApi.mockResolvedValue({ data: { max_transfer: 50 } });
    api.transferWalletCredits.mockResolvedValue({ data: { ok: true } });
    const res = await request(buildApp()).post('/42/transfer').type('form').send({ ...validBody, amount: '50' });
    expect(res.headers.location).toContain('status=transfer-sent');
    expect(api.transferWalletCredits).toHaveBeenCalledWith('token:test', expect.objectContaining({ recipient: 42, amount: 50 }));
  });

  it('falls back to the platform ceiling when the limit cannot be read', async () => {
    api.callWalletApi.mockRejectedValue(new api.ApiError('down', 503));
    api.transferWalletCredits.mockResolvedValue({ data: { ok: true } });
    const res = await request(buildApp()).post('/42/transfer').type('form').send({ ...validBody, amount: '900' });
    expect(res.headers.location).toContain('status=transfer-sent');
  });

  it('names the limit in the refusal banner', () => {
    const t = createTranslator('en');
    const message = profileStatusMessage({ query: { status: 'transfer-too-large' }, t }, { maxTransfer: 50 });
    expect(message.type).toBe('error');
    expect(message.text).toContain('50');
    expect(message.text).not.toContain(':max');
  });

  it('shares one limit reader with the wallet page', async () => {
    api.callWalletApi.mockResolvedValue({ data: { max_transfer: '25' } });
    await expect(walletMaxTransfer('token:test')).resolves.toBe(25);
    api.callWalletApi.mockResolvedValue({ data: {} });
    await expect(walletMaxTransfer('token:test')).resolves.toBe(PLATFORM_MAX_TRANSFER);
  });
});
